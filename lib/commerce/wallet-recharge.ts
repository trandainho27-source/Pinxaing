import type {Customer} from './types.ts';
import {first,stmt,now,fail,integer,str,transactionGuard,audit} from './api-common.ts';
import {uid} from './security.ts';
import {paymentMethods,type PaymentMethod} from './payment-providers.ts';

export function rechargeInput(body:any){
 const amount=integer(body.amount,100,1000000),method=str(body.method,20),requestKey=str(body.request_key,64);
 if(!paymentMethods.some(p=>p.id===method)||!/^[a-f0-9]{64}$/.test(requestKey))fail(400,'请选择充值方式并重新提交');
 return {amount,method:method as PaymentMethod,requestKey};
}
// Server-side payment adapters may create an invoice after being configured.
// The production public route remains unavailable until such an adapter exists.
export async function createRechargeOrder(db:D1Database,customer:Customer,input:ReturnType<typeof rechargeInput>,demo=false){
 if(!!customer.is_demo!==demo)fail(403,'充值环境不匹配');
 const flow=demo?'demo':'online';
 const previous=async()=>{
  const old=await first<any>(db,'SELECT id,amount,method,status,expires_at,flow FROM wallet_topups WHERE customer_id=? AND request_key=?',customer.id,input.requestKey);
  if(!old)return null;if(old.amount!==input.amount||old.method!==input.method||old.flow!==flow)fail(409,'同一付款凭证不能用于不同充值');
  return {...old,demo,idempotent:true};
 };
 const old=await previous();if(old)return old;
 const id='RC'+uid().replaceAll('-','').slice(0,20).toUpperCase(),ts=now(),expires=ts+30*60000;
 try{await db.batch([
  ...transactionGuard(db,"EXISTS(SELECT 1 FROM customers WHERE id=? AND active=1 AND is_demo=?) AND (SELECT count(*) FROM wallet_topups WHERE customer_id=? AND flow=? AND status='pending')<5",customer.id,demo?1:0,customer.id,flow),
  stmt(db,"INSERT INTO wallet_topups(id,customer_id,amount,method,request_key,flow,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)",id,customer.id,input.amount,input.method,input.requestKey,flow,expires,ts),
  audit(db,customer.id,'wallet.recharge.created',id,demo?'演示充值单':'在线充值单')
 ]);}catch{const duplicate=await previous();if(duplicate)return duplicate;fail(409,'待支付充值单过多或账号状态已变化，请刷新后重试');}
 return {id,amount:input.amount,method:input.method,status:'pending',expires_at:expires,flow,demo};
}
export interface VerifiedRechargeReceipt {rechargeId:string;method:PaymentMethod;reference:string;amount:number;currency:'CNY';paidAt:number;}
// Call only with a receipt verified by a server-side provider adapter (signature /
// provider query, merchant, amount and currency). Never accept browser "paid" fields.
// USDT adapters must verify the locked quote before supplying its CNY amount.
export async function settleRecharge(db:D1Database,receipt:VerifiedRechargeReceipt,demo=false){
 const r=receipt,reference=str(r.reference,100).toLowerCase();
 if(typeof r.reference!=='string'||!reference||reference!==r.reference.trim().toLowerCase()||r.reference.length>100||r.currency!=='CNY'||!Number.isSafeInteger(r.amount)||r.amount<100||!Number.isSafeInteger(r.paidAt)||r.paidAt>now()+60000)fail(400,'充值付款凭证无效');
 const t=await first<any>(db,'SELECT t.*,c.is_demo,c.active FROM wallet_topups t JOIN customers c ON c.id=t.customer_id WHERE t.id=?',r.rechargeId);
 if(!t||t.flow!==(demo?'demo':'online')||t.is_demo!==(demo?1:0))fail(404,'充值订单不存在');
 if(t.amount!==r.amount||t.method!==r.method||r.paidAt<t.created_at||r.paidAt>t.expires_at)fail(409,'充值金额、方式或付款时间不匹配，请核对支付记录');
 if(t.status==='approved'){if(t.reference===reference)return {ok:true,idempotent:true};fail(409,'充值订单已有其他到账记录');}
 const ts=now();
 try{await db.batch([
  ...transactionGuard(db,"EXISTS(SELECT 1 FROM wallet_topups t JOIN customers c ON c.id=t.customer_id WHERE t.id=? AND t.flow=? AND t.status IN('pending','expired') AND c.active=1)",t.id,t.flow),
  ...transactionGuard(db,"NOT EXISTS(SELECT 1 FROM orders WHERE payment_provider IN('manual','demo-manual') AND lower(payment_ref)=?)",reference),
  stmt(db,'INSERT INTO wallet_accounts(customer_id,balance,updated_at) VALUES(?,?,?) ON CONFLICT(customer_id) DO UPDATE SET balance=balance+excluded.balance,updated_at=excluded.updated_at',t.customer_id,t.amount,ts),
  stmt(db,`INSERT INTO wallet_ledger(id,event_key,customer_id,kind,delta,balance_after,topup_id,description,created_at) SELECT ?,?,customer_id,'topup',?,balance,?,?,? FROM wallet_accounts WHERE customer_id=?`,uid(),'topup:'+t.id,t.amount,t.id,demo?'演示充值到账':'在线充值到账',ts,t.customer_id),
  stmt(db,"UPDATE wallet_topups SET status='approved',reference=?,paid_at=?,reviewed_at=?,actor=? WHERE id=?",reference,r.paidAt,ts,demo?'demo-payment':'payment:'+r.method,t.id),
  audit(db,demo?'demo-payment':'payment:'+r.method,'wallet.recharge.paid',t.id,'付款凭证核验通过，余额入账')
 ]);}catch{const done=await first<any>(db,'SELECT status,reference FROM wallet_topups WHERE id=?',t.id);if(done?.status==='approved'&&done.reference===reference)return {ok:true,idempotent:true};fail(409,'到账记录重复或账户状态已变化，未重复增加余额');}
 return {ok:true};
}
