import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json')),{Miniflare}=wranglerRequire('miniflare');
const files=readdirSync('dist/server',{recursive:true}).filter(f=>f.endsWith('.js')||f.endsWith('.mjs'));
files.sort((a,b)=>a==='index.js'?-1:b==='index.js'?1:a.localeCompare(b));
let outbound=0;
const options={modules:files.map(f=>({type:'ESModule',path:resolve('dist/server',f)})),modulesRoot:resolve('dist/server'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],assets:{directory:resolve('dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}},cf:false,outboundService:()=>{outbound++;throw Error('Physical commerce must not call unconnected payment or supplier services');}};
async function migrate(mf){const db=await mf.getD1Database('DB');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();return db;}
function client(mf){const cookies=new Map();let staffCsrf='',customerCsrf='';return async(path,body,status=200)=>{
 const csrf=path.startsWith('admin/')||path.startsWith('auth/')?staffCsrf:customerCsrf;
 const r=await mf.dispatchFetch('https://store.test/api/'+path,{method:body===undefined?'GET':'POST',headers:{origin:'https://store.test',...(body===undefined?{}:{'content-type':'application/json'}),cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'x-csrf-token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const d=await r.json();assert.equal(r.status,status,path+': '+JSON.stringify(d));if(r.headers.has('set-cookie')){const [key,value]=r.headers.get('set-cookie').split(';')[0].split('=');cookies.set(key,value);if(d.csrf){if(key==='px_customer')customerCsrf=d.csrf;else staffCsrf=d.csrf;}}return d;
};}
const mf=new Miniflare({...options,d1Databases:{DB:'physical-demo-db'},bindings:{DEMO_MODE:'true',INVENTORY_KEY:'b'.repeat(64)}});
try{
 const db=await migrate(mf),request=client(mf);assert.equal((await db.prepare('SELECT count(*) AS n FROM products').first()).n,0);
 for(const path of ['/','/orders','/account','/help','/admin']){const response=await mf.dispatchFetch('https://store.test'+path);assert.equal(response.status,200,path);const html=await response.text();assert.match(html,/品香|PINXIANG/);if(path==='/'){assert.match(html,/header-login/);assert.match(html,/href="\/account"/);assert.match(html,/header-order-link/);}}
 await request('admin/order?id=missing',undefined,401);const catalog=await request('catalog');assert.equal(catalog.products.length,8);assert.equal(catalog.shippingFee,2000);assert.equal(catalog.paymentEnabled,false);
 const p=catalog.products[0],payload={acceptedTerms:true,items:[{id:p.id,quantity:2}],checkoutToken:'d'.repeat(64),shipping_fee:0,total:1};
 const order=await request('orders',payload,201);assert.equal(order.total,p.price*2+2000);assert.equal(order.shipping_address,'');assert.equal(order.contact,'');assert.equal(order.telegram_gift,null);assert.equal(order.telegram_gift_unlocked,false);
 const duplicate=await request('orders',payload,201);assert.equal(duplicate.id,order.id);assert.equal(duplicate.telegram_gift,order.telegram_gift);
 const credentials={id:order.id,secret:order.secret};assert.equal((await request('orders/lookup',{...credentials,status:'paid',telegram_gift_unlocked:true})).telegram_gift,null);const paid=await request('orders/demo-pay',credentials);assert.equal(paid.status,'paid');assert.equal(paid.shipping_status,'pending');assert.equal(paid.tracking_number,'');assert.match(paid.telegram_gift,/DEMO-TELEGRAM/);assert.equal(paid.telegram_gift_unlocked,true);
 await request('auth/demo',{});await request('admin/address',{id:order.id,recipient:'运行时测试',shipping_address:'测试地址',contact:''});
 await request('admin/shipment',{id:order.id,tracking_number:'TEST-SF-10001'});assert.equal((await request('admin/shipment',{id:order.id,tracking_number:'TEST-SF-10001'})).idempotent,true);
 const shipped=await request('orders/lookup',credentials);assert.equal(shipped.shipping_status,'shipped');assert.equal(shipped.tracking_number,'TEST-SF-10001');assert.equal(shipped.shipping_address,'测试地址');assert.equal(shipped.telegram_gift,paid.telegram_gift);assert.equal(shipped.tracking_events,undefined);
 await request('admin/address',{id:order.id,shipping_address:'changed'},409);
 const detail=await request('admin/order?id='+order.id);assert.equal(detail.giftAssigned,true);assert.equal(detail.telegram_gift,undefined);assert.equal(detail.lookup_hash,undefined);
 const stock=await db.prepare('SELECT * FROM physical_stock WHERE product_id=?').bind(p.id).first();assert.equal(stock.sold,2);assert.equal(stock.reserved,0);
 const waiting=await request('orders',{acceptedTerms:true,items:[{id:p.id,quantity:1}]},201);await db.prepare('UPDATE orders SET expires_at=? WHERE id=?').bind(Date.now()-1,waiting.id).run();const worker=await mf.getWorker();await worker.scheduled({cron:'* * * * *'});
 assert.equal((await db.prepare('SELECT status FROM orders WHERE id=?').bind(waiting.id).first()).status,'expired');assert.equal((await db.prepare('SELECT status FROM telegram_gifts WHERE order_id=?').bind(waiting.id).first()).status,'assigned');assert.equal((await db.prepare('SELECT available FROM physical_stock WHERE product_id=?').bind(p.id).first()).available,18);
 const customer=client(mf),other=client(mf),code=await customer('customer/email/demo',{});assert.equal(code.demo,true);await customer('customer/email/verify',{challenge_id:code.challenge_id,code:code.demo_code});
 const me=(await customer('customer/session')).customer;assert.equal(me.verified_at,null);await customer('customer/email/verify',{challenge_id:code.challenge_id,code:code.demo_code},400);
 await customer('customer/profile',{display_name:'运行时测试账号',recipient:'测试客户',contact:'test-contact',shipping_address:'仅供测试地址'});
 await customer('customer/orders/claim',credentials);assert.equal((await customer('customer/orders')).total,1);assert.equal((await customer('orders/lookup',{id:order.id})).telegram_gift,paid.telegram_gift);
 await other('orders/lookup',{id:order.id},404);
 const draft=await customer('orders',{acceptedTerms:true,items:[{id:p.id,quantity:1}]},201);assert.equal(draft.customer_id,me.id);assert.equal(draft.telegram_gift,null);await customer('orders/cancel',{id:draft.id});
 await request('admin/order-actions',{action:'archive',id:draft.id,reason:'运行时测试删除至回收站'});assert.equal((await request('admin/orders?archived=1')).total,1);assert.equal((await customer('orders/lookup',{id:draft.id})).status,'cancelled');await request('admin/order-actions',{action:'restore',id:draft.id,reason:'运行时测试恢复已关闭订单'});
 const mergeOrders=[];for(let i=0;i<2;i++){const o=await customer('orders',{acceptedTerms:true,items:[{id:p.id,quantity:1}],recipient:'测试客户',contact:'test-contact',shipping_address:'仅供测试地址'},201);await customer('orders/demo-pay',{id:o.id});mergeOrders.push(o.id);}
 const merged=await request('admin/order-actions',{action:'merge',ids:mergeOrders,reason:'运行时测试同地址合并发货'});assert.equal(merged.count,2);
 await request('admin/shipment',{id:mergeOrders[0],tracking_number:'GROUP-1000'});assert.equal((await customer('orders/lookup',{id:mergeOrders[1]})).tracking_number,'GROUP-1000');
 await request('admin/order-actions',{action:'amend-shipment',id:mergeOrders[1],tracking_number:'GROUP-2000',reason:'运行时测试修正错误物流单号'});assert.equal((await customer('orders/lookup',{id:mergeOrders[0]})).tracking_number,'GROUP-2000');
 await request('admin/order-actions',{action:'clear-shipment',id:mergeOrders[0],reason:'运行时测试撤销发货记录'});assert.equal((await customer('orders/lookup',{id:mergeOrders[1]})).shipping_status,'pending');
 await request('admin/order-actions',{action:'unmerge',id:mergeOrders[0],reason:'运行时测试恢复独立发货'});await customer('customer/logout',{all:true});await customer('customer/orders',undefined,401);
 console.log('workerd demo passed: 5 SSR routes, customer code/session/profile/order access, guest claim, payment-only gift disclosure, combined shipment corrections, recycle bin and stock invariants.');
}finally{await mf.dispose();}
const prod=new Miniflare({...options,d1Databases:{DB:'physical-production-test-db'},bindings:{DEMO_MODE:'false',INVENTORY_KEY:'b'.repeat(64),BOOTSTRAP_TOKEN:'worker-test-bootstrap',PAYMENT_PROVIDER:'trc20',TRON_RECEIVING_ADDRESS:'historical-fixture',TRONGRID_API_KEY:'historical-fixture',PAYMENT_WEBHOOK_SECRET:'historical-fixture',DIDIPIFA_API_TOKEN:'historical-fixture',DIDIPIFA_PURCHASE_ENABLED:'true'}});
try{
 const db=await migrate(prod),request=client(prod);assert.equal((await request('catalog')).products.length,0);await request('auth/demo',{},403);await request('orders/demo-pay',{},403);await request('customer/email/demo',{},403);await request('customer/email/code',{email:'test@example.com'},503);
 await request('auth/setup',{username:'worker-owner',password:'worker-test-password-2026',token:'worker-test-bootstrap'});
 await request('admin/categories',{id:'test-category',name:'测试实体商品',sort:0,active:true});
 await request('admin/products',{id:'test-product',category_id:'test-category',name:'测试实体商品',price:3900,min_qty:1,max_qty:10,active:true,icon_key:'cup'});
 await request('admin/inventory',{product_id:'test-product',delta:5,reason:'测试入库'});
 const payload={acceptedTerms:true,payment_method:'alipay',items:[{id:'test-product',quantity:1}]};await request('orders',payload,409);
 await request('admin/gifts',{codes:'TEST-ACCOUNT-1 | test-content-only\nTEST-ACCOUNT-2 | test-content-only'});
 const o=await request('orders',payload,201);assert.equal(o.total,5900);assert.equal(o.demo,0);assert.equal(o.telegram_gift,null);assert.equal(o.telegram_gift_unlocked,false);const creds={id:o.id,secret:o.secret};
 for(const method of ['wechat','alipay','usdt']){const stub=await request('payments/create',{...creds,method},503);assert.equal(stub.status,'unavailable');assert.equal(stub.method,method);await request('payments/webhook/'+method,{orderId:o.id,amount:o.total,status:'paid'},503);}
 await request('payments/check',creds,503);await request('payments/webhook',{orderId:o.id,status:'paid'},503);await request('admin/supplier',{action:'purchase'},410);assert.equal((await request('orders/lookup',creds)).status,'pending');
 await request('admin/orders',{id:o.id,reference:'fixture-manual-001',reason:'测试环境核对收款，不涉及真实资金'});const unlocked=await request('orders/lookup',creds);assert.equal(unlocked.shipping_status,'pending');assert.equal(unlocked.telegram_gift_unlocked,true);assert.match(unlocked.telegram_gift,/TEST-ACCOUNT/);await request('admin/shipment',{id:o.id,tracking_number:'TEST-TRACKING-001'});assert.equal((await request('orders/lookup',creds)).status,'fulfilled');
 const gifts=await request('admin/gifts');assert.equal(gifts.stats.available,1);assert.ok(!JSON.stringify(gifts).includes('test-content-only'));
 const cipher=await db.prepare('SELECT ciphertext FROM telegram_gifts WHERE order_id=?').bind(o.id).first();assert.ok(!cipher.ciphertext.includes('TEST-ACCOUNT'));
 const worker=await prod.getWorker();await worker.scheduled({cron:'* * * * *'});assert.equal(outbound,0);
 console.log('workerd production configuration passed: empty production database, role/session setup, stock, encrypted gift import and payment-gated disclosure, unavailable payment adapters, manual receipt and shipment. No external calls or real funds.');
}finally{await prod.dispose();}

let emails=[];
const emailWorker=new Miniflare({...options,d1Databases:{DB:'email-production-test-db'},bindings:{DEMO_MODE:'false',INVENTORY_KEY:'b'.repeat(64),RESEND_API_KEY:'fake-runtime-mail-key',EMAIL_FROM:'Pinxiang <login@example.com>'},outboundService:async request=>{
 assert.equal(request.url,'https://api.resend.com/emails');assert.equal(request.method,'POST');assert.equal(request.headers.get('authorization'),'Bearer fake-runtime-mail-key');assert.match(request.headers.get('idempotency-key'),/^pinxiang-login\//);
 emails.push(await request.json());return Response.json({id:'mock-email-only'});
}});
try{
 await migrate(emailWorker);const request=client(emailWorker),result=await request('customer/email/code',{email:'Runtime@Example.com'});assert.equal(result.demo_code,undefined);assert.equal(emails.length,1);assert.deepEqual(emails[0].to,['runtime@example.com']);
 const code=emails[0].text.match(/\d{6}/)[0];await request('customer/email/verify',{challenge_id:result.challenge_id,code});const me=(await request('customer/session')).customer;assert.equal(me.is_demo,0);assert.ok(me.verified_at>0);await request('customer/logout',{all:true});await request('customer/orders',undefined,401);
 console.log('workerd email adapter passed: production email challenge and verification, mock provider only; no real emails sent.');
}finally{await emailWorker.dispose();}
