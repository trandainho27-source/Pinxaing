import type {Customer,Staff,RuntimeEnv} from './types.ts';
import {all,first,stmt,now,fail,json,str,integer,body,audit,limit,transactionGuard} from './api-common.ts';
import {uid} from './security.ts';
import {settleOrder} from './order-payment.ts';
import {deliverOrderEmails} from './order-notifications.ts';
const methods=['wechat','alipay','usdt'];
const topupFields='id,amount,method,status,note,review_note,created_at,reviewed_at';
export async function customerWallet(db:D1Database,env:RuntimeEnv,request:Request,path:string,c:Customer,url:URL){
    if(request.method==='GET'&&path==='customer/wallet'){
        const page=Math.max(1,Math.min(10000,Math.trunc(Number(url.searchParams.get('page')))||1));
        return json({balance:(await first<any>(db,'SELECT balance FROM wallet_accounts WHERE customer_id=?',c.id))?.balance||0,
            ledger:await all(db,'SELECT id,kind,delta,balance_after,order_id,topup_id,description,created_at FROM wallet_ledger WHERE customer_id=? ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?',c.id,(page-1)*20),
            ledger_total:(await first<any>(db,'SELECT count(*) AS n FROM wallet_ledger WHERE customer_id=?',c.id)).n,page,
            topups:await all(db,'SELECT '+topupFields+' FROM wallet_topups WHERE customer_id=? ORDER BY created_at DESC LIMIT 50',c.id),
            instructions:(await first<any>(db,"SELECT value FROM settings WHERE key='rechargeInstructions'"))?.value||'请先提交充值申请，再联系客服确认收款方式。店主核实到账后充值才会入账。',demo:!!c.is_demo});
    }
    if(request.method!=='POST')fail(404,'余额接口不存在');
    const b=await body(request);
    if(path==='customer/wallet/topup'){
        const amount=integer(b.amount,100,1000000),method=str(b.method,20),key=str(b.request_key,64),note=str(b.note,300);
        if(!methods.includes(method)||!/^[a-f0-9]{64}$/.test(key))fail(400,'请选择充值方式并重新提交申请');
        const existing=await first<any>(db,'SELECT * FROM wallet_topups WHERE customer_id=? AND request_key=?',c.id,key);
        if(existing){if(existing.amount!==amount||existing.method!==method||existing.note!==note)fail(409,'同一申请凭证不能用于不同充值');return json({ok:true,id:existing.id,idempotent:true});}
        await limit(db,request,'wallet-topup:'+c.id,5);
        const id='RC'+uid().replaceAll('-','').slice(0,20).toUpperCase();
        try{await db.batch([
            ...transactionGuard(db,"(SELECT count(*) FROM wallet_topups WHERE customer_id=? AND status='pending')<5 AND EXISTS(SELECT 1 FROM customers WHERE id=? AND active=1)",c.id,c.id),
            stmt(db,'INSERT INTO wallet_topups(id,customer_id,amount,method,request_key,note,created_at) VALUES(?,?,?,?,?,?,?)',id,c.id,amount,method,key,note,now()),audit(db,c.id,'wallet.topup.request',id,'客户提交充值申请')
        ]);}catch{const duplicate=await first<any>(db,'SELECT id,amount,method,note FROM wallet_topups WHERE customer_id=? AND request_key=?',c.id,key);if(duplicate&&duplicate.amount===amount&&duplicate.method===method&&duplicate.note===note)return json({ok:true,id:duplicate.id,idempotent:true});fail(409,'待处理申请最多 5 笔，请先处理已有申请');}
        return json({ok:true,id},201);
    }
    if(path==='customer/wallet/cancel'){
        const id=str(b.id,64);const changed=await stmt(db,"UPDATE wallet_topups SET status='cancelled',reviewed_at=? WHERE id=? AND customer_id=? AND status='pending'",now(),id,c.id).run();
        if(!changed.meta.changes)fail(409,'该申请已处理或不属于当前账号');return json({ok:true});
    }
    if(path==='customer/wallet/pay'){
        await limit(db,request,'wallet-pay:'+c.id,15);const id=str(b.id,64);
        if(!await first(db,"SELECT id FROM orders WHERE id=? AND customer_id=? AND demo=? AND ready=1",id,c.id,env.DEMO_MODE==='true'?1:0))fail(404,'订单不存在或不属于当前账号');
        const result=await settleOrder(db,id,c.id,'客户确认余额支付','balance','balance:'+id,undefined,c.id);
        await deliverOrderEmails(env,id);return json(result);
    }
    fail(404,'余额接口不存在');
}
export async function adminWallet(db:D1Database,env:RuntimeEnv,request:Request,staff:Staff,url:URL){
    if(request.method==='GET'){
        const page=Math.max(1,Math.min(10000,Math.trunc(Number(url.searchParams.get('page')))||1)),status=str(url.searchParams.get('status'),20);
        const where=" FROM wallet_topups t JOIN customers c ON c.id=t.customer_id WHERE c.is_demo=? AND (?='' OR t.status=?)",args=[env.DEMO_MODE==='true'?1:0,status,status];
        return json({topups:await all(db,'SELECT t.*,c.email,c.display_name,coalesce(w.balance,0) AS balance'+where.replace(' WHERE',' LEFT JOIN wallet_accounts w ON w.customer_id=c.id WHERE')+' ORDER BY t.created_at DESC LIMIT 50 OFFSET ?',...args,(page-1)*50),
            total:(await first<any>(db,'SELECT count(*) AS n'+where,...args)).n,page,
            stats:await first(db,`SELECT coalesce(sum(w.balance),0) AS total_balance FROM wallet_accounts w JOIN customers c ON c.id=w.customer_id WHERE c.is_demo=?`,env.DEMO_MODE==='true'?1:0),
            ledger:await all(db,'SELECT l.*,c.email FROM wallet_ledger l JOIN customers c ON c.id=l.customer_id WHERE c.is_demo=? ORDER BY l.created_at DESC,l.id DESC LIMIT 100',env.DEMO_MODE==='true'?1:0)});
    }
    const b=await body(request),id=str(b.id,64),reason=str(b.reason,300),action=str(b.action,20),reference=str(b.reference,100).toLowerCase();
    if(!['approve','reject'].includes(action)||reason.length<5)fail(400,'请选择处理操作并填写至少 5 个字的处理依据');
    const t=await first<any>(db,'SELECT t.*,c.is_demo,c.active FROM wallet_topups t JOIN customers c ON c.id=t.customer_id WHERE t.id=?',id);
    if(!t||t.is_demo!==(env.DEMO_MODE==='true'?1:0))fail(404,'充值申请不存在');
    if(action==='approve'&&!reference)fail(400,'核实到账后请填写唯一收款流水号');
    if(t.status==='approved'&&action==='approve'&&t.reference===reference)return json({ok:true,idempotent:true});
    if(t.status!=='pending')fail(409,'该申请已经处理，请刷新核对');
    if(!t.active&&action==='approve')fail(409,'客户账号已停用，请先核实账号状态');
    const ts=now(),st:D1PreparedStatement[]=[...transactionGuard(db,"EXISTS(SELECT 1 FROM wallet_topups WHERE id=? AND status='pending')",id)];
    if(action==='approve')st.push(
        ...transactionGuard(db,"NOT EXISTS(SELECT 1 FROM orders WHERE payment_provider IN('manual','demo-manual') AND lower(payment_ref)=?)",reference),
        ...transactionGuard(db,'EXISTS(SELECT 1 FROM customers WHERE id=? AND active=1)',t.customer_id),
        stmt(db,'INSERT INTO wallet_accounts(customer_id,balance,updated_at) VALUES(?,?,?) ON CONFLICT(customer_id) DO UPDATE SET balance=balance+excluded.balance,updated_at=excluded.updated_at',t.customer_id,t.amount,ts),
        stmt(db,`INSERT INTO wallet_ledger(id,event_key,customer_id,kind,delta,balance_after,topup_id,description,created_at) SELECT ?,?,customer_id,'topup',?,balance,?,?,? FROM wallet_accounts WHERE customer_id=?`,uid(),'topup:'+id,t.amount,id,'充值到账',ts,t.customer_id));
    st.push(stmt(db,'UPDATE wallet_topups SET status=?,reference=?,review_note=?,actor=?,reviewed_at=? WHERE id=?',action==='approve'?'approved':'rejected',action==='approve'?reference:null,reason,staff.id,ts,id),audit(db,staff.id,'wallet.topup.'+action,id,reason));
    try{await db.batch(st);}catch{fail(409,'申请已处理、收款流水号重复或余额超限，请刷新核对；未重复入账');}
    return json({ok:true});
}
