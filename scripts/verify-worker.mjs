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
function client(mf){let cookie='',csrf='';return async(path,body,status=200)=>{
 const r=await mf.dispatchFetch('https://store.test/api/'+path,{method:body===undefined?'GET':'POST',headers:{origin:'https://store.test',...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie,'x-csrf-token':csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const d=await r.json();assert.equal(r.status,status,path+': '+JSON.stringify(d));if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];if(d.csrf)csrf=d.csrf;return d;
};}
const mf=new Miniflare({...options,d1Databases:{DB:'physical-demo-db'},bindings:{DEMO_MODE:'true',INVENTORY_KEY:'b'.repeat(64)}});
try{
 const db=await migrate(mf),request=client(mf);assert.equal((await db.prepare('SELECT count(*) AS n FROM products').first()).n,0);
 for(const path of ['/','/orders','/help','/admin']){const response=await mf.dispatchFetch('https://store.test'+path);assert.equal(response.status,200,path);assert.match(await response.text(),/品享|PINXIANG/);}
 await request('admin/order?id=missing',undefined,401);const catalog=await request('catalog');assert.equal(catalog.products.length,8);assert.equal(catalog.shippingFee,2000);assert.equal(catalog.paymentEnabled,false);
 const p=catalog.products[0],payload={acceptedTerms:true,items:[{id:p.id,quantity:2}],checkoutToken:'d'.repeat(64),shipping_fee:0,total:1};
 const order=await request('orders',payload,201);assert.equal(order.total,p.price*2+2000);assert.equal(order.shipping_address,'');assert.equal(order.contact,'');assert.match(order.telegram_gift,/DEMO-TELEGRAM/);
 const duplicate=await request('orders',payload,201);assert.equal(duplicate.id,order.id);assert.equal(duplicate.telegram_gift,order.telegram_gift);
 const credentials={id:order.id,secret:order.secret};const paid=await request('orders/demo-pay',credentials);assert.equal(paid.status,'paid');assert.equal(paid.shipping_status,'pending');assert.equal(paid.tracking_number,'');
 await request('auth/demo',{});await request('admin/address',{id:order.id,recipient:'运行时测试',shipping_address:'测试地址',contact:''});
 await request('admin/shipment',{id:order.id,tracking_number:'TEST-SF-10001'});assert.equal((await request('admin/shipment',{id:order.id,tracking_number:'TEST-SF-10001'})).idempotent,true);
 const shipped=await request('orders/lookup',credentials);assert.equal(shipped.shipping_status,'shipped');assert.equal(shipped.tracking_number,'TEST-SF-10001');assert.equal(shipped.shipping_address,'测试地址');assert.equal(shipped.telegram_gift,order.telegram_gift);assert.equal(shipped.tracking_events,undefined);
 await request('admin/address',{id:order.id,shipping_address:'changed'},409);
 const detail=await request('admin/order?id='+order.id);assert.equal(detail.giftAssigned,true);assert.equal(detail.telegram_gift,undefined);assert.equal(detail.lookup_hash,undefined);
 const stock=await db.prepare('SELECT * FROM physical_stock WHERE product_id=?').bind(p.id).first();assert.equal(stock.sold,2);assert.equal(stock.reserved,0);
 const waiting=await request('orders',{acceptedTerms:true,items:[{id:p.id,quantity:1}]},201);await db.prepare('UPDATE orders SET expires_at=? WHERE id=?').bind(Date.now()-1,waiting.id).run();const worker=await mf.getWorker();await worker.scheduled({cron:'* * * * *'});
 assert.equal((await db.prepare('SELECT status FROM orders WHERE id=?').bind(waiting.id).first()).status,'expired');assert.equal((await db.prepare('SELECT status FROM telegram_gifts WHERE order_id=?').bind(waiting.id).first()).status,'assigned');assert.equal((await db.prepare('SELECT available FROM physical_stock WHERE product_id=?').bind(p.id).first()).available,18);
 console.log('workerd demo passed: 4 SSR routes, migrations, optional address, fixed shipping, encrypted gift, replay, separate payment/shipping, tracking number, scheduled expiry.');
}finally{await mf.dispose();}
const prod=new Miniflare({...options,d1Databases:{DB:'physical-production-test-db'},bindings:{DEMO_MODE:'false',INVENTORY_KEY:'b'.repeat(64),BOOTSTRAP_TOKEN:'worker-test-bootstrap',PAYMENT_PROVIDER:'trc20',TRON_RECEIVING_ADDRESS:'historical-fixture',TRONGRID_API_KEY:'historical-fixture',PAYMENT_WEBHOOK_SECRET:'historical-fixture',DIDIPIFA_API_TOKEN:'historical-fixture',DIDIPIFA_PURCHASE_ENABLED:'true'}});
try{
 const db=await migrate(prod),request=client(prod);assert.equal((await request('catalog')).products.length,0);await request('auth/demo',{},403);await request('orders/demo-pay',{},403);
 await request('auth/setup',{username:'worker-owner',password:'worker-test-password-2026',token:'worker-test-bootstrap'});
 await request('admin/categories',{id:'test-category',name:'测试实体商品',sort:0,active:true});
 await request('admin/products',{id:'test-product',category_id:'test-category',name:'测试实体商品',price:3900,min_qty:1,max_qty:10,active:true,icon_key:'cup'});
 await request('admin/inventory',{product_id:'test-product',delta:5,reason:'测试入库'});
 const payload={acceptedTerms:true,payment_method:'alipay',items:[{id:'test-product',quantity:1}]};await request('orders',payload,409);
 await request('admin/gifts',{codes:'TEST-ACCOUNT-1 | test-content-only\nTEST-ACCOUNT-2 | test-content-only'});
 const o=await request('orders',payload,201);assert.equal(o.total,5900);assert.equal(o.demo,0);assert.match(o.telegram_gift,/TEST-ACCOUNT/);const creds={id:o.id,secret:o.secret};
 for(const method of ['wechat','alipay','usdt']){const stub=await request('payments/create',{...creds,method},503);assert.equal(stub.status,'unavailable');assert.equal(stub.method,method);await request('payments/webhook/'+method,{orderId:o.id,amount:o.total,status:'paid'},503);}
 await request('payments/check',creds,503);await request('payments/webhook',{orderId:o.id,status:'paid'},503);await request('admin/supplier',{action:'purchase'},410);assert.equal((await request('orders/lookup',creds)).status,'pending');
 await request('admin/orders',{id:o.id,reference:'fixture-manual-001',reason:'测试环境核对收款，不涉及真实资金'});assert.equal((await request('orders/lookup',creds)).shipping_status,'pending');await request('admin/shipment',{id:o.id,tracking_number:'TEST-TRACKING-001'});assert.equal((await request('orders/lookup',creds)).status,'fulfilled');
 const gifts=await request('admin/gifts');assert.equal(gifts.stats.available,1);assert.ok(!JSON.stringify(gifts).includes('test-content-only'));
 const cipher=await db.prepare('SELECT ciphertext FROM telegram_gifts WHERE order_id=?').bind(o.id).first();assert.ok(!cipher.ciphertext.includes('TEST-ACCOUNT'));
 const worker=await prod.getWorker();await worker.scheduled({cron:'* * * * *'});assert.equal(outbound,0);
 console.log('workerd production configuration passed: empty production database, role/session setup, stock, encrypted gift import, unavailable payment adapters, manual receipt and shipment. No external calls or real funds.');
}finally{await prod.dispose();}
