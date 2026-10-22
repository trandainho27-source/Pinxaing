import {test} from 'node:test';
import assert from 'node:assert/strict';
import {client,fixture,login,cart,row} from './account-support.ts';
import {handleApi} from '../lib/commerce/api.ts';
import {deliverOrderEmails} from '../lib/commerce/order-notifications.ts';
const reason='测试核实到账，不涉及真实资金';
const key=()=>crypto.randomUUID().replaceAll('-','').repeat(2);
async function account(){const s=await fixture(),buyer=client(s.env),customer=await login(buyer);return {...s,buyer,customer};}
// Historical records are inserted only into this isolated fixture: the public
// manual application route is retired. Existing records still need safe handling.
function legacyTopup(s:any,amount:number){
 const id='legacy-'+crypto.randomUUID();s.db.raw.prepare('INSERT INTO wallet_topups(id,customer_id,amount,method,request_key,created_at) VALUES(?,?,?,?,?,?)').run(id,s.customer.id,amount,'alipay',key(),Date.now());return {id};
}
async function fund(s:any,amount:number,reference=key()){
 const topup=legacyTopup(s,amount);
 const result=await s.admin('admin/wallet',{id:topup.id,action:'approve',reference,reason});assert.equal(result.r.status,200,JSON.stringify(result.d));return topup.id;
}
async function production(){const s=await fixture();s.env.DEMO_MODE='false';s.db.raw.exec("UPDATE products SET is_example=0; UPDATE telegram_gifts SET is_example=0; UPDATE staff SET username='real-test-owner' WHERE id='demo-owner'");return s;}

test('other products waive shipping, mixed carts charge once, and existing orders keep their snapshot',async()=>{
 const s=await fixture(),other=s.catalog.products[1];
 assert.equal((await s.admin('admin/products',{...other,shipping_class:'other'})).r.status,200);
 const free=(await s.guest('orders',cart(other.id,{items:[{id:other.id,quantity:2}],shipping_fee:2000,total:1}))).d;
 assert.equal(free.shipping_fee,0);assert.equal(free.total,other.price*2);assert.equal(free.items[0].shipping_exempt,1);assert.equal(free.telegram_gift,null);
 const mixed=(await s.guest('orders',cart(other.id,{items:[{id:other.id,quantity:1},{id:s.p.id,quantity:2}],shipping_fee:0}))).d;
 assert.equal(mixed.shipping_fee,2000);assert.equal(mixed.total,other.price+s.p.price*2+2000);
 await s.admin('admin/products',{...other,shipping_class:'standard'});
 const replay=(await s.guest('orders/lookup',{id:free.id,secret:free.secret})).d;assert.equal(replay.shipping_fee,0);
 assert.equal((await s.guest('orders/demo-pay',{id:free.id,secret:free.secret})).d.total,free.total);
 assert.equal((await s.guest('orders',cart(other.id))).d.shipping_fee,2000);
 assert.equal((await s.admin('admin/products',{...other,shipping_class:'invalid'})).r.status,400);
});
test('shipping changes during checkout roll back the reservation and order atomically',async()=>{
 const s=await fixture(),batch=s.db.batch.bind(s.db);let intercept=true;
 s.db.batch=async(q:any)=>{if(intercept&&q.some((x:any)=>x.sql.includes('INSERT INTO orders'))){intercept=false;s.db.raw.prepare("UPDATE products SET shipping_class='other' WHERE id=?").run(s.p.id);}return batch(q);};
 assert.equal((await s.guest('orders',cart(s.p.id))).r.status,409);
 assert.equal(row(s,'SELECT count(*) AS n FROM orders').n,0);assert.equal(row(s,'SELECT available FROM physical_stock WHERE product_id=?',s.p.id).available,20);assert.equal(row(s,"SELECT count(*) AS n FROM telegram_gifts WHERE status='assigned'").n,0);
});
test('historical manual topups remain reviewable and cannot reuse payment receipts',async()=>{
 const s=await account(),t={d:legacyTopup(s,10000)};assert.equal((await s.buyer('customer/wallet')).d.balance,0);
 const approval={id:t.d.id,action:'approve',reference:'Receipt-001',reason};
 const race=await Promise.all([s.admin('admin/wallet',approval),s.admin('admin/wallet',approval)]);assert.ok(race.some(x=>x.r.status===200));assert.ok(race.every(x=>[200,409].includes(x.r.status)));
 assert.equal((await s.admin('admin/wallet',approval)).d.idempotent,true);assert.equal((await s.buyer('customer/wallet')).d.balance,10000);assert.equal(row(s,'SELECT count(*) AS n FROM wallet_ledger').n,1);
 const t2=legacyTopup(s,10000);
 assert.equal((await s.admin('admin/wallet',{...approval,id:t2.id,reference:'receipt-001'})).r.status,409);assert.equal(row(s,'SELECT status FROM wallet_topups WHERE id=?',t2.id).status,'pending');assert.equal((await s.buyer('customer/wallet')).d.balance,10000);
 const overview=(await s.admin('admin/wallet?status=approved')).d;assert.equal(overview.total,1);assert.equal(overview.stats.total_balance,10000);
});
test('wallet requires active authenticated ownership, CSRF, owner approval and valid integer amounts',async()=>{
 const s=await account();assert.equal((await s.guest('customer/wallet')).r.status,401);
 assert.equal((await s.buyer('customer/wallet/recharge',{amount:100,method:'wechat',request_key:key()},{'x-csrf-token':'bad'})).r.status,403);
 for(const amount of [0,-100,99,100.5,1000001,'100'])assert.equal((await s.buyer('customer/wallet/recharge',{amount,method:'alipay',request_key:key()})).r.status,400);
 const id=await fund(s,10000);await s.admin('admin/staff',{username:'wallet-operator',password:'operator-password-2026',role:'operator'});const operator=client(s.env);await operator('auth/login',{username:'wallet-operator',password:'operator-password-2026'});
 assert.equal((await operator('admin/wallet')).r.status,403);assert.equal((await operator('admin/wallet',{id,action:'approve',reference:'x',reason})).r.status,403);
 const other=client(s.env);await login(other);const order=(await s.buyer('orders',cart(s.p.id))).d;
 assert.equal((await other('customer/wallet/pay',{id:order.id})).r.status,404);assert.equal((await other('customer/wallet')).d.balance,0);
 await s.admin('admin/customers',{id:s.customer.id,active:false,reason});assert.equal((await s.buyer('customer/wallet')).r.status,401);
});
test('cancelled and rejected topups cannot be credited; approval/cancel race has one outcome',async()=>{
 const s=await account(),make=async()=>legacyTopup(s,1000).id;
 const first=await make();await s.buyer('customer/wallet/cancel',{id:first});assert.equal((await s.admin('admin/wallet',{id:first,action:'approve',reference:key(),reason})).r.status,409);
 const second=await make();await s.admin('admin/wallet',{id:second,action:'reject',reason});assert.equal((await s.admin('admin/wallet',{id:second,action:'approve',reference:key(),reason})).r.status,409);
 const third=await make();await Promise.all([s.admin('admin/wallet',{id:third,action:'approve',reference:key(),reason}),s.buyer('customer/wallet/cancel',{id:third})]);
 const state=row(s,'SELECT status FROM wallet_topups WHERE id=?',third).status;assert.ok(['approved','cancelled'].includes(state));assert.equal((await s.buyer('customer/wallet')).d.balance,state==='approved'?1000:0);
});
test('one external receipt cannot fund both a topup and an ordinary order',async()=>{
 const s=await account(),o=(await s.buyer('orders',cart(s.p.id))).d;await fund(s,10000,'SHARED-RECEIPT');
 assert.equal((await s.admin('admin/orders',{id:o.id,reference:'shared-receipt',reason})).r.status,409);assert.equal(row(s,'SELECT status FROM orders WHERE id=?',o.id).status,'pending');
 await s.admin('admin/orders',{id:o.id,reference:'ORDER-RECEIPT',reason});const t=legacyTopup(s,10000);
 assert.equal((await s.admin('admin/wallet',{id:t.id,action:'approve',reference:'order-receipt',reason})).r.status,409);assert.equal((await s.buyer('customer/wallet')).d.balance,10000);
});
test('balance debit and ledger roll back when reserved stock cannot be committed',async()=>{
 const s=await account();await fund(s,100000);const o=(await s.buyer('orders',cart(s.p.id))).d;
 s.db.raw.prepare("UPDATE physical_reservations SET status='released' WHERE order_id=?").run(o.id);
 assert.equal((await s.buyer('customer/wallet/pay',{id:o.id})).r.status,409);assert.equal((await s.buyer('customer/wallet')).d.balance,100000);assert.equal(row(s,"SELECT count(*) AS n FROM wallet_ledger WHERE kind='purchase'").n,0);assert.equal(row(s,'SELECT status FROM orders WHERE id=?',o.id).status,'pending');
});
test('balance payment and refund atomically update stock, gift gate and exactly one ledger entry',async()=>{
 const s=await account();await fund(s,100000);const o=(await s.buyer('orders',cart(s.p.id,{payment_method:'balance'}))).d;
 assert.equal(o.telegram_gift,null);assert.equal((await s.buyer('customer/wallet')).d.balance,100000);
 const results=await Promise.all([s.buyer('customer/wallet/pay',{id:o.id}),s.buyer('customer/wallet/pay',{id:o.id})]);assert.ok(results.some(x=>x.r.status===200));assert.ok(results.every(x=>[200,409].includes(x.r.status)));
 assert.equal((await s.buyer('customer/wallet/pay',{id:o.id})).d.idempotent,true);const paid=(await s.buyer('orders/lookup',{id:o.id})).d;
 assert.equal(paid.status,'paid');assert.equal(paid.shipping_status,'pending');assert.equal(paid.telegram_gift_unlocked,true);assert.ok(paid.telegram_gift);assert.equal((await s.buyer('customer/wallet')).d.balance,100000-o.total);
 assert.equal(row(s,'SELECT sold FROM physical_stock WHERE product_id=?',s.p.id).sold,1);assert.equal(row(s,"SELECT count(*) AS n FROM wallet_ledger WHERE kind='purchase'").n,1);
 const refunds=await Promise.all([s.admin('admin/orders',{id:o.id,action:'refund',reason}),s.admin('admin/orders',{id:o.id,action:'refund',reason})]);assert.ok(refunds.some(x=>x.r.status===200));
 assert.equal((await s.admin('admin/orders',{id:o.id,action:'refund',reason})).d.idempotent,true);assert.equal((await s.buyer('customer/wallet')).d.balance,100000);assert.equal(row(s,"SELECT count(*) AS n FROM wallet_ledger WHERE kind='refund'").n,1);assert.equal(row(s,'SELECT status FROM orders WHERE id=?',o.id).status,'refunded');
 assert.equal(row(s,'SELECT status FROM telegram_gifts WHERE order_id=?',o.id).status,'assigned');assert.equal(row(s,'SELECT sold FROM physical_stock WHERE product_id=?',s.p.id).sold,1);
});
test('concurrent orders cannot overspend balance; insufficient and expired orders stay unpaid',async()=>{
 const s=await account(),a=(await s.buyer('orders',cart(s.p.id))).d,b=(await s.buyer('orders',cart(s.p.id))).d;
 assert.equal((await s.buyer('customer/wallet/pay',{id:a.id})).r.status,409);assert.equal(row(s,'SELECT status FROM orders WHERE id=?',a.id).status,'pending');
 await fund(s,a.total);const result=await Promise.all([s.buyer('customer/wallet/pay',{id:a.id}),s.buyer('customer/wallet/pay',{id:b.id})]);assert.deepEqual(result.map(x=>x.r.status).sort(),[200,409]);assert.equal((await s.buyer('customer/wallet')).d.balance,0);assert.equal(row(s,"SELECT count(*) AS n FROM wallet_ledger WHERE kind='purchase'").n,1);
 const c=(await s.buyer('orders',cart(s.p.id))).d;await fund(s,c.total);s.db.raw.prepare('UPDATE orders SET expires_at=? WHERE id=?').run(Date.now()-1,c.id);assert.equal((await s.buyer('customer/wallet/pay',{id:c.id})).r.status,409);assert.equal((await s.buyer('customer/wallet')).d.balance,c.total);
});
test('manual receipt and cancellation races cannot leave a debit on an unpaid order',async()=>{
 for(const action of ['manual','cancel']){
  const s=await account();await fund(s,100000);const o=(await s.buyer('orders',cart(s.p.id))).d;
  await Promise.all([s.buyer('customer/wallet/pay',{id:o.id}),action==='manual'?s.admin('admin/orders',{id:o.id,reference:key(),reason}):s.buyer('orders/cancel',{id:o.id})]);
  const saved=row(s,'SELECT status,payment_provider FROM orders WHERE id=?',o.id),debit=row(s,"SELECT count(*) AS n FROM wallet_ledger WHERE kind='purchase'").n;
  assert.equal(debit,saved.payment_provider==='balance'?1:0);assert.equal((await s.buyer('customer/wallet')).d.balance,100000-debit*o.total);if(debit)assert.equal(saved.status,'paid');else assert.ok(['paid','cancelled'].includes(saved.status));
 }
});
test('order emails are optional, validate addresses, separate created/paid, and exclude secrets',async()=>{
 const s=await production(),sent:any[]=[],original=globalThis.fetch;s.env.RESEND_API_KEY='fixture-mail-key';s.env.EMAIL_FROM='品香 <login@example.com>';
 globalThis.fetch=async(input,init)=>{assert.equal(input,'https://api.resend.com/emails');sent.push({body:JSON.parse(String(init!.body)),key:(init!.headers as any)['Idempotency-Key']});return Response.json({id:'fixture-'+sent.length});};
 try{
  assert.equal((await s.guest('orders',cart(s.p.id,{contact_email:'bad@'}))).r.status,400);
  const empty=(await s.guest('orders',cart(s.p.id))).d;assert.equal(empty.contact_email,'');assert.equal(sent.length,0);
  const payload=cart(s.p.id,{checkoutToken:key(),contact_email:' Buyer@Example.com ',shipping_address:'PRIVATE-ADDRESS'}),o=(await s.guest('orders',payload)).d;
  assert.equal(o.contact_email,'buyer@example.com');assert.equal(sent.length,1);assert.match(sent[0].body.subject,/订单已创建/);assert.match(sent[0].body.text,/不代表付款成功/);assert.deepEqual(sent[0].body.to,['buyer@example.com']);
  assert.equal((await s.guest('orders',payload)).d.id,o.id);assert.equal(sent.length,1);
  await s.admin('admin/orders',{id:o.id,reference:key(),reason});assert.equal(sent.length,2);assert.match(sent[1].body.subject,/购买成功（已付款）/);assert.notEqual(sent[0].key,sent[1].key);
  const text=JSON.stringify(sent);for(const secret of [o.secret,'PRIVATE-ADDRESS','DEMO-TELEGRAM-'])assert.ok(!text.includes(secret));
  await deliverOrderEmails(s.env,o.id);assert.equal(sent.length,2);assert.equal(row(s,"SELECT count(*) AS n FROM order_notifications WHERE status='sent'").n,2);
 }finally{globalThis.fetch=original;}
});
test('email failures never undo orders or payments, retries freeze payload and prevent duplicate sends',async()=>{
 const s=await production(),original=globalThis.fetch,calls:any[]=[];s.env.RESEND_API_KEY='fixture-mail-key';s.env.EMAIL_FROM='login@example.com';let fail=true;
 globalThis.fetch=async(_input,init)=>{calls.push({body:init!.body,key:(init!.headers as any)['Idempotency-Key']});if(fail)throw Error('timeout');return Response.json({id:'mock-accepted'});};
 try{
  const result=await s.guest('orders',cart(s.p.id,{contact_email:'buyer@example.com'}));assert.equal(result.r.status,201);const o=result.d;
  assert.equal(row(s,'SELECT status FROM order_notifications WHERE order_id=?',o.id).status,'failed');assert.equal(row(s,'SELECT status FROM orders WHERE id=?',o.id).status,'pending');
  fail=false;s.env.EMAIL_FROM='changed@example.com';s.db.raw.prepare('UPDATE order_notifications SET next_attempt_at=0 WHERE order_id=?').run(o.id);
  await Promise.all([deliverOrderEmails(s.env,o.id),deliverOrderEmails(s.env,o.id)]);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(row(s,'SELECT status FROM order_notifications WHERE order_id=?',o.id).status,'sent');
  fail=true;assert.equal((await s.admin('admin/orders',{id:o.id,reference:key(),reason})).r.status,200);assert.equal(row(s,'SELECT status FROM orders WHERE id=?',o.id).status,'paid');
  s.db.raw.prepare("UPDATE order_notifications SET first_attempt_at=?,next_attempt_at=0 WHERE event='paid'").run(Date.now()-24*3600000);const before=calls.length;await deliverOrderEmails(s.env,o.id);assert.equal(calls.length,before);assert.equal(row(s,"SELECT status FROM order_notifications WHERE event='paid'").status,'review');assert.equal((await s.admin('admin/notifications',{id:o.id+':paid'})).r.status,409);
 }finally{globalThis.fetch=original;}
});
test('missing email configuration leaves an actionable outbox and demo orders never send',async()=>{
 const s=await production(),o=(await s.guest('orders',cart(s.p.id,{contact_email:'buyer@example.com'}))).d;assert.equal(row(s,'SELECT status FROM order_notifications WHERE order_id=?',o.id).status,'blocked');assert.equal((await s.admin('admin/notifications')).d.notifications[0].recipient,'buyer@example.com');assert.equal((await s.guest('admin/notifications')).r.status,401);
 const demo=await fixture();await demo.guest('orders',cart(demo.p.id,{contact_email:'buyer@example.com'}));assert.equal(row(demo,'SELECT count(*) AS n FROM order_notifications').n,0);
});
test('product galleries save, reorder and remove images while rejecting unsafe or missing assets',async()=>{
 const s=await fixture(),images=['https://images.example/a.jpg','https://images.example/b.png'];assert.equal((await s.admin('admin/products',{...s.p,images})).r.status,200);
 assert.equal(row(s,'SELECT image_url FROM products WHERE id=?',s.p.id).image_url,images[0]);assert.deepEqual(JSON.parse(row(s,'SELECT images_json FROM products WHERE id=?',s.p.id).images_json),images);
 await s.admin('admin/products',{...s.p,images:[images[1],images[0]]});assert.equal((await s.guest('catalog')).d.products.find((p:any)=>p.id===s.p.id).image_url,images[1]);
 for(const bad of [['javascript:alert(1)'],['data:image/png;base64,AA'],['http://insecure.example/a.jpg'],['/api/media/'+crypto.randomUUID()],Array(9).fill(images[0])])assert.equal((await s.admin('admin/products',{...s.p,images:bad})).r.status,400);
 await s.admin('admin/products',{...s.p,images:[]});assert.equal(row(s,'SELECT image_url FROM products WHERE id=?',s.p.id).image_url,'');
});
test('image uploads require staff, CSRF and actual image bytes; R2 images are served without bucket keys',async()=>{
 const s=await fixture(),objects=new Map<string,Uint8Array>(),png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=','base64'));
 s.env.BUCKET={put:async(k:string,b:Uint8Array)=>{objects.set(k,b);},get:async(k:string)=>objects.has(k)?{body:objects.get(k),httpEtag:'"fixture-etag"'}:null,delete:async(k:string)=>objects.delete(k)};
 assert.equal((await s.guest('admin/media/upload',png,{'content-type':'image/png'})).r.status,401);
 assert.equal((await s.admin('admin/media/upload',png,{'content-type':'image/png','x-csrf-token':'bad'})).r.status,403);
 assert.equal((await s.admin('admin/media/upload',new TextEncoder().encode('<svg/>'),{'content-type':'image/png'})).r.status,400);
 assert.equal((await s.admin('admin/media/upload',png,{'content-type':'image/png','content-length':String(6*1024*1024)})).r.status,413);
 const uploaded=await s.admin('admin/media/upload',png,{'content-type':'image/png'});assert.equal(uploaded.r.status,201,JSON.stringify(uploaded.d));assert.equal(objects.size,1);assert.ok(!JSON.stringify(uploaded.d).includes('product-images/'));
 const response=await handleApi(new Request('https://store.test'+uploaded.d.url),s.env);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),png);
 assert.equal((await s.admin('admin/products',{...s.p,images:[uploaded.d.url]})).r.status,200);
 delete s.env.BUCKET;assert.equal((await s.admin('admin/products')).d.media_ready,false);assert.equal((await s.admin('admin/media/upload',png,{'content-type':'image/png'})).r.status,503);
});
