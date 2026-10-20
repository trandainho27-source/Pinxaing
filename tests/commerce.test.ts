import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleApi, reservationGuard, settleOrder } from '../lib/commerce/api.ts';
import { encrypt, decrypt, hmac } from '../lib/commerce/security.ts';
import {shipmentDisplay} from '../lib/commerce/order-display.ts';
import {handleApi as legacyApi} from '../lib/commerce/legacy-api.ts';
import { runPaymentReconciliation } from '../lib/commerce/api.ts';
class Query {
    constructor(public database: DatabaseSync, public sql: string, public values: any[] = []) {
    }
    bind(...values: any[]) {
        return new Query(this.database, this.sql, values);
    }
    async first() {
        return this.database.prepare(this.sql).get(...this.values) || null;
    }
    async all() {
        return { results: this.database.prepare(this.sql).all(...this.values) };
    }
    async run() {
        const r = this.database.prepare(this.sql).run(...this.values);
        return { success: true, meta: { changes: Number(r.changes) } };
    }
    execute() {
        const statement = this.database.prepare(this.sql);
        if (statement.columns().length) {
            const results = statement.all(...this.values);
            return { results, meta: { changes: Number(this.database.prepare('SELECT changes() AS n').get()!.n) } };
        }
        const result = statement.run(...this.values);
        return { results: [], meta: { changes: Number(result.changes) } };
    }
}
class DB {
    raw = new DatabaseSync(':memory:');
    constructor(migrationCount=Infinity) {
        this.raw.exec('PRAGMA foreign_keys=ON');
        for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort().slice(0,migrationCount))
            this.raw.exec(readFileSync('drizzle/' + file, 'utf8'));
    }
    prepare(sql: string) {
        return new Query(this.raw, sql);
    }
    async batch(queries: Query[]) {
        this.raw.exec('BEGIN');
        try {
            const results = queries.map(q => q.execute());
            this.raw.exec('COMMIT');
            return results;
        }
        catch (e) {
            this.raw.exec('ROLLBACK');
            throw e;
        }
    }
}
async function setup(demo = true,migrationCount=Infinity) {
    const db = new DB(migrationCount), env: any = { DB: db, DEMO_MODE: demo ? 'true' : 'false', INVENTORY_KEY: 'a'.repeat(64), BOOTSTRAP_TOKEN: 'test-setup-token' };
    let cookie = '', csrf = '';
    async function req(path: string, b?: any, extra: Record<string, string> = {}) {
        const method = b === undefined ? 'GET' : 'POST';
        const r = await handleApi(new Request('https://store.test/api/' + path, { method, headers: { origin: 'https://store.test', ...(b === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie, 'x-csrf-token': csrf } : {}), ...extra }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) }), env);
        const d = await r.json() as any;
        if (r.headers.get('set-cookie'))
            cookie = r.headers.get('set-cookie')!.split(';')[0];
        if (d.csrf)
            csrf = d.csrf;
        return { r, d };
    }
    return { db, env, req };
}
const orderBody=(id:string,q=1,extra:any={})=>({acceptedTerms:true,items:[{id,quantity:q}],...extra});
async function fixture(){const s=await setup();const catalog=(await s.req('catalog')).d;return {...s,catalog,p:catalog.products[0]};}
const scalar=(s:any,sql:string,...args:any[])=>s.db.raw.prepare(sql).get(...args);
const stock=(s:any,id=s.p.id)=>scalar(s,'SELECT * FROM physical_stock WHERE product_id=?',id);
const credential=(o:any)=>({id:o.id,secret:o.secret});

test('schema-only migrations and production bootstrap do not create merchandise or demo accounts',async()=>{
 const s=await setup(false);for(const table of ['products','orders','physical_stock','telegram_gifts','staff'])assert.equal(scalar(s,`SELECT count(*) AS n FROM ${table}`).n,0);
 assert.equal((await s.req('auth/demo',{})).r.status,403);assert.equal((await s.req('orders/demo-pay',{})).r.status,403);
 assert.equal((await s.req('auth/setup',{username:'owner',password:'long-password-123',token:'wrong'})).r.status,403);
 const auth=await s.req('auth/setup',{username:'owner',password:'long-password-123',token:'test-setup-token'});assert.equal(auth.r.status,200);assert.match(auth.r.headers.get('set-cookie')!,/HttpOnly; Secure; SameSite=Strict/);
 assert.equal((await s.req('auth/setup',{username:'second',password:'long-password-123',token:'test-setup-token'})).r.status,409);
 assert.equal((await s.req('catalog')).d.products.length,0);assert.equal((await s.req('admin/seed',{})).r.status,403);
});
test('physical catalog has mandatory shipping and three disabled uniform payment providers',async()=>{
 const s=await fixture();assert.equal(s.catalog.products.length,8);assert.ok(s.catalog.products.every((p:any)=>p.product_type==='physical'));
 assert.equal(s.catalog.shippingFee,2000);assert.equal(s.catalog.giftAvailable,true);assert.equal(s.catalog.paymentEnabled,false);
 assert.deepEqual(s.catalog.paymentMethods.map((m:any)=>m.id),['wechat','alipay','usdt']);assert.ok(s.catalog.paymentMethods.every((m:any)=>!m.enabled&&m.status==='reserved'));
 await s.req('catalog');assert.equal(scalar(s,'SELECT count(*) AS n FROM telegram_gifts').n,30);
});
test('optional address, recipient and contact can be empty; server charges exactly one fixed shipping fee',async()=>{
 const s=await fixture();const result=await s.req('orders',orderBody(s.p.id,2,{shipping_fee:0,total:1,subtotal:1,price:1,freeShipping:true}));
 assert.equal(result.r.status,201,JSON.stringify(result.d));const o=result.d;assert.equal(o.contact,'');assert.equal(o.recipient,'');assert.equal(o.shipping_address,'');assert.equal(o.subtotal,s.p.price*2);assert.equal(o.shipping_fee,2000);assert.equal(o.total,s.p.price*2+2000);assert.equal(o.status,'pending');assert.equal(o.shipping_status,'pending');assert.equal(o.telegram_gift,null);assert.equal(o.telegram_gift_unlocked,false);assert.equal(stock(s).available,18);assert.equal(stock(s).reserved,2);
 const second=s.catalog.products[1];const multi=await s.req('orders',{acceptedTerms:true,payment_method:'usdt',items:[{id:s.p.id,quantity:1},{id:second.id,quantity:2}],contact:' 联系人 ',recipient:' 姓名 ',shipping_address:' 收货地址 '});assert.equal(multi.d.shipping_fee,2000);assert.equal(multi.d.total,s.p.price+second.price*2+2000);assert.equal(multi.d.contact,'联系人');assert.equal(multi.d.payment_method,'usdt');
});
test('gift is encrypted and reserved on creation but only disclosed after payment and correct credentials',async()=>{
 const s=await fixture(),o=(await s.req('orders',orderBody(s.p.id))).d;
 assert.equal(o.status,'pending');const gift=scalar(s,'SELECT * FROM telegram_gifts WHERE order_id=?',o.id);assert.equal(gift.status,'assigned');assert.ok(!gift.ciphertext.includes('DEMO-'));
 const plaintext=await decrypt(gift.ciphertext,s.env.INVENTORY_KEY,'pinxiang-telegram-gift');assert.equal(o.telegram_gift,null);assert.equal(o.telegram_gift_unlocked,false);assert.ok(!JSON.stringify(o).includes(plaintext));
 await assert.rejects(decrypt(gift.ciphertext,s.env.INVENTORY_KEY,'another-context'));
 assert.equal((await s.req('orders/lookup',{id:o.id,secret:'wrong'})).r.status,404);
 assert.equal((await s.req('orders/lookup',credential(o))).d.telegram_gift,null);assert.equal(o.lookup_hash,undefined);assert.equal(o.checkout_hash,undefined);
 const paid=(await s.req('orders/demo-pay',credential(o))).d;assert.equal(paid.telegram_gift,plaintext);assert.equal(paid.telegram_gift_unlocked,true);assert.equal(paid.shipping_status,'pending');
 assert.equal((await s.req('orders/lookup',credential(o))).d.telegram_gift,plaintext);assert.equal((await s.req('orders/lookup',{id:o.id,secret:'wrong'})).r.status,404);
 assert.equal((await s.req('admin/gifts')).r.status,401);await s.req('auth/demo',{});
 const admin=await s.req('admin/gifts');assert.ok(!JSON.stringify(admin.d).includes(plaintext));assert.ok(!JSON.stringify(admin.d).includes('ciphertext'));
 const detail=(await s.req('admin/order?id='+o.id)).d;assert.equal(detail.giftAssigned,true);assert.equal(detail.lookup_hash,undefined);assert.equal(detail.telegram_gift,undefined);
});
test('stable checkout token makes simultaneous retries idempotent and rejects altered payloads',async()=>{
 const s=await fixture(),b=orderBody(s.p.id,2,{checkoutToken:'c'.repeat(64)});
 const results=await Promise.all(Array.from({length:4},()=>s.req('orders',b)));for(const r of results)assert.equal(r.r.status,201,JSON.stringify(r.d));assert.equal(new Set(results.map(r=>r.d.id)).size,1);assert.ok(results.every(r=>r.d.telegram_gift===null&&r.d.telegram_gift_unlocked===false));
 assert.equal(scalar(s,'SELECT count(*) AS n FROM orders').n,1);assert.equal(scalar(s,"SELECT count(*) AS n FROM telegram_gifts WHERE status='assigned'").n,1);assert.equal(stock(s).available,18);
 assert.equal((await s.req('orders',{...b,contact:'changed'})).r.status,409);
 assert.equal((await s.req('orders',orderBody(s.p.id,1,{checkoutToken:'invalid'}))).r.status,400);
});
test('simultaneous carts cannot oversell last stock and failed orders roll back gift allocation',async()=>{
 const s=await fixture();s.db.raw.prepare('UPDATE physical_stock SET available=1 WHERE product_id=?').run(s.p.id);
 const results=await Promise.all([s.req('orders',orderBody(s.p.id)),s.req('orders',orderBody(s.p.id))]);assert.deepEqual(results.map(r=>r.r.status).sort(),[201,409]);assert.equal(stock(s).available,0);assert.equal(stock(s).reserved,1);assert.equal(scalar(s,'SELECT count(*) AS n FROM orders').n,1);assert.equal(scalar(s,"SELECT count(*) AS n FROM telegram_gifts WHERE status='assigned'").n,1);
});
test('simultaneous carts cannot allocate the last gift twice; stock is restored on losing transaction',async()=>{
 const s=await fixture();s.db.raw.exec('DELETE FROM telegram_gifts WHERE id NOT IN(SELECT id FROM telegram_gifts LIMIT 1)');
 const results=await Promise.all([s.req('orders',orderBody(s.p.id)),s.req('orders',orderBody(s.p.id))]);assert.deepEqual(results.map(r=>r.r.status).sort(),[201,409]);assert.equal(stock(s).available,19);assert.equal(scalar(s,'SELECT count(*) AS n FROM orders').n,1);
 assert.equal((await s.req('catalog')).d.giftAvailable,false);assert.equal((await s.req('orders',orderBody(s.p.id))).r.status,409);
});
test('transaction guard catches changed prices or categories before committing a reservation',async()=>{
 const s=await fixture(),original=s.db.batch.bind(s.db);let altered=false;
 s.db.batch=async(queries:Query[])=>{if(!altered&&queries.some(q=>q.sql.startsWith('INSERT INTO orders'))){altered=true;s.db.raw.prepare('UPDATE products SET price=price+100 WHERE id=?').run(s.p.id);}return original(queries);};
 assert.equal((await s.req('orders',orderBody(s.p.id))).r.status,409);assert.equal(stock(s).available,20);assert.equal(scalar(s,'SELECT count(*) AS n FROM orders').n,0);assert.equal(scalar(s,"SELECT count(*) AS n FROM telegram_gifts WHERE status='assigned'").n,0);
});
test('cancel and expiry release physical stock exactly once while gifts remain assigned',async()=>{
 const s=await fixture(),o=(await s.req('orders',orderBody(s.p.id,2))).d;
 assert.equal((await s.req('orders/cancel',credential(o))).r.status,200);assert.equal((await s.req('orders/cancel',credential(o))).r.status,200);assert.equal(stock(s).available,20);assert.equal(stock(s).reserved,0);assert.equal(scalar(s,'SELECT status FROM telegram_gifts WHERE order_id=?',o.id).status,'assigned');
 const pending=(await s.req('orders',orderBody(s.p.id,3))).d;s.db.raw.prepare('UPDATE orders SET expires_at=? WHERE id=?').run(Date.now()-1,pending.id);
 await runPaymentReconciliation(s.env);await runPaymentReconciliation(s.env);assert.equal(stock(s).available,20);assert.equal(stock(s).reserved,0);assert.equal(scalar(s,'SELECT status FROM orders WHERE id=?',pending.id).status,'expired');assert.equal(scalar(s,"SELECT count(*) AS n FROM telegram_gifts WHERE status='assigned'").n,2);
 assert.equal((await s.req('orders/demo-pay',credential(pending))).r.status,409);for(const closed of [o,pending]){const found=(await s.req('orders/lookup',credential(closed))).d;assert.equal(found.telegram_gift,null);assert.equal(found.telegram_gift_unlocked,false);}
});
test('confirmation commits stock once and leaves physical order awaiting shipment',async()=>{
 const s=await fixture(),o=(await s.req('orders',orderBody(s.p.id,2))).d;
 const paid=await s.req('orders/demo-pay',credential(o));assert.equal(paid.r.status,200);assert.equal(paid.d.status,'paid');assert.equal(paid.d.shipping_status,'pending');assert.equal(paid.d.tracking_number,'');assert.match(paid.d.telegram_gift,/DEMO-TELEGRAM/);assert.equal(paid.d.telegram_gift_unlocked,true);assert.equal(paid.d.delivery,undefined);
 assert.equal((await s.req('orders/demo-pay',credential(o))).d.status,'paid');assert.equal(stock(s).sold,2);assert.equal(stock(s).reserved,0);assert.equal(stock(s).available,18);assert.equal((await s.req('orders/cancel',credential(o))).r.status,409);
});
test('payment confirmation requires full amount including shipping and unique provider reference',async()=>{
 const s=await fixture(),o=(await s.req('orders',orderBody(s.p.id))).d;
 await assert.rejects(settleOrder(s.db as any,o.id,'test','test','manual','same-reference',o.subtotal),/邮费/);
 await settleOrder(s.db as any,o.id,'test','test','manual','same-reference',o.total);assert.equal((await settleOrder(s.db as any,o.id,'test','test','manual','same-reference',o.total)).idempotent,true);
 const second=(await s.req('orders',orderBody(s.p.id))).d;await assert.rejects(settleOrder(s.db as any,second.id,'test','test','manual','same-reference',second.total),/冲突/);assert.equal(scalar(s,'SELECT status FROM orders WHERE id=?',second.id).status,'pending');assert.equal(stock(s).sold,1);
});
test('shipping requires confirmed payment, valid tracking and authorized operator; lookup has no tracking events',async()=>{
 const s=await fixture();await s.req('auth/demo',{});const o=(await s.req('orders',orderBody(s.p.id))).d;
 assert.equal((await s.req('admin/shipment',{id:o.id,tracking_number:'SF100000'})).r.status,409);await s.req('orders/demo-pay',credential(o));
 assert.equal((await s.req('admin/shipment',{id:o.id,tracking_number:''})).r.status,400);assert.equal((await s.req('admin/shipment',{id:o.id,tracking_number:'<script>'})).r.status,400);
 await s.req('admin/staff',{username:'operator',password:'long-password-123',role:'operator'});await s.req('auth/logout',{});await s.req('auth/login',{username:'operator',password:'long-password-123'});
 assert.equal((await s.req('admin/shipment',{id:o.id,tracking_number:'SF100000'})).r.status,200);assert.equal((await s.req('admin/shipment',{id:o.id,tracking_number:'SF100000'})).d.idempotent,true);assert.equal((await s.req('admin/shipment',{id:o.id,tracking_number:'SF200000'})).r.status,409);
 const found=(await s.req('orders/lookup',credential(o))).d;assert.equal(found.shipping_status,'shipped');assert.equal(found.status,'fulfilled');assert.equal(found.tracking_number,'SF100000');assert.equal(found.tracking_events,undefined);assert.equal(stock(s).sold,1);
});
test('support can supplement address before shipment, but cannot confirm payment, ship, import gifts or modify stock',async()=>{
 const s=await fixture();await s.req('auth/demo',{});const o=(await s.req('orders',orderBody(s.p.id))).d;await s.req('admin/staff',{username:'support',password:'long-password-123',role:'support'});await s.req('auth/logout',{});await s.req('auth/login',{username:'support',password:'long-password-123'});
 assert.equal((await s.req('admin/address',{id:o.id,recipient:'客户',contact:'号码',shipping_address:'完整地址'})).r.status,200);const found=(await s.req('orders/lookup',credential(o))).d;assert.equal(found.shipping_address,'完整地址');
 for(const [path,payload] of [['shipment',{id:o.id,tracking_number:'SF100000'}],['orders',{id:o.id,reference:'paid',reason:'测试确认到账'}],['gifts',{codes:'private | password'}],['inventory',{product_id:s.p.id,delta:1,reason:'入库'}]])assert.equal((await s.req('admin/'+path,payload)).r.status,403);
 assert.equal((await s.req('admin/gifts')).r.status,403);assert.equal((await s.req('admin/overview')).d.readiness,undefined);
 await s.req('orders/cancel',credential(o));assert.equal((await s.req('admin/address',{id:o.id,contact:'changed'})).r.status,409);
});
test('address is locked once shipped and address audit does not store personal details',async()=>{
 const s=await fixture();await s.req('auth/demo',{});const o=(await s.req('orders',orderBody(s.p.id))).d;
 await s.req('admin/address',{id:o.id,shipping_address:'PRIVATE-ADDRESS',contact:'PRIVATE-CONTACT'});assert.ok(!JSON.stringify(scalar(s,"SELECT * FROM audits WHERE action='order.address'")).includes('PRIVATE-'));
 await s.req('orders/demo-pay',credential(o));await s.req('admin/shipment',{id:o.id,tracking_number:'TRACK-001'});
 assert.equal((await s.req('admin/address',{id:o.id,shipping_address:'changed'})).r.status,409);assert.equal((await s.req('orders/lookup',credential(o))).d.shipping_address,'PRIVATE-ADDRESS');
});
test('write endpoints require session, same origin and CSRF',async()=>{
 const s=await fixture();assert.equal((await s.req('admin/inventory',{product_id:s.p.id,delta:1,reason:'入库'})).r.status,401);await s.req('auth/demo',{});
 assert.equal((await s.req('admin/inventory',{product_id:s.p.id,delta:1,reason:'入库'},{'x-csrf-token':'wrong'})).r.status,403);assert.equal((await s.req('admin/settings',{brand:'bad'},{origin:'https://attacker.test'})).r.status,403);
 assert.equal((await s.req('orders',orderBody(s.p.id),{origin:'https://attacker.test'})).r.status,403);
});
test('gift import deduplicates account identity, authenticates encryption, and excludes plaintext from lists',async()=>{
 const s=await fixture();await s.req('auth/demo',{});
 const imported=await s.req('admin/gifts',{codes:'ACCOUNT-ONE | private-password\naccount-one | other-password\nACCOUNT-TWO | second-password'});assert.equal(imported.d.imported,2);assert.equal(imported.d.skipped,1);
 assert.equal((await s.req('admin/gifts',{codes:'account-one | changed-password'})).d.imported,0);assert.equal((await s.req('admin/gifts',{codes:'| missing identity'})).r.status,400);
 const listed=JSON.stringify((await s.req('admin/gifts')).d);assert.ok(!listed.includes('password'));assert.ok(!listed.includes('ACCOUNT-ONE'));
 for(const row of s.db.raw.prepare('SELECT ciphertext FROM telegram_gifts').all())assert.ok(!String(row.ciphertext).includes('private-password'));
});
test('production requires non-example gift inventory and never exposes demo catalog or demo payment',async()=>{
 const s=await fixture();await s.req('auth/demo',{});s.env.DEMO_MODE='false';assert.equal((await s.req('catalog')).d.products.length,0);assert.equal((await s.req('orders',orderBody(s.p.id))).r.status,400);
 assert.equal((await s.req('admin/gifts')).r.status,401);assert.equal((await s.req('auth/setup',{username:'production-owner',password:'owner-password-2026',token:s.env.BOOTSTRAP_TOKEN})).r.status,200);
 s.db.raw.prepare('UPDATE products SET is_example=0 WHERE id=?').run(s.p.id);assert.equal((await s.req('orders',orderBody(s.p.id))).r.status,409);
 await s.req('admin/gifts',{codes:'REAL-POOL-TEST-FIXTURE | test-only-password'});const o=(await s.req('orders',orderBody(s.p.id))).d;assert.equal(o.demo,0);assert.equal(o.telegram_gift,null);assert.equal(o.telegram_gift_unlocked,false);await s.req('admin/orders',{id:o.id,reference:'real-fixture-manual',reason:'隔离测试登记已收款'});assert.equal((await s.req('orders/lookup',credential(o))).d.telegram_gift,'REAL-POOL-TEST-FIXTURE | test-only-password');assert.equal((await s.req('orders/demo-pay',credential(o))).r.status,403);
});
test('all payment placeholders fail closed despite historical configuration and make no outbound requests',async t=>{
 const s=await fixture();let outbound=0;t.mock.method(globalThis,'fetch',async()=>{outbound++;throw Error('No payment network permitted');});
 Object.assign(s.env,{PAYMENT_PROVIDER:'trc20',TRON_RECEIVING_ADDRESS:'old-address',TRONGRID_API_KEY:'old-key',PAYMENT_WEBHOOK_SECRET:'old-webhook',DIDIPIFA_API_TOKEN:'old-token',DIDIPIFA_PURCHASE_ENABLED:'true'});
 const o=(await s.req('orders',orderBody(s.p.id))).d;for(const method of ['wechat','alipay','usdt']){const r=await s.req('payments/create',{...credential(o),method});assert.equal(r.r.status,503);assert.equal(r.d.status,'unavailable');assert.equal(r.d.method,method);}
 for(const path of ['payments/check','payments/webhook','payments/webhook/wechat','payments/webhook/alipay','payments/webhook/usdt'])assert.equal((await s.req(path,{orderId:o.id,status:'paid',amount:o.total})).r.status,503);
 await s.req('auth/demo',{});assert.equal((await s.req('admin/supplier',{action:'purchase'})).r.status,410);assert.equal((await s.req('admin/payment',{})).r.status,503);await runPaymentReconciliation(s.env);assert.equal(outbound,0);assert.equal((await s.req('orders/lookup',credential(o))).d.status,'pending');
});
test('inventory adjustment cannot consume locked stock; product images reject unsafe protocols',async()=>{
 const s=await fixture();await s.req('auth/demo',{});await s.req('orders',orderBody(s.p.id,2));assert.equal((await s.req('admin/inventory',{product_id:s.p.id,delta:-19,reason:'盘点调整'})).r.status,409);assert.equal(stock(s).available,18);assert.equal(stock(s).reserved,2);
 assert.equal((await s.req('admin/inventory',{product_id:s.p.id,delta:5,reason:'采购入库'})).r.status,200);assert.equal(stock(s).available,23);
 assert.equal((await s.req('admin/products',{...s.p,image_url:'javascript:alert(1)'})).r.status,400);assert.equal((await s.req('admin/products',{...s.p,image_url:'https://images.example.test/mug.jpg',icon_key:'cup'})).r.status,200);
 assert.equal((await s.req('admin/products',{...s.p,icon_key:'../private'})).r.status,400);
});
test('refund registration preserves gift assignment and does not silently restock returned merchandise',async()=>{
 const s=await fixture();await s.req('auth/demo',{});const o=(await s.req('orders',orderBody(s.p.id))).d;await s.req('orders/demo-pay',credential(o));
 assert.equal((await s.req('admin/orders',{id:o.id,action:'refund',reference:'refund-001',reason:'已经在支付平台退回'})).r.status,200);const refunded=(await s.req('orders/lookup',credential(o))).d;assert.equal(refunded.status,'refunded');assert.equal(refunded.telegram_gift_unlocked,true);assert.match(refunded.telegram_gift,/DEMO-TELEGRAM/);assert.equal(stock(s).sold,1);assert.equal(stock(s).available,19);assert.equal(scalar(s,'SELECT status FROM telegram_gifts WHERE order_id=?',o.id).status,'assigned');
});
test('customer tickets persist and require the order secret',async()=>{
 const s=await fixture(),o=(await s.req('orders',orderBody(s.p.id))).d;assert.equal((await s.req('tickets',{orderId:o.id,secret:'wrong',subject:'补充地址',message:'请协助补充收货信息'})).r.status,404);
 const ticket=await s.req('tickets',{orderId:o.id,secret:o.secret,subject:'补充地址',message:'请协助补充收货信息'});assert.equal(ticket.r.status,201);await s.req('auth/demo',{});await s.req('admin/tickets',{id:ticket.d.id,reply:'请通过客服确认信息',closed:true});assert.equal((await s.req('orders/lookup',credential(o))).d.tickets[0].reply,'请通过客服确认信息');
});
test('legacy records remain queryable without exposing old commerce write routes',async()=>{
 const s=await setup(true,6);const legacy=async(path:string,b?:any)=>{const r=await legacyApi(new Request('https://store.test/api/'+path,{method:b?'POST':'GET',headers:{origin:'https://store.test','content-type':'application/json'},...(b?{body:JSON.stringify(b)}:{})}),s.env);return r.json() as Promise<any>;};
 const cat=await legacy('catalog'),o=await legacy('orders',{contact:'historical@test.invalid',acceptedTerms:true,items:[{id:cat.products[0].id,quantity:1}]});await legacy('orders/demo-pay',credential(o));s.db.raw.prepare("UPDATE settings SET value='自定义品牌' WHERE key='brand'").run();
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort().slice(6))s.db.raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const found=await s.req('orders/lookup',credential(o));assert.equal(found.r.status,200,JSON.stringify(found.d));assert.equal(found.d.order_type,'digital');assert.equal(found.d.delivery.length,1);assert.equal((await s.req('orders/cancel',credential(o))).r.status,409);
 const fresh=(await s.req('catalog')).d;assert.ok(fresh.products.every((p:any)=>p.product_type==='physical'));assert.equal(fresh.settings.brand,'自定义品牌');assert.match(fresh.settings.announcement,/实体商品/);assert.match(fresh.settings.privacy,/收货地址/);
});

test('unpaid responses and checkout replay cannot leak gifts through spoofed payment fields or missing payment evidence',async()=>{
 const s=await fixture(),payload=orderBody(s.p.id,1,{checkoutToken:'b'.repeat(64),status:'paid',paid_at:Date.now(),telegram_gift_unlocked:true});
 const o=(await s.req('orders',payload)).d;assert.equal(o.status,'pending');assert.equal(o.telegram_gift,null);
 const key=s.env.INVENTORY_KEY;delete s.env.INVENTORY_KEY;
 for(const path of ['orders','orders/lookup']){
  const r=await s.req(path,path==='orders'?payload:{...credential(o),status:'paid',paid_at:Date.now(),telegram_gift_unlocked:true});
  assert.equal(r.r.status,path==='orders'?201:200);assert.equal(r.d.telegram_gift,null);assert.equal(r.d.telegram_gift_unlocked,false);assert.ok(!JSON.stringify(r.d).includes('DEMO-TELEGRAM'));assert.equal(r.r.headers.get('cache-control'),'no-store');
 }
 s.env.INVENTORY_KEY=key;
 s.db.raw.prepare("UPDATE orders SET status='paid',paid_at=NULL WHERE id=?").run(o.id);assert.equal((await s.req('orders/lookup',credential(o))).d.telegram_gift,null);
 s.db.raw.prepare("UPDATE orders SET status='pending',paid_at=? WHERE id=?").run(Date.now(),o.id);assert.equal((await s.req('orders/lookup',credential(o))).d.telegram_gift,null);
 s.db.raw.prepare('UPDATE orders SET paid_at=NULL WHERE id=?').run(o.id);
 const paid=(await s.req('orders/demo-pay',credential(o))).d;const replay=(await s.req('orders',payload)).d;assert.equal(replay.id,o.id);assert.equal(replay.telegram_gift,paid.telegram_gift);assert.equal(replay.telegram_gift_unlocked,true);
});
test('empty or absent tracking numbers always display unshipped and a real number is returned in the order query',async()=>{
 for(const value of [undefined,null,'','  ','无',' 无 '])assert.deepEqual(shipmentDisplay(value),{trackingNumber:'',shipped:false,label:'未发货'});
 const s=await fixture(),o=(await s.req('orders',orderBody(s.p.id))).d;
 for(const value of ['','  ','无']){s.db.raw.prepare("UPDATE orders SET shipping_status='shipped',tracking_number=? WHERE id=?").run(value,o.id);const found=(await s.req('orders/lookup',credential(o))).d;assert.equal(found.shipping_status,'pending');assert.equal(found.tracking_number,'');assert.equal(found.telegram_gift,null);}
 s.db.raw.prepare("UPDATE orders SET shipping_status='pending',tracking_number=' SF12345678 ' WHERE id=?").run(o.id);const found=(await s.req('orders/lookup',credential(o))).d;assert.equal(found.shipping_status,'shipped');assert.equal(found.tracking_number,'SF12345678');assert.equal(shipmentDisplay(found.tracking_number).label,'已发货');assert.equal(found.telegram_gift,null);
});
test('previous demo copy updates to payment-only disclosure without reseeding accounts or changing custom copy',async()=>{
 const s=await fixture();s.db.raw.exec("DELETE FROM settings WHERE key='gift_payment_copy_v2'");
 s.db.raw.prepare("UPDATE settings SET value=? WHERE key='announcement'").run('实体商品自助下单，每单固定邮费 ¥20；地址和联系方式可留空，下单赠 Telegram 客服及售后通讯账号。');
 s.db.raw.prepare("UPDATE settings SET value='自定义客服说明' WHERE key='support'").run();
 const catalog=(await s.req('catalog')).d;assert.match(catalog.settings.announcement,/付款成功后显示/);assert.equal(catalog.settings.support,'自定义客服说明');assert.equal(scalar(s,'SELECT count(*) AS n FROM telegram_gifts').n,30);
});
