import type {RuntimeEnv,Staff} from './types.ts';
import {all,first,stmt,now,json,fail,body,str,audit,limit} from './api-common.ts';
import {uid} from './security.ts';
import {emailConfiguration} from './email-configuration.ts';

export function queueOrderEmail(db:D1Database,id:string,event:'created'|'paid') {
    return stmt(db,`INSERT OR IGNORE INTO order_notifications(id,order_id,event,recipient,created_at)
        SELECT ?,id,?,contact_email,? FROM orders WHERE id=? AND ready=1 AND demo=0 AND contact_email!=''
        ${event==='paid'?"AND paid_at IS NOT NULL AND status IN('paid','fulfilled')":''}`,`${id}:${event}`,event,now(),id);
}
const yuan=(n:number)=>'¥'+(n/100).toFixed(2);
async function payload(db:D1Database,env:RuntimeEnv,n:any) {
    const order=await first<any>(db,'SELECT id,total,subtotal,shipping_fee FROM orders WHERE id=?',n.order_id);
    const items=await all<any>(db,'SELECT product_name,price,quantity FROM order_items WHERE order_id=?',n.order_id);
    const paid=n.event==='paid';
    return {from:env.EMAIL_FROM,to:[n.recipient],subject:paid?'品香 · 购买成功（已付款）':'品香 · 下单成功（订单已创建）',
        text:[paid?'您的订单已付款，购买成功。':'您的订单已创建。本邮件不代表付款成功，请在订单页面核对付款状态。',
            `订单号：${order.id}`,...items.map(x=>`${x.product_name} × ${x.quantity}  ${yuan(x.price*x.quantity)}`),
            `商品金额：${yuan(order.subtotal)}`,`邮费：${yuan(order.shipping_fee)}`,`订单总额：${yuan(order.total)}`,
            '订单查询：https://pinxiang.lol/orders',
            '登录账号查看本人订单；游客请使用下单时保存的订单号与查询密钥。',
            paid?'付款后可在订单页面查看随单赠送的加密通讯账号。':'尚未付款的订单不会显示赠送账号。',
            '邮件不包含查询密钥、收货地址或赠送账号。请勿向他人透露订单查询密钥。',
            '这是一封订单通知邮件，无需回复。'].join('\n')};
}
// A durable outbox and provider idempotency key cover request retries and worker restarts.
// Do not retry ambiguous sends beyond the provider's 24-hour deduplication window.
export async function deliverOrderEmails(env:RuntimeEnv,orderId?:string) {
    if(!env.DB||env.DEMO_MODE==='true')return;
    const db=env.DB;
    try {
        const candidates=await all<any>(db,`SELECT id FROM order_notifications WHERE status IN('pending','blocked','failed','processing')
            AND attempts<6 AND next_attempt_at<=? AND lease_until<=? ${orderId?'AND order_id=?':''} ORDER BY created_at,id LIMIT ?`,now(),now(),...(orderId?[orderId]:[]),orderId?2:9);
        const ready=emailConfiguration(env).checks.filter(c=>c.name!=='INVENTORY_KEY').every(c=>c.status==='configured');
        for(let offset=0;offset<candidates.length;offset+=3)await Promise.all(candidates.slice(offset,offset+3).map(async candidate=>{
            if(!ready){await stmt(db,"UPDATE order_notifications SET status='blocked',last_error='邮件服务尚未配置',next_attempt_at=? WHERE id=? AND lease_until<=? AND status!='sent'",now()+60000,candidate.id,now()).run();return;}
            const token=uid(),ts=now();
            const n=await stmt(db,`UPDATE order_notifications SET status='processing',lease_until=?,lease_token=?,attempts=attempts+1,
                first_attempt_at=coalesce(first_attempt_at,?) WHERE id=? AND status IN('pending','blocked','failed','processing') AND attempts<6 AND next_attempt_at<=? AND lease_until<=? RETURNING *`,ts+60000,token,ts,candidate.id,ts,ts).first<any>();
            if(!n)return;
            if(ts-n.first_attempt_at>23*3600000){await stmt(db,"UPDATE order_notifications SET status='review',last_error='超过安全重试时限，请先在邮件服务中核对发送记录',lease_until=0 WHERE id=? AND lease_token=?",n.id,token).run();return;}
            try{
                const frozen=n.request_json||JSON.stringify(await payload(db,env,n));
                await stmt(db,'UPDATE order_notifications SET request_json=? WHERE id=? AND lease_token=?',frozen,n.id,token).run();
                const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`pinxiang-order/${n.id}`},body:frozen,signal:AbortSignal.timeout(8000)});
                if(!response.ok)throw Error('MAIL_UNAVAILABLE');
                const result=await response.json() as any;
                await stmt(db,"UPDATE order_notifications SET status='sent',provider_id=?,sent_at=?,lease_until=0,last_error='' WHERE id=? AND lease_token=?",str(result.id,100),now(),n.id,token).run();
            }catch{
                await stmt(db,"UPDATE order_notifications SET status='failed',last_error='发送暂未确认，系统将重试；可在邮件服务核对记录',next_attempt_at=?,lease_until=0 WHERE id=? AND lease_token=?",now()+Math.min(3600000,60000*2**(n.attempts-1)),n.id,token).run();
            }
        }));
    }catch{console.error('order notification processing unavailable');}
}
export async function notificationAdmin(db:D1Database,env:RuntimeEnv,request:Request,staff:Staff) {
    if(request.method==='GET')return json({notifications:await all(db,'SELECT id,order_id,event,recipient,status,attempts,created_at,sent_at,last_error FROM order_notifications ORDER BY created_at DESC LIMIT 200')});
    await limit(db,request,'notification-retry',10);
    const b=await body(request),id=str(b.id,100),n=await first<any>(db,'SELECT * FROM order_notifications WHERE id=?',id);
    if(!n)fail(404,'通知记录不存在');
    if(n.status==='sent')return json({ok:true,idempotent:true});
    if(n.lease_until>now())fail(409,'邮件正在处理中，请稍后刷新');
    if(n.first_attempt_at&&now()-n.first_attempt_at>23*3600000)fail(409,'超过安全重试时限，请先在 Resend 核对该订单的发送记录');
    await db.batch([stmt(db,"UPDATE order_notifications SET status='pending',attempts=0,next_attempt_at=0 WHERE id=? AND status!='sent' AND lease_until<=?",id,now()),audit(db,staff.id,'notification.retry',n.order_id,n.event)]);
    await deliverOrderEmails(env,n.order_id);return json({ok:true});
}
