import {test} from 'node:test';
import assert from 'node:assert/strict';
import {client,fixture,login,cart,row} from './account-support.ts';
import {createRechargeOrder,rechargeInput,settleRecharge} from '../lib/commerce/wallet-recharge.ts';
const key=()=>crypto.randomUUID().replaceAll('-','').repeat(2);
const payload=()=>({amount:10000,method:'alipay',request_key:key()});
const reason='隔离测试核对，不涉及真实资金';
async function account(real=false){
 const s=await fixture(),buyer=client(s.env),customer=await login(buyer);
 if(real){s.env.DEMO_MODE='false';s.db.raw.exec("UPDATE customers SET is_demo=0,verified_at=1; UPDATE staff SET username='real-test-owner' WHERE id='demo-owner'");customer.is_demo=0;}
 return {...s,buyer,customer};
}
async function invoice(s:any){return createRechargeOrder(s.db,s.customer,rechargeInput(payload()));}
const receipt=(t:any,extra:any={})=>({rechargeId:t.id,amount:t.amount,method:t.method,reference:key(),currency:'CNY' as const,paidAt:Date.now(),...extra});
const error=(status:number)=>(e:any)=>e.status===status;

test('category names, product tags, custom icons and homepage labels save independently of postage',async()=>{
 const s=await fixture(),category=s.catalog.categories[0];
 assert.equal((await s.admin('admin/categories',{...category,name:'自选分类',icon:'text:香'})).r.status,200);
 assert.equal((await s.admin('admin/products',{...s.p,category_id:category.id,tag:'独立标签',icon_key:'text:🟣',featured:true,shipping_class:'standard'})).r.status,200);
 assert.equal((await s.admin('admin/settings',{heroTitle:'按需选购',catalogTitle:'商品目录',otherCategoryLabel:'附加商品'})).r.status,200);
 const catalog=(await s.guest('catalog')).d,p=catalog.products.find((x:any)=>x.id===s.p.id);
 assert.equal(catalog.categories.find((x:any)=>x.id===category.id).name,'自选分类');assert.equal(p.tag,'独立标签');assert.equal(p.icon_key,'text:🟣');assert.equal(p.featured,1);assert.equal(catalog.settings.otherCategoryLabel,'附加商品');
 assert.equal((await s.guest('orders',cart(p.id))).d.shipping_fee,2000);
 for(const icon of ['text:','text:<b>','text:\n','text:123456789','unsupported-icon']){
  assert.equal((await s.admin('admin/categories',{...category,icon})).r.status,400);
  assert.equal((await s.admin('admin/products',{...s.p,icon_key:icon})).r.status,400);
 }
 assert.equal((await s.guest('admin/categories',{...category,name:'unauthorized'})).r.status,401);
});

test('formal recharge stays unavailable; retired applications and simulated or forged payments cannot credit funds',async()=>{
 const s=await account(true),input=payload();
 const wallet=(await s.buyer('customer/wallet')).d;assert.equal(wallet.mode,'unavailable');assert.equal(wallet.recharge_enabled,false);
 assert.equal((await s.buyer('customer/wallet/topup',input)).r.status,410);
 assert.equal((await s.buyer('customer/wallet/recharge',{...input,paid:true,status:'approved',reference:'fake'})).r.status,503);
 assert.equal((await s.buyer('customer/wallet/recharge/demo-pay',{id:'forged'})).r.status,403);
 for(const method of ['wechat','alipay','usdt'])assert.equal((await s.guest('payments/webhook/'+method,{...input,status:'paid'})).r.status,503);
 assert.equal(row(s,'SELECT count(*) AS n FROM wallet_topups').n,0);assert.equal(row(s,'SELECT count(*) AS n FROM wallet_ledger').n,0);assert.equal((await s.buyer('customer/wallet')).d.balance,0);
});

test('demo direct recharge needs its own payment, credits once and pays an owned order',async()=>{
 const s=await account(),input=payload();
 assert.equal((await s.buyer('customer/wallet/topup',input)).r.status,410);
 const t=await s.buyer('customer/wallet/recharge',input);assert.equal(t.r.status,201);assert.equal(t.d.flow,'demo');assert.equal((await s.buyer('customer/wallet')).d.balance,0);
 assert.equal((await s.buyer('customer/wallet/recharge',input)).d.id,t.d.id);
 assert.equal((await s.buyer('customer/wallet/recharge',{...input,amount:20000})).r.status,409);
 assert.equal((await s.admin('admin/wallet',{id:t.d.id,action:'approve',reference:key(),reason})).r.status,409);
 const stranger=client(s.env);await login(stranger);assert.equal((await stranger('customer/wallet/recharge/demo-pay',{id:t.d.id})).r.status,404);
 assert.equal((await s.buyer('customer/wallet/recharge/demo-pay',{id:t.d.id},{'x-csrf-token':'bad'})).r.status,403);
 assert.equal((await s.buyer('customer/wallet/recharge/demo-pay',{id:t.d.id})).r.status,200);
 assert.equal((await s.buyer('customer/wallet/recharge/demo-pay',{id:t.d.id})).d.idempotent,true);assert.equal((await s.buyer('customer/wallet')).d.balance,input.amount);
 const o=(await s.buyer('orders',cart(s.p.id,{payment_method:'balance'}))).d;
 assert.equal((await s.buyer('customer/wallet/pay',{id:o.id})).r.status,200);assert.equal((await s.buyer('customer/wallet')).d.balance,input.amount-o.total);assert.equal(row(s,'SELECT count(*) AS n FROM wallet_ledger').n,2);
});

test('server recharge receipts are idempotent under concurrent delivery and references are globally unique',async()=>{
 const s=await account(true),t=await invoice(s),r=receipt(t);
 const outcomes=await Promise.all([settleRecharge(s.db as any,r),settleRecharge(s.db as any,r)]);assert.ok(outcomes.every(x=>x.ok));
 assert.equal((await settleRecharge(s.db as any,r)).idempotent,true);assert.equal((await s.buyer('customer/wallet')).d.balance,t.amount);assert.equal(row(s,'SELECT count(*) AS n FROM wallet_ledger').n,1);
 const t2=await invoice(s);await assert.rejects(settleRecharge(s.db as any,receipt(t2,{reference:r.reference.toUpperCase()})),error(409));
 assert.equal(row(s,'SELECT status FROM wallet_topups WHERE id=?',t2.id).status,'pending');assert.equal((await s.buyer('customer/wallet')).d.balance,t.amount);
 await assert.rejects(settleRecharge(s.db as any,receipt(t)),error(409));
});

test('mismatched amount, method, currency, timestamps and invalid receipts never credit a recharge',async()=>{
 const s=await account(true),t=await invoice(s),r=receipt(t);
 for(const extra of [{amount:t.amount+1},{amount:100.5},{method:'wechat'},{currency:'USD'},{paidAt:0},{paidAt:t.expires_at+1},{paidAt:Date.now()+120000},{reference:''},{reference:null},{reference:'a'.repeat(101)}]){
  await assert.rejects(settleRecharge(s.db as any,{...r,...extra} as any),(e:any)=>[400,409].includes(e.status));
 }
 assert.equal((await s.buyer('customer/wallet')).d.balance,0);assert.equal(row(s,'SELECT count(*) AS n FROM wallet_ledger').n,0);
 await assert.rejects(settleRecharge(s.db as any,r,true),error(404));
 assert.equal((await s.admin('admin/wallet',{id:t.id,action:'approve',reference:key(),reason})).r.status,409);
});

test('a late verified notification credits only when actual payment was inside its invoice window',async()=>{
 const s=await account(true),t=await invoice(s),ts=Date.now();
 s.db.raw.prepare('UPDATE wallet_topups SET created_at=?,expires_at=? WHERE id=?').run(ts-7200000,ts-3600000,t.id);
 await s.guest('catalog');assert.equal(row(s,'SELECT status FROM wallet_topups WHERE id=?',t.id).status,'expired');
 await assert.rejects(settleRecharge(s.db as any,receipt(t)),error(409));
 await settleRecharge(s.db as any,receipt(t,{paidAt:ts-5400000}));assert.equal((await s.buyer('customer/wallet')).d.balance,t.amount);
});

test('closed invoices, disabled customers and balance limits roll back the complete recharge',async()=>{
 for(const scenario of ['cancelled','inactive','limit']){
  const s=await account(true),t=await invoice(s);
  if(scenario==='cancelled')s.db.raw.prepare("UPDATE wallet_topups SET status='cancelled' WHERE id=?").run(t.id);
  if(scenario==='inactive')s.db.raw.prepare('UPDATE customers SET active=0 WHERE id=?').run(s.customer.id);
  if(scenario==='limit')s.db.raw.prepare('INSERT INTO wallet_accounts(customer_id,balance,updated_at) VALUES(?,?,?)').run(s.customer.id,100000000,Date.now());
  await assert.rejects(settleRecharge(s.db as any,receipt(t)),error(409));
  assert.equal(row(s,'SELECT count(*) AS n FROM wallet_ledger').n,0);assert.equal(row(s,'SELECT reference FROM wallet_topups WHERE id=?',t.id).reference,null);
  assert.equal(row(s,'SELECT balance FROM wallet_accounts WHERE customer_id=?',s.customer.id)?.balance||0,scenario==='limit'?100000000:0);
 }
});

test('demo and real invoices cannot be interchanged and pending invoices are bounded',async()=>{
 const s=await account();await assert.rejects(createRechargeOrder(s.db as any,s.customer,rechargeInput(payload())),error(403));
 const orders=[];for(let i=0;i<5;i++){const t=await s.buyer('customer/wallet/recharge',payload());assert.equal(t.r.status,201);orders.push(t.d);}
 assert.equal((await s.buyer('customer/wallet/recharge',payload())).r.status,409);
 await assert.rejects(settleRecharge(s.db as any,receipt(orders[0])),error(404));
 s.db.raw.prepare('UPDATE wallet_topups SET expires_at=? WHERE id=?').run(Date.now()-1,orders[0].id);
 await s.guest('catalog');assert.equal((await s.buyer('customer/wallet/recharge',payload())).r.status,201);
 assert.equal((await s.buyer('customer/wallet')).d.balance,0);
});
