import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DB,client,fixture,login,cart,row,shipping} from './account-support.ts';
const reason='测试人员核对后的处理原因';
const credentials=(o:any)=>({id:o.id,secret:o.secret});
async function paid(s:any,extra:any=shipping){const o=(await s.guest('orders',cart(s.p.id,extra))).d;const r=await s.guest('orders/demo-pay',credentials(o));assert.equal(r.r.status,200);return {...r.d,secret:o.secret};}

test('email login fails closed without sender configuration; production rejects demo identities',async()=>{
 const s=await fixture();assert.equal((await s.guest('customer/session')).d.email_ready,false);
 assert.equal((await s.guest('customer/email/code',{email:'customer@example.com'})).r.status,503);
 assert.equal(row(s,'SELECT count(*) AS n FROM customers').n,0);
 const demo=client(s.env),ch=(await demo('customer/email/demo',{})).d;await login(demo);
 s.env.DEMO_MODE='false';assert.equal((await demo('customer/session')).d.customer,null);
 assert.equal((await demo('customer/email/demo',{})).r.status,403);
 assert.equal((await demo('customer/email/verify',{challenge_id:ch.challenge_id,code:ch.demo_code})).r.status,400);
});
test('email readiness follows current runtime configuration and keeps diagnostics private',async()=>{
 const s=await fixture();
 const initial=await s.guest('customer/session');assert.equal(initial.d.email_ready,false);assert.equal(initial.r.headers.get('cache-control'),'no-store');
 const missing=(await s.admin('admin/customers')).d.email_configuration;
 assert.deepEqual(missing.checks.map((c:any)=>[c.name,c.status]),[['RESEND_API_KEY','missing'],['EMAIL_FROM','missing'],['INVENTORY_KEY','configured']]);
 s.env.RESEND_API_KEY='private-runtime-fixture';s.env.EMAIL_FROM='品香 <login@auth.pinxiang.lol>';
 const current=(await s.guest('customer/session')).d;assert.equal(current.email_ready,true);assert.equal(current.email_configuration,undefined);
 const owner=await s.admin('admin/customers');assert.equal(owner.d.email_configuration.ready,true);assert.ok(owner.d.checked_at>0);
 for(const secret of [s.env.RESEND_API_KEY,s.env.INVENTORY_KEY])assert.ok(!JSON.stringify(owner.d).includes(secret));
 assert.equal((await s.guest('admin/customers')).r.status,401);
 await s.admin('admin/staff',{username:'mail-operator',password:'operator-password-2026',role:'operator'});
 const operator=client(s.env);assert.equal((await operator('auth/login',{username:'mail-operator',password:'operator-password-2026'})).r.status,200);assert.equal((await operator('admin/customers')).r.status,403);
 delete s.env.RESEND_API_KEY;assert.equal((await s.guest('customer/session')).d.email_ready,false);
 assert.equal((await s.guest('customer/email/code',{email:'buyer@example.com'})).r.status,503);
 assert.equal(row(s,'SELECT count(*) AS n FROM email_challenges').n,0);
});
test('invalid email configuration identifies the broken field without creating challenges or leaking its value',async()=>{
 const s=await fixture();s.env.RESEND_API_KEY='private-runtime-fixture';s.env.EMAIL_FROM='login@auth.pinxiang.lol';
 for(const [name,value] of [['INVENTORY_KEY','secret-that-is-not-64-hex'],['EMAIL_FROM','private-invalid-sender'],['RESEND_API_KEY','key-with-a\nnewline'],['RESEND_API_KEY',{binding:'not-a-runtime-secret'}]] as const){
  const previous=s.env[name];s.env[name]=value;
  const state=(await s.admin('admin/customers')).d.email_configuration;assert.equal(state.ready,false);assert.equal(state.checks.find((c:any)=>c.name===name).status,'invalid');
  assert.equal((await s.guest('customer/session')).d.email_ready,false);
  const result=await s.guest('customer/email/code',{email:'buyer@example.com'});assert.equal(result.r.status,503);
  assert.ok(!JSON.stringify(state).includes(typeof value==='string'?value:'not-a-runtime-secret'));s.env[name]=previous;
 }
 assert.equal(row(s,'SELECT count(*) AS n FROM email_challenges').n,0);
 assert.equal((await s.guest('customer/session')).d.email_ready,true);
});
test('demo verification is single use, hashed at rest, and explicitly not a verified real mailbox',async()=>{
 const s=await fixture(),c=client(s.env),ch=(await c('customer/email/demo',{})).d;
 assert.equal(row(s,'SELECT count(*) AS n FROM customers').n,0);
 const stored=row(s,'SELECT * FROM email_challenges WHERE id=?',ch.challenge_id);assert.notEqual(stored.code_hash,ch.demo_code);assert.match(stored.code_hash,/^[a-f0-9]{64}$/);
 const r=await c('customer/email/verify',{challenge_id:ch.challenge_id,code:ch.demo_code});assert.equal(r.r.status,200);assert.match(r.r.headers.get('set-cookie')!,/HttpOnly; Secure; SameSite=Strict/);
 const me=(await c('customer/session')).d.customer;assert.equal(me.is_demo,1);assert.equal(me.verified_at,null);assert.equal(me.email,ch.email);
 assert.equal((await c('customer/email/verify',{challenge_id:ch.challenge_id,code:ch.demo_code})).r.status,400);
 assert.equal(row(s,'SELECT count(*) AS n FROM customer_sessions').n,1);
});
test('real email adapter verifies the received code, normalizes emails, and never returns codes or provider secrets',async()=>{
 const db=new DB(),env:any={DB:db,DEMO_MODE:'false',INVENTORY_KEY:'c'.repeat(64),RESEND_API_KEY:'fake-mail-test-token',EMAIL_FROM:'品香 <login@example.com>'},c=client(env),original=globalThis.fetch;let sent:any=null,calls=0;
 globalThis.fetch=async(input,init)=>{calls++;assert.equal(input,'https://api.resend.com/emails');assert.equal((init!.headers as any).Authorization,'Bearer fake-mail-test-token');assert.match((init!.headers as any)['Idempotency-Key'],/^pinxiang-login\//);sent=JSON.parse(String(init!.body));return Response.json({id:'mock-message'});};
 try{
  const sentResult=await c('customer/email/code',{email:' Buyer@Example.com '});assert.equal(sentResult.r.status,200);const ch=sentResult.d;assert.deepEqual(sent.to,['buyer@example.com']);assert.equal(ch.demo_code,undefined);assert.equal(ch.code,undefined);assert.ok(!JSON.stringify(ch).includes('fake-mail-test-token'));
  assert.equal((await c('customer/email/code',{email:'buyer@example.com'})).r.status,429);assert.equal(calls,1);
  const code=sent.text.match(/\d{6}/)[0];assert.equal((await c('customer/email/verify',{challenge_id:ch.challenge_id,code})).r.status,200);
  const me=(await c('customer/session')).d.customer;assert.ok(me.verified_at>0);assert.equal(me.is_demo,0);assert.equal(me.email,'buyer@example.com');
  db.raw.prepare('UPDATE email_challenges SET created_at=?').run(Date.now()-61000);
  const next=(await c('customer/email/code',{email:'BUYER@example.com'})).d;assert.equal((await c('customer/email/verify',{challenge_id:next.challenge_id,code:sent.text.match(/\d{6}/)[0]})).r.status,200);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM customers').get()!.n,1);
 }finally{globalThis.fetch=original;}
});
test('mail delivery failure and expired challenges cannot create accounts',async()=>{
 const db=new DB(),env:any={DB:db,INVENTORY_KEY:'c'.repeat(64),RESEND_API_KEY:'fake',EMAIL_FROM:'login@example.com'},c=client(env),original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({error:'provider-sensitive-error'}, {status:500});
 try{const r=await c('customer/email/code',{email:'buyer@example.com'});assert.equal(r.r.status,503);assert.ok(!JSON.stringify(r.d).includes('provider-sensitive'));assert.equal(db.raw.prepare('SELECT count(*) AS n FROM customers').get()!.n,0);}finally{globalThis.fetch=original;}
 const s=await fixture(),ch=(await s.guest('customer/email/demo',{})).d;s.db.raw.prepare('UPDATE email_challenges SET expires_at=? WHERE id=?').run(Date.now()-1,ch.challenge_id);
 assert.equal((await s.guest('customer/email/verify',{challenge_id:ch.challenge_id,code:ch.demo_code})).r.status,400);
});
test('five incorrect attempts lock the challenge and concurrent valid verification creates only one session',async()=>{
 const s=await fixture(),c=client(s.env),ch=(await c('customer/email/demo',{})).d,bad=ch.demo_code==='000000'?'111111':'000000';
 for(let i=0;i<5;i++)assert.equal((await c('customer/email/verify',{challenge_id:ch.challenge_id,code:bad})).r.status,400);
 assert.equal((await c('customer/email/verify',{challenge_id:ch.challenge_id,code:ch.demo_code})).r.status,400);
 const next=(await c('customer/email/demo',{})).d;
 const results=await Promise.all([c('customer/email/verify',{challenge_id:next.challenge_id,code:next.demo_code}),client(s.env)('customer/email/verify',{challenge_id:next.challenge_id,code:next.demo_code})]);
 assert.equal(results.filter(x=>x.r.status===200).length,1);assert.equal(row(s,'SELECT count(*) AS n FROM customer_sessions').n,1);
});
test('customer accounts are isolated, enforce CSRF, and do not replace guest checkout',async()=>{
 const s=await fixture(),a=client(s.env),b=client(s.env),me=await login(a);await login(b);
 const own=(await a('orders',cart(s.p.id,{customer_id:'forged'}))).d;assert.equal(own.customer_id,me.id);assert.equal(own.shipping_fee,2000);assert.equal(own.contact,'');
 assert.equal((await a('customer/orders')).d.total,1);assert.equal((await b('customer/orders')).d.total,0);
 assert.equal((await b('orders/lookup',{id:own.id})).r.status,404);assert.equal((await a('orders/lookup',{id:own.id})).d.telegram_gift,null);
 assert.equal((await a('orders/lookup',{id:own.id}, {'x-csrf-token':''})).r.status,403);
 assert.equal((await a('customer/profile',{display_name:'名字'},{origin:'https://evil.test'})).r.status,403);
 assert.equal((await a('customer/profile',{display_name:'名字'},{'x-csrf-token':'wrong'})).r.status,403);
 const p=(await a('orders/demo-pay',{id:own.id})).d;assert.equal(p.telegram_gift_unlocked,true);assert.match(p.telegram_gift,/DEMO-TELEGRAM/);
 const guest=(await s.guest('orders',cart(s.p.id))).d;assert.equal(guest.customer_id,null);assert.equal((await s.guest('orders/lookup',credentials(guest))).r.status,200);
 assert.equal((await a('admin/orders')).r.status,401);
});
test('guest orders require explicit possession-based binding, never contact email matching or reassignment',async()=>{
 const s=await fixture(),a=client(s.env),b=client(s.env),me=await login(a);await login(b);
 const o=(await s.guest('orders',cart(s.p.id,{contact:me.email}))).d;assert.equal((await a('customer/orders')).d.total,0);
 assert.equal((await a('customer/orders/claim',{id:o.id,secret:'wrong'})).r.status,404);
 assert.equal((await a('customer/orders/claim',credentials(o))).r.status,200);assert.equal((await a('customer/orders')).d.total,1);
 assert.equal((await b('customer/orders/claim',credentials(o))).r.status,409);assert.equal((await b('orders/lookup',{id:o.id})).r.status,404);
 assert.equal((await a('orders/lookup',{id:o.id})).d.telegram_gift,null);assert.equal((await a('tickets',{orderId:o.id,subject:'测试售后',message:'账号登录后的售后测试'})).r.status,201);
 assert.equal((await b('tickets',{orderId:o.id,subject:'越权',message:'不应该允许提交工单'})).r.status,404);
});
test('profile information is optional and never silently changes existing orders; all-session logout revokes access',async()=>{
 const s=await fixture(),c=client(s.env),me=await login(c),o=(await c('orders',cart(s.p.id))).d;
 assert.equal((await c('customer/profile',{display_name:'测试客户',...shipping})).r.status,200);
 assert.equal((await c('customer/session')).d.customer.shipping_address,shipping.shipping_address);assert.equal((await c('orders/lookup',{id:o.id})).d.shipping_address,'');
 assert.equal((await c('customer/profile',{})).r.status,200);assert.equal((await c('customer/session')).d.customer.shipping_address,'');
 const record=row(s,'SELECT * FROM customer_sessions WHERE customer_id=?',me.id);s.db.raw.prepare('INSERT INTO customer_sessions VALUES(?,?,?,?,?)').run('second-session-test',me.id,'another-csrf',record.expires_at,Date.now());
 assert.equal((await c('customer/logout',{all:true})).r.status,200);assert.equal(row(s,'SELECT count(*) AS n FROM customer_sessions WHERE customer_id=?',me.id).n,0);assert.equal((await c('customer/orders')).r.status,401);
});
test('disabled and expired customer sessions cannot access account orders; staff sessions stay separate',async()=>{
 const s=await fixture(),c=client(s.env),me=await login(c);
 assert.equal((await s.admin('customer/session')).d.customer,null);assert.equal((await c('auth/me')).r.status,401);
 assert.equal((await s.admin('admin/customers',{id:me.id,active:false,reason})).r.status,200);assert.equal((await c('customer/session')).d.customer,null);
 assert.equal(row(s,'SELECT active FROM customers WHERE id=?',me.id).active,0);assert.equal((await s.admin('admin/customers')).d.customers[0].active,0);
 assert.equal((await s.admin('admin/customers',{id:me.id,active:true,reason})).r.status,200);
 const other=client(s.env);await login(other);s.db.raw.prepare('UPDATE customer_sessions SET expires_at=?').run(Date.now()-1);assert.equal((await other('customer/orders')).r.status,401);assert.equal((await other('orders',cart(s.p.id,{accountCheckout:true}))).r.status,401);
});
test('customer checkout replay preserves ownership and does not accept client changes to gift or shipping fee',async()=>{
 const s=await fixture(),a=client(s.env),b=client(s.env);const me=await login(a);await login(b);const payload=cart(s.p.id,{checkoutToken:'e'.repeat(64),customer_id:'forged',paid_at:Date.now(),status:'paid',shipping_fee:0});
 const o=(await a('orders',payload)).d;assert.equal(o.customer_id,me.id);assert.equal(o.shipping_fee,2000);assert.equal(o.telegram_gift,null);
 assert.equal((await a('orders',payload)).d.id,o.id);assert.equal((await b('orders',payload)).r.status,409);
});
test('merging shipments preserves each order, fee, gift and stock; corrections apply atomically to the whole group',async()=>{
 const s=await fixture(),a=await paid(s),b=await paid(s),before=row(s,'SELECT * FROM physical_stock WHERE product_id=?',s.p.id);
 assert.notEqual(a.telegram_gift,b.telegram_gift);
 const merged=await s.admin('admin/order-actions',{action:'merge',ids:[a.id,b.id],reason});assert.equal(merged.r.status,200,JSON.stringify(merged.d));const group=merged.d.group_id;
 for(const o of [a,b]){const next=(await s.guest('orders/lookup',credentials(o))).d;assert.equal(next.shipment_group_id,group);assert.equal(next.total,o.total);assert.equal(next.shipping_fee,2000);assert.equal(next.telegram_gift,o.telegram_gift);}
 assert.equal((await s.admin('admin/address',{id:a.id,...shipping,contact:'other'})).r.status,409);
 assert.equal((await s.admin('admin/shipment',{id:a.id,tracking_number:'MERGED-1000'})).d.count,2);
 assert.equal((await s.guest('orders/lookup',credentials(b))).d.tracking_number,'MERGED-1000');
 assert.equal((await s.admin('admin/order-actions',{action:'amend-shipment',id:b.id,tracking_number:'MERGED-2000',reason})).r.status,200);
 assert.equal((await s.guest('orders/lookup',credentials(a))).d.tracking_number,'MERGED-2000');
 assert.equal((await s.admin('admin/order-actions',{action:'unmerge',id:a.id,reason})).r.status,409);
 assert.equal((await s.admin('admin/order-actions',{action:'clear-shipment',id:a.id,reason})).r.status,200);
 for(const o of [a,b]){const next=(await s.guest('orders/lookup',credentials(o))).d;assert.equal(next.status,'paid');assert.equal(next.shipping_status,'pending');assert.equal(next.tracking_number,'');assert.equal(next.telegram_gift,o.telegram_gift);}
 assert.equal((await s.admin('admin/order-actions',{action:'unmerge',id:b.id,reason})).r.status,200);
 assert.equal(row(s,'SELECT shipment_group_id FROM orders WHERE id=?',a.id).shipment_group_id,null);assert.deepEqual(row(s,'SELECT * FROM physical_stock WHERE product_id=?',s.p.id),before);
 assert.ok((await s.admin('admin/order?id='+a.id)).d.history.some((h:any)=>h.action==='order.shipment.amend'));
});
test('merge validation rejects incomplete addresses, different customers, unpaid orders and stale concurrent changes',async()=>{
 const s=await fixture(),empty=await paid(s,{}),a=await paid(s),b=await paid(s,{...shipping,contact:'another'}),waiting=(await s.guest('orders',cart(s.p.id,shipping))).d;
 for(const ids of [[a.id,empty.id],[a.id,b.id],[a.id,waiting.id]])assert.equal((await s.admin('admin/order-actions',{action:'merge',ids,reason})).r.status,409);
 const c=client(s.env);await login(c);const own=(await c('orders',cart(s.p.id,shipping))).d;await c('orders/demo-pay',{id:own.id});assert.equal((await s.admin('admin/order-actions',{action:'merge',ids:[a.id,own.id],reason})).r.status,409);
 assert.equal(row(s,'SELECT count(*) AS n FROM shipment_groups').n,0);
 const other=await paid(s),batch=s.db.batch.bind(s.db);let once=true;
 s.db.batch=async(q:any)=>{if(once&&q.some((x:any)=>x.sql.startsWith('INSERT INTO shipment_groups'))){once=false;s.db.raw.prepare('UPDATE orders SET revision=revision+1,contact=? WHERE id=?').run('concurrent-contact',other.id);}return batch(q);};
 assert.equal((await s.admin('admin/order-actions',{action:'merge',ids:[a.id,other.id],reason})).r.status,409);
 assert.equal(row(s,'SELECT count(*) AS n FROM shipment_groups').n,0);assert.equal(row(s,'SELECT shipment_group_id FROM orders WHERE id=?',a.id).shipment_group_id,null);
});
test('cancel, archive and restore retain history and never change fees or reassign the gift',async()=>{
 const s=await fixture(),o=(await s.guest('orders',cart(s.p.id))).d;
 assert.equal((await s.admin('admin/order-actions',{id:o.id,action:'archive',reason})).r.status,409);
 assert.equal((await s.admin('admin/order-actions',{id:o.id,action:'cancel',reason})).r.status,200);
 assert.equal(row(s,'SELECT reserved FROM physical_stock WHERE product_id=?',s.p.id).reserved,0);
 assert.equal((await s.admin('admin/order-actions',{id:o.id,action:'cancel',reason})).r.status,409);
 const before=row(s,'SELECT * FROM physical_stock WHERE product_id=?',s.p.id);
 assert.equal((await s.admin('admin/order-actions',{id:o.id,action:'archive',reason})).r.status,200);assert.equal((await s.admin('admin/orders')).d.total,0);assert.equal((await s.admin('admin/orders?archived=1')).d.total,1);
 const archived=(await s.guest('orders/lookup',credentials(o))).d;assert.equal(archived.status,'cancelled');assert.equal(archived.shipping_fee,2000);assert.equal(archived.telegram_gift,null);assert.equal(archived.archived_at,undefined);
 assert.equal((await s.admin('admin/order-actions',{id:o.id,action:'restore',reason})).r.status,200);assert.equal((await s.admin('admin/orders')).d.total,1);assert.deepEqual(row(s,'SELECT * FROM physical_stock WHERE product_id=?',s.p.id),before);
 assert.equal(row(s,'SELECT status FROM telegram_gifts WHERE order_id=?',o.id).status,'assigned');
});
test('paid shipment edits reject stale versions, audit notes remain private, and money cannot be reset',async()=>{
 const s=await fixture(),o=await paid(s);const before=(await s.admin('admin/order?id='+o.id)).d;
 assert.equal((await s.admin('admin/order-actions',{id:o.id,action:'note',note:'PRIVATE-STAFF-NOTE',revision:before.revision})).r.status,200);
 assert.equal((await s.admin('admin/shipment',{id:o.id,tracking_number:'TRACK-100',revision:before.revision})).r.status,409);
 assert.equal((await s.admin('admin/order-actions',{id:o.id,action:'cancel',reason})).r.status,409);
 assert.equal((await s.admin('admin/orders',{id:o.id,action:'pending',reason,reference:'fake'})).r.status,400);
 assert.equal((await s.admin('admin/shipment',{id:o.id,tracking_number:'TRACK-100'})).r.status,200);
 assert.equal((await s.admin('admin/order-actions',{id:o.id,action:'amend-shipment',tracking_number:'TRACK-200',reason:'短'})).r.status,400);
 assert.equal((await s.admin('admin/order-actions',{id:o.id,action:'archive',reason})).r.status,200);
 const guest=(await s.guest('orders/lookup',credentials(o))).d;assert.equal(guest.telegram_gift,o.telegram_gift);assert.equal(guest.admin_note,undefined);assert.ok(!JSON.stringify(guest).includes('PRIVATE-STAFF-NOTE'));assert.equal(guest.status,'fulfilled');
});
test('support and operator privileges are enforced for order actions, customer accounts and recycle bin',async()=>{
 const s=await fixture();await s.admin('admin/staff',{username:'support-user',password:'test-password-12345',role:'support'});await s.admin('admin/staff',{username:'operator-user',password:'test-password-12345',role:'operator'});
 const support=client(s.env),operator=client(s.env);await support('auth/login',{username:'support-user',password:'test-password-12345'});await operator('auth/login',{username:'operator-user',password:'test-password-12345'});
 const o=(await s.guest('orders',cart(s.p.id))).d;
 assert.equal((await support('admin/order-actions',{action:'cancel',id:o.id,reason})).r.status,403);
 assert.equal((await support('admin/order-actions',{action:'note',id:o.id,note:'客服待跟进'})).r.status,200);
 assert.equal((await operator('admin/order-actions',{action:'cancel',id:o.id,reason})).r.status,200);
 assert.equal((await operator('admin/order-actions',{action:'archive',id:o.id,reason})).r.status,403);
 assert.equal((await support('admin/customers')).r.status,403);assert.equal((await operator('admin/customers')).r.status,403);
 assert.equal((await s.admin('admin/order-actions',{action:'archive',id:o.id,reason},{'x-csrf-token':'wrong'})).r.status,403);
});
test('order filters search shipping, contact and recycle bin without exposing access hashes',async()=>{
 const s=await fixture(),a=await paid(s),b=(await s.guest('orders',cart(s.p.id))).d;await s.admin('admin/shipment',{id:a.id,tracking_number:'FIND-ME-100'});
 assert.equal((await s.admin('admin/orders?shipping=shipped')).d.total,1);assert.equal((await s.admin('admin/orders?shipping=pending')).d.total,1);
 assert.equal((await s.admin('admin/orders?q=FIND-ME')).d.orders[0].id,a.id);assert.equal((await s.admin('admin/orders?q=test-contact')).d.total,1);
 const filtered=(await s.admin('admin/orders?status=pending')).d;assert.equal(filtered.orders[0].id,b.id);assert.equal(filtered.orders[0].lookup_hash,undefined);
});
