import type {Customer, RuntimeEnv} from './types.ts';
import {uid, randomToken, sha, hmac, safeEqual} from './security.ts';
import {all, first, stmt, now, fail, json, body, str, limit, audit} from './api-common.ts';
import {emailConfiguration} from './email-configuration.ts';
const TTL = 10 * 60000, SESSION_TTL = 7 * 86400000;
const cookie = (token:string, age=604800) => `px_customer=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
export function transactionGuard(db:D1Database, condition:string, ...values:any[]) {
    const id=uid();
    return [stmt(db,`INSERT INTO transaction_guards(id,passed) SELECT ?,CASE WHEN ${condition} THEN 1 ELSE 0 END`,id,...values),stmt(db,'DELETE FROM transaction_guards WHERE id=?',id)];
}
export function emailReady(env:RuntimeEnv) {return emailConfiguration(env).ready;}
export async function customerSession(db:D1Database, env:RuntimeEnv, request:Request, required=false) {
    const token=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('px_customer='))?.slice(12);
    const customer=token?await first<Customer>(db,`SELECT c.id,c.email,c.display_name,c.recipient,c.contact,c.shipping_address,c.verified_at,c.is_demo,s.csrf FROM customer_sessions s JOIN customers c ON c.id=s.customer_id WHERE s.hash=? AND s.expires_at>? AND c.active=1 AND (c.is_demo=0 OR ?=1)`,await sha(token),now(),env.DEMO_MODE==='true'?1:0):null;
    if(!customer && required)fail(401,'请先登录，或使用订单号与查询密钥查询');
    return customer;
}
export function customerCsrf(customer:Customer, request:Request) {
    if(request.method!=='GET'&&!safeEqual(request.headers.get('x-csrf-token')||'',customer.csrf))fail(403,'账号安全校验失败，请刷新页面后重试');
}
function normalizeEmail(value:unknown) {
    const email=str(value,255).toLowerCase();
    if(typeof value!=='string'||value.trim().length>254||!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(email)||email.includes('..'))fail(400,'请输入有效邮箱地址');
    return email;
}
async function emailRate(db:D1Database,email:string) {
    const hour=Math.floor(now()/3600000), key=await sha(`email-send:${email}:${hour}`);
    const r=await stmt(db,'INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',key,(hour+1)*3600000).first<{count:number}>();
    if(r!.count>6)fail(429,'该邮箱发送次数较多，请一小时后再试');
}
function codeValue() {
    let value:number;do{value=crypto.getRandomValues(new Uint32Array(1))[0];}while(value>=4294000000);
    return String(value%1000000).padStart(6,'0');
}
async function challenge(db:D1Database,env:RuntimeEnv,request:Request,b:any,demo:boolean) {
    if(demo&&env.DEMO_MODE!=='true')fail(403,'正式环境不提供演示邮箱');
    if(!demo&&!emailReady(env))fail(503,'邮箱登录暂时不可用，请稍后重试。您仍可免登录选购及查询订单。');
    if(!env.INVENTORY_KEY)fail(503,'账号验证服务尚未配置');
    await limit(db,request,'customer-email-send',5);
    const email=demo?`demo-${randomToken().slice(0,12)}@example.invalid`:normalizeEmail(b.email);
    await emailRate(db,email);
    const id=randomToken(),code=codeValue(),created=now();
    const result=await stmt(db,`INSERT INTO email_challenges(id,email,code_hash,is_demo,created_at,expires_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM email_challenges WHERE email=? AND created_at>?)`,id,email,await hmac(`customer-email:${id}:${email}:${code}`,env.INVENTORY_KEY),demo?1:0,created,created+TTL,email,created-60000).run();
    if(!result.meta.changes)fail(429,'请等待 60 秒后再发送验证码');
    if(!demo){
        try{
            const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`pinxiang-login/${id}`},body:JSON.stringify({from:env.EMAIL_FROM,to:[email],subject:'品香 · 邮箱登录验证码',text:`您的品香登录验证码是：${code}\n验证码 10 分钟内有效，仅可使用一次。验证通过后将登录或创建账号。\n请勿向任何人透露验证码。若非本人操作，请忽略此邮件。`}),signal:AbortSignal.timeout(10000)});
            if(!response.ok)throw new Error('MAIL_UNAVAILABLE');
        }catch{await stmt(db,'UPDATE email_challenges SET expires_at=? WHERE id=?',now(),id).run();fail(503,'验证码暂时发送失败，请稍后重试，也可以免登录购买');}
    }
    await stmt(db,'UPDATE email_challenges SET sent_at=? WHERE id=?',now(),id).run();
    return json({challenge_id:id,email,expires_in:600,resend_after:60,...(demo?{demo:true,demo_code:code}:{})});
}
async function verify(db:D1Database,env:RuntimeEnv,request:Request,b:any) {
    await limit(db,request,'customer-email-verify',15);
    const id=str(b.challenge_id,64),code=str(b.code,10);
    if(!/^[a-f0-9]{64}$/.test(id)||!/^\d{6}$/.test(code))fail(400,'请输入 6 位邮箱验证码');
    const c=await stmt(db,`UPDATE email_challenges SET attempts=attempts+1 WHERE id=? AND expires_at>? AND consumed_at IS NULL AND sent_at IS NOT NULL AND attempts<5 AND (is_demo=0 OR ?=1) RETURNING *`,id,now(),env.DEMO_MODE==='true'?1:0).first<any>();
    if(!c||!env.INVENTORY_KEY||!safeEqual(c.code_hash,await hmac(`customer-email:${id}:${c.email}:${code}`,env.INVENTORY_KEY)))fail(400,'验证码错误、失效或尝试次数已达上限，请重新获取');
    const token=randomToken(),csrf=randomToken(),consumed=randomToken(),ts=now();
    try{await db.batch([
        stmt(db,'UPDATE email_challenges SET consumed_at=?,consume_token=? WHERE id=? AND consumed_at IS NULL AND expires_at>? AND attempts<=5',ts,consumed,id,ts),
        ...transactionGuard(db,'EXISTS(SELECT 1 FROM email_challenges WHERE id=? AND consume_token=?)',id,consumed),
        stmt(db,`INSERT INTO customers(id,email,is_demo,verified_at,created_at,last_login_at) VALUES(?,?,?,?,?,?) ON CONFLICT(email,is_demo) DO UPDATE SET verified_at=excluded.verified_at,last_login_at=excluded.last_login_at`,uid(),c.email,c.is_demo,c.is_demo?null:ts,ts,ts),
        ...transactionGuard(db,'EXISTS(SELECT 1 FROM customers WHERE email=? AND is_demo=? AND active=1)',c.email,c.is_demo),
        stmt(db,'INSERT INTO customer_sessions(hash,customer_id,csrf,expires_at,created_at) SELECT ?,id,?,?,? FROM customers WHERE email=? AND is_demo=? AND active=1',await sha(token),csrf,ts+SESSION_TTL,ts,c.email,c.is_demo),
        stmt(db,'UPDATE email_challenges SET expires_at=? WHERE email=? AND is_demo=? AND id!=? AND consumed_at IS NULL',ts,c.email,c.is_demo,id)
    ]);}catch{fail(409,'验证码已使用或账号不可用，请重新获取验证码');}
    return json({ok:true,csrf},200,{'Set-Cookie':cookie(token)});
}
export async function handleCustomerApi(db:D1Database,env:RuntimeEnv,request:Request,path:string,url:URL):Promise<Response> {
    const method=request.method;
    if(path==='customer/session'&&method==='GET')return json({customer:await customerSession(db,env,request),email_ready:emailReady(env),demo:env.DEMO_MODE==='true'});
    if(path==='customer/email/code'&&method==='POST')return challenge(db,env,request,await body(request),false);
    if(path==='customer/email/demo'&&method==='POST')return challenge(db,env,request,{},true);
    if(path==='customer/email/verify'&&method==='POST')return verify(db,env,request,await body(request));
    const c=(await customerSession(db,env,request,true))!;customerCsrf(c,request);
    if(path==='customer/logout'&&method==='POST'){
        const b=await body(request);await stmt(db,'DELETE FROM customer_sessions WHERE customer_id=?'+(b.all===true?'':' AND csrf=?'),...([c.id,...(b.all===true?[]:[c.csrf])])).run();
        return json({ok:true},200,{'Set-Cookie':cookie('',0)});
    }
    if(path==='customer/profile'&&method==='POST'){
        const b=await body(request);await stmt(db,'UPDATE customers SET display_name=?,recipient=?,contact=?,shipping_address=? WHERE id=?',str(b.display_name,40),str(b.recipient,60),str(b.contact,100),str(b.shipping_address,500),c.id).run();return json({ok:true});
    }
    if(path==='customer/orders'&&method==='GET'){
        const page=Math.max(1,Math.min(10000,Math.trunc(Number(url.searchParams.get('page')))||1));
        const where=" WHERE customer_id=? AND order_type='physical' AND demo=? AND ready=1",args=[c.id,env.DEMO_MODE==='true'?1:0];
        return json({orders:await all(db,'SELECT id,total,status,tracking_number,created_at,paid_at,recipient,shipment_group_id FROM orders'+where+' ORDER BY created_at DESC LIMIT 20 OFFSET ?',...args,(page-1)*20),total:(await first<any>(db,'SELECT count(*) AS n FROM orders'+where,...args)).n,page});
    }
    if(path==='customer/orders/claim'&&method==='POST'){
        await limit(db,request,'customer-claim',10);const b=await body(request),id=str(b.id,64),hash=await sha(str(b.secret,128));
        const o=await first<any>(db,"SELECT customer_id FROM orders WHERE id=? AND lookup_hash=? AND ready=1 AND order_type='physical' AND demo=?",id,hash,env.DEMO_MODE==='true'?1:0);
        if(!o)fail(404,'订单号或查询密钥不正确');if(o.customer_id&&o.customer_id!==c.id)fail(409,'该订单已归属其他账号');
        try{await db.batch([
            ...transactionGuard(db,'EXISTS(SELECT 1 FROM orders WHERE id=? AND (customer_id IS NULL OR customer_id=?))',id,c.id),
            stmt(db,'UPDATE orders SET customer_id=?,revision=revision+1 WHERE id=? AND customer_id IS NULL',c.id,id),audit(db,c.id,'order.claim',id,'客户凭订单号与密钥绑定')
        ]);}catch{fail(409,'订单归属已变化，请刷新核对');}return json({ok:true});
    }
    fail(404,'账号接口不存在');
}
