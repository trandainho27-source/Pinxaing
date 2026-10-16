import type { RuntimeEnv, Product, Order, Staff } from './types.ts';
import {uid,randomToken,sha,safeEqual,hashPassword,verifyPassword,encrypt,decrypt} from './security.ts';
import {ApiError,fail,now,json,str,integer,body,database,stmt,all,first,audit,limit,authenticated,loginSession} from './api-common.ts';
import {categorySeed,productSeed} from './seed.ts';
import {paymentMethods,reservedPayment,type PaymentMethod} from './payment-providers.ts';
import {lookup as lookupHistoricalOrder} from './legacy-api.ts';
export const SHIPPING_FEE = 2000;
const GIFT_CONTEXT = 'pinxiang-telegram-gift';
const categoryQuery = `SELECT c.* FROM categories c WHERE NOT EXISTS(SELECT 1 FROM products p WHERE p.category_id=c.id AND p.product_type='digital') OR EXISTS(SELECT 1 FROM products p WHERE p.category_id=c.id AND p.product_type='physical') ORDER BY c.sort`;
const productQuery = `SELECT p.*,coalesce(s.available,0) AS stock,coalesce(s.reserved,0) AS reserved,coalesce(s.sold,0) AS sold FROM products p LEFT JOIN physical_stock s ON s.product_id=p.id`;
function guard(db:D1Database, condition:string, ...args:any[]) {
    const id=uid();return [stmt(db,`INSERT INTO transaction_guards(id,passed) SELECT ?,CASE WHEN ${condition} THEN 1 ELSE 0 END`,id,...args),stmt(db,'DELETE FROM transaction_guards WHERE id=?',id)];
}
function releaseStock(db:D1Database) {
    return [stmt(db,`UPDATE physical_stock SET available=available+(SELECT coalesce(sum(r.quantity),0) FROM physical_reservations r JOIN orders o ON o.id=r.order_id WHERE r.product_id=physical_stock.product_id AND r.status='reserved' AND o.status IN('expired','cancelled')),reserved=reserved-(SELECT coalesce(sum(r.quantity),0) FROM physical_reservations r JOIN orders o ON o.id=r.order_id WHERE r.product_id=physical_stock.product_id AND r.status='reserved' AND o.status IN('expired','cancelled'))`),
    stmt(db,`UPDATE physical_reservations SET status='released' WHERE status='reserved' AND order_id IN(SELECT id FROM orders WHERE status IN('expired','cancelled'))`)];
}
async function expire(db:D1Database) {
    await db.batch([stmt(db,"UPDATE orders SET status='expired' WHERE status='pending' AND expires_at<?",now()),...releaseStock(db),stmt(db,"UPDATE inventory SET status='available',order_id=NULL WHERE status='reserved' AND order_id IN(SELECT id FROM orders WHERE status IN('expired','cancelled'))"),stmt(db,'DELETE FROM sessions WHERE expires_at<?',now()),stmt(db,'DELETE FROM rate_limits WHERE reset_at<?',now())]);
}
async function settings(db:D1Database) {return Object.fromEntries((await all(db,'SELECT * FROM settings')).map(x=>[x.key,x.value]));}
async function seed(db:D1Database,env:RuntimeEnv,actor:string) {
    if(env.DEMO_MODE!=='true')fail(403,'正式环境不能导入演示内容');
    if(!env.INVENTORY_KEY)fail(503,'赠送账号加密密钥未配置');
    if(await first(db,"SELECT key FROM settings WHERE key='physical_demo_seeded'"))return {ok:true};
    const st:D1PreparedStatement[]=[],ts=now();
    categorySeed.forEach(([id,name,icon],i)=>st.push(stmt(db,'INSERT OR IGNORE INTO categories VALUES(?,?,?,?,1)',id,name,icon,i)));
    for(const [id,category,name,subtitle,icon,price] of productSeed){
        st.push(stmt(db,`INSERT OR IGNORE INTO products(id,category_id,name,subtitle,description,instructions,price,compare_price,min_qty,max_qty,featured,active,region,tag,is_example,created_at,product_type,icon_key) VALUES(?,?,?,?,?,?,?,0,1,20,1,1,'中国','生活精选',1,?,'physical',?)`,id,category,name,subtitle,'这是用于演示的实体商品，不会产生真实配送。正式经营时请替换成你的真实商品、材质、尺寸和图片。','每单固定邮费 ¥20，不可取消。收货地址及联系方式可留空，下单后可通过赠送的 Telegram 账号联系客服补充。',price,ts,icon));
        st.push(stmt(db,'INSERT OR IGNORE INTO physical_stock(product_id,available,reserved,sold) VALUES(?,20,0,0)',id));
    }
    for(let n=1;n<=30;n++){
        const content=`DEMO-TELEGRAM-${String(n).padStart(3,'0')} | 仅用于界面演示，不能登录 Telegram`;
        st.push(stmt(db,`INSERT OR IGNORE INTO telegram_gifts(id,ciphertext,fingerprint,status,is_example,created_at) VALUES(?,?,?,'available',1,?)`,uid(),await encrypt(content,env.INVENTORY_KEY!,GIFT_CONTEXT),await sha('demo-gift-'+n),ts));
    }
    const defaults={brand:'品享',tagline:'精选日常好物，让生活多一点喜欢。',announcement:'实体商品自助下单，每单固定邮费 ¥20；地址和联系方式可留空，下单赠 Telegram 客服及售后通讯账号。',support:'可使用订单中的 Telegram 赠送账号联系客服，或提交售后工单。',telegramSupport:'',businessHours:'工作日 09:00–18:00',footer:'日常好物，自助选购',terms:'本商城售卖实体商品。每笔订单固定收取 20 元邮费，不可取消。地址和联系方式可留空，发货前请通过客服补充。每单赠送一个 Telegram 通讯账号用于联系客服和售后。已展示的赠送账号不会因取消订单而回收。退款与退换货请联系商家。',privacy:'收货地址和联系方式均可选填，仅用于订单配送与售后。订单密钥用于访问订单和赠送账号，请妥善保存。'};
    const oldDefaults:Record<string,string>={tagline:'好工具，好灵感，好好享受数字生活。',announcement:'欢迎体验品享。这是独立演示商城，示例商品用于体验购买与交付，不收取真实款项。',footer:'数字商品交付平台',terms:'购买前请确认商品说明、适用地区及使用条件。数字商品交付后，如有质量问题请凭订单号提交售后工单。',support:'请通过订单页面提交售后工单',privacy:'仅收集履行订单必需的联系信息。查询密钥用于验证订单访问权限。联系信息仅供客服处理订单使用。'};
    for(const [key,value] of Object.entries(defaults))st.push(stmt(db,`INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value=?`,key,value,oldDefaults[key]??value));
    st.push(stmt(db,"INSERT OR IGNORE INTO settings VALUES('physical_demo_seeded','1')"),audit(db,actor,'physical.demo.seed','catalog'));
    await db.batch(st);return {ok:true};
}
async function catalog(db:D1Database,env:RuntimeEnv){
    if(env.DEMO_MODE==='true')await seed(db,env,'system');await expire(db);
    return {products:await all(db,productQuery+` WHERE p.product_type='physical' AND p.active=1 ${env.DEMO_MODE==='true'?'':'AND p.is_example=0'} AND p.category_id IN(SELECT id FROM categories WHERE active=1) ORDER BY p.featured DESC,p.created_at DESC`),categories:await all(db,`SELECT * FROM categories c WHERE c.active=1 AND EXISTS(SELECT 1 FROM products p WHERE p.category_id=c.id AND p.product_type='physical' AND p.active=1 ${env.DEMO_MODE==='true'?'':'AND p.is_example=0'}) ORDER BY c.sort`),settings:await settings(db),demo:env.DEMO_MODE==='true',paymentEnabled:false,paymentMethods,shippingFee:SHIPPING_FEE,giftAvailable:!!await first(db,"SELECT id FROM telegram_gifts WHERE status='available' AND is_example=? LIMIT 1",env.DEMO_MODE==='true'?1:0)};
}
async function lookup(db:D1Database,env:RuntimeEnv,id:string,secret:string):Promise<any>{
    const row=await first<any>(db,'SELECT * FROM orders WHERE id=? AND ready=1',id);
    if(!row || !safeEqual(await sha(secret),row.lookup_hash))fail(404,'订单号或查询密钥不正确');
    if(row.order_type!=='physical')return lookupHistoricalOrder(db,env,id,secret);
    const {lookup_hash,checkout_hash,checkout_payload_hash,...order}=row;
    const gift=await first<any>(db,'SELECT ciphertext FROM telegram_gifts WHERE order_id=?',id);
    return {...order,items:await all(db,'SELECT product_id,product_name,price,quantity FROM order_items WHERE order_id=?',id),tickets:await all(db,'SELECT * FROM tickets WHERE order_id=? ORDER BY created_at DESC',id),telegram_gift:gift?await decrypt(gift.ciphertext,env.INVENTORY_KEY!,GIFT_CONTEXT):null};
}
export function reservationGuard(db:D1Database,orderId:string){
    return guard(db,`EXISTS(SELECT 1 FROM orders o WHERE o.id=? AND o.order_type='physical' AND o.status='pending' AND o.shipping_fee=2000 AND o.total=o.subtotal+2000
        AND o.subtotal=(SELECT sum(price*quantity) FROM order_items WHERE order_id=o.id)
        AND EXISTS(SELECT 1 FROM telegram_gifts WHERE order_id=o.id AND status='assigned')
        AND NOT EXISTS(SELECT 1 FROM order_items i JOIN products p ON p.id=i.product_id JOIN categories c ON c.id=p.category_id WHERE i.order_id=o.id AND (p.active!=1 OR c.active!=1 OR p.product_type!='physical' OR p.price!=i.price OR i.quantity<p.min_qty OR i.quantity>p.max_qty
            OR NOT EXISTS(SELECT 1 FROM physical_stock s WHERE s.product_id=p.id)
            OR NOT EXISTS(SELECT 1 FROM physical_reservations r WHERE r.order_id=o.id AND r.product_id=p.id AND r.quantity=i.quantity AND r.status='reserved'))))`,orderId);
}
export async function settleOrder(db:D1Database,id:string,actor:string,reason:string,provider:string,reference:string,amount?:number){
    const order=await first<any>(db,"SELECT * FROM orders WHERE id=? AND order_type='physical'",id);if(!order)fail(404,'实体订单不存在');
    if(amount!==undefined && amount!==order.total)fail(400,'付款金额必须包含商品金额及固定 20 元邮费');
    if(['paid','fulfilled'].includes(order.status)){if(order.payment_ref!==reference||order.payment_provider!==provider)fail(409,'订单已有其他付款记录');return {ok:true,idempotent:true};}
    if(order.status!=='pending'||order.expires_at<=now())fail(409,'订单已关闭或过期');
    try{await db.batch([
        stmt(db,"UPDATE orders SET status='paid',paid_at=?,payment_provider=?,payment_ref=? WHERE id=? AND status='pending' AND expires_at>?",now(),provider,reference,id,now()),
        stmt(db,`UPDATE physical_stock SET reserved=reserved-(SELECT r.quantity FROM physical_reservations r WHERE r.product_id=physical_stock.product_id AND r.order_id=? AND r.status='reserved'),sold=sold+(SELECT r.quantity FROM physical_reservations r WHERE r.product_id=physical_stock.product_id AND r.order_id=? AND r.status='reserved') WHERE product_id IN(SELECT product_id FROM physical_reservations WHERE order_id=? AND status='reserved') AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status='paid' AND payment_ref=? AND payment_provider=?)`,id,id,id,id,reference,provider),
        stmt(db,"UPDATE physical_reservations SET status='committed' WHERE order_id=? AND status='reserved' AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status='paid' AND payment_ref=? AND payment_provider=?)",id,id,reference,provider),
        ...guard(db,`EXISTS(SELECT 1 FROM orders o WHERE o.id=? AND o.status='paid' AND o.payment_ref=? AND o.payment_provider=? AND NOT EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=o.id AND NOT EXISTS(SELECT 1 FROM physical_reservations r WHERE r.order_id=o.id AND r.product_id=i.product_id AND r.quantity=i.quantity AND r.status='committed')))`,id,reference,provider),audit(db,actor,'order.paid',id,reason)
    ]);}catch{fail(409,'付款记录或库存状态冲突，请刷新核对');}
    return {ok:true};
}
async function createOrder(db:D1Database,env:RuntimeEnv,b:any){
    if(!Array.isArray(b.items)||!b.items.length||b.items.length>12)fail(400,'请选择 1–12 种商品');
    if(b.acceptedTerms!==true)fail(400,'请同意购买协议');
    const contact=str(b.contact,100),address=str(b.shipping_address,500),recipient=str(b.recipient,60),method=str(b.payment_method,20)||'wechat';
    if(!paymentMethods.some(p=>p.id===method))fail(400,'请选择微信、支付宝或 USDT');
    const secret=b.checkoutToken===undefined?randomToken():str(b.checkoutToken,128);if(!/^[a-f0-9]{64}$/.test(secret))fail(400,'下单凭证格式无效');
    const hash=await sha(secret),combined=new Map<string,number>();
    for(const item of b.items){if(!item||typeof item!=='object')fail(400,'商品格式无效');const id=str(item.id,64),q=integer(item.quantity,1,100);combined.set(id,(combined.get(id)||0)+q);}
    const payloadHash=await sha(JSON.stringify({contact,address,recipient,method,items:[...combined].sort((a,b)=>a[0].localeCompare(b[0]))}));
    const replay=async()=>{const existing=await first<any>(db,'SELECT id,checkout_payload_hash FROM orders WHERE checkout_hash=?',hash);if(!existing)return null;if(existing.checkout_payload_hash!==payloadHash)fail(409,'同一下单凭证不能用于不同订单');return {...await lookup(db,env,existing.id,secret),secret,idempotent:true};};
    const prior=await replay();if(prior)return prior;
    const lines:{p:Product;q:number}[]=[];
    for(const [id,q] of combined){const p=await first<Product>(db,productQuery+` WHERE p.id=? AND p.product_type='physical' AND p.active=1 AND p.category_id IN(SELECT id FROM categories WHERE active=1)`,id);if(!p)fail(400,'商品不存在或已下架');if(p!.is_example&&env.DEMO_MODE!=='true')fail(400,'示例商品不能用于正式交易');if(q<p!.min_qty||q>p!.max_qty||q>p!.stock)fail(409,`${p!.name} 库存不足或数量超限`);lines.push({p:p!,q});}
    if(!await first(db,"SELECT id FROM telegram_gifts WHERE status='available' AND is_example=? LIMIT 1",env.DEMO_MODE==='true'?1:0))fail(409,'赠送 Telegram 账号暂时缺货，请稍后再下单');
    if(!env.INVENTORY_KEY)fail(503,'赠送账号加密配置尚未完成');
    const subtotal=lines.reduce((n,l)=>n+l.p.price*l.q,0),total=subtotal+SHIPPING_FEE,id='PX'+new Date().toISOString().slice(0,10).replaceAll('-','')+randomToken().slice(0,12).toUpperCase(),ts=now();
    const st=[stmt(db,`INSERT INTO orders(id,lookup_hash,contact,total,status,ready,demo,created_at,expires_at,order_type,subtotal,shipping_fee,recipient,shipping_address,payment_method,checkout_hash,checkout_payload_hash) VALUES(?,?,?,?,'pending',0,?,?,?,'physical',?,?,?,?,?,?,?)`,id,hash,contact,total,env.DEMO_MODE==='true'?1:0,ts,ts+30*60000,subtotal,SHIPPING_FEE,recipient,address,method,hash,payloadHash)];
    for(const {p,q} of lines){st.push(stmt(db,'INSERT INTO order_items VALUES(?,?,?,?,?,?)',uid(),id,p.id,p.name,p.price,q),stmt(db,'UPDATE physical_stock SET available=available-?,reserved=reserved+? WHERE product_id=?',q,q,p.id),stmt(db,"INSERT INTO physical_reservations VALUES(?,?,?,?,'reserved')",uid(),id,p.id,q));}
    st.push(stmt(db,`UPDATE telegram_gifts SET status='assigned',order_id=?,assigned_at=? WHERE id=(SELECT id FROM telegram_gifts WHERE status='available' AND is_example=? ORDER BY created_at,id LIMIT 1)`,id,ts,env.DEMO_MODE==='true'?1:0),...reservationGuard(db,id),stmt(db,'UPDATE orders SET ready=1 WHERE id=?',id));
    try{await db.batch(st);}catch{const duplicate=await replay();if(duplicate)return duplicate;fail(409,'商品或赠送账号库存发生变化，请刷新后重试');}
    return {...await lookup(db,env,id,secret),secret};
}
export async function handleApi(request:Request,env:RuntimeEnv):Promise<Response>{
    try{
        const db=database(env),url=new URL(request.url),path=url.pathname.replace(/^\/api\//,''),method=request.method;
        if(!['GET','POST'].includes(method))fail(405,'请求方法不支持');
        // Future payment callbacks are deliberately unavailable, even if historical secrets remain configured.
        if(path.startsWith('payments/webhook'))return json({error:'支付回调接口已预留，尚未接入'},503);
        if(method!=='GET'){if(request.headers.get('origin')!==url.origin)fail(403,'请求来源不正确');if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'请使用 JSON 格式');}
        if(path==='health'&&method==='GET'){await first(db,'SELECT count(*) AS n FROM physical_stock');return json({ok:true,database:true,commerce:'physical'});}
        if(path==='catalog'&&method==='GET')return json(await catalog(db,env));
        if (path === 'auth/status' && method === 'GET') {
            const count = await first<{
                n: number;
            }>(db, 'SELECT count(*) AS n FROM staff');
            return json({ initialized: !!count!.n, demo: env.DEMO_MODE === 'true' });
        }
        if (path === 'auth/setup' && method === 'POST') {
            await limit(db, request, 'setup', 5);
            const b = await body(request);
            if (!env.BOOTSTRAP_TOKEN || !safeEqual(str(b.token, 128), env.BOOTSTRAP_TOKEN))
                fail(403, '初始化令牌不正确');
            if (!/^[a-zA-Z0-9_-]{3,32}$/.test(b.username || '') || typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 128)
                fail(400, '账号需为 3–32 位字母或数字，密码至少 12 位');
            const id = uid();
            try {
                await db.batch([stmt(db, "INSERT INTO staff SELECT ?,?,?,'owner',1,? WHERE NOT EXISTS(SELECT 1 FROM staff)", id, b.username, await hashPassword(b.password), now()), audit(db, id, 'auth.setup', 'owner')]);
            }
            catch {
                fail(409, '管理员已初始化');
            }
            const person = await first(db, 'SELECT id FROM staff WHERE id=?', id);
            if (!person)
                fail(409, '管理员已初始化');
            return loginSession(db, id);
        }
        if (path === 'auth/login' && method === 'POST') {
            await limit(db, request, 'login', 8);
            const b = await body(request);
            const s = await first<Staff & {
                password_hash: string;
            }>(db, 'SELECT * FROM staff WHERE username=? AND active=1', str(b.username, 32));
            const hash = s?.password_hash || await hashPassword('constant-time-dummy');
            if (typeof b.password !== 'string' || b.password.length > 128 || !await verifyPassword(b.password, hash) || !s)
                fail(401, '账号或密码不正确');
            return loginSession(db, s!.id);
        }
        if (path === 'auth/demo' && method === 'POST') {
            if (env.DEMO_MODE !== 'true')
                fail(403, '生产环境不提供演示入口');
            await limit(db, request, 'demo', 10);
            const id = 'demo-owner';
            await stmt(db, "INSERT OR IGNORE INTO staff VALUES(?,'demo',?,'owner',1,?)", id, await hashPassword(randomToken()), now()).run();
            await seed(db, env, id);
            return loginSession(db, id);
        }
        if (path === 'auth/me' && method === 'GET')
            return json(await authenticated(db, request));
        if (path === 'auth/logout' && method === 'POST') {
            const p = await authenticated(db, request);
            await stmt(db, 'DELETE FROM sessions WHERE staff_id=? AND csrf=?', p.id, p.csrf).run();
            return json({ ok: true }, 200, { 'Set-Cookie': 'px_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
        }
        if(path==='orders'&&method==='POST'){await limit(db,request,'order',10);await expire(db);return json(await createOrder(db,env,await body(request)),201);}
        if(path==='orders/lookup'&&method==='POST'){await limit(db,request,'lookup',20);await expire(db);const b=await body(request);return json(await lookup(db,env,str(b.id,64),str(b.secret,128)));}
        if(path==='orders/demo-pay'&&method==='POST'){
            if(env.DEMO_MODE!=='true')fail(403,'正式商城不提供模拟付款');await limit(db,request,'demo-pay',10);await expire(db);const b=await body(request),id=str(b.id,64),secret=str(b.secret,128);const order=await lookup(db,env,id,secret);if(!order.demo)fail(403,'正式订单不能模拟付款');await settleOrder(db,id,'demo-buyer','仅演示，未收取款项','demo','demo-'+id);return json(await lookup(db,env,id,secret));
        }
        if(path==='orders/cancel'&&method==='POST'){
            const b=await body(request),id=str(b.id,64);const o=await lookup(db,env,id,str(b.secret,128));if(o.order_type!=='physical')fail(409,'历史订单仅供查询');if(o.status==='cancelled')return json({ok:true});if(o.status!=='pending')fail(409,'当前订单无法取消');
            try{await db.batch([stmt(db,"UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'",id),...guard(db,"EXISTS(SELECT 1 FROM orders WHERE id=? AND status='cancelled')",id),...releaseStock(db)]);}catch{fail(409,'订单状态已变化，无法取消');}return json({ok:true});
        }
        if(path==='tickets'&&method==='POST'){
            await limit(db,request,'ticket',10);const b=await body(request);await lookup(db,env,str(b.orderId,64),str(b.secret,128));const subject=str(b.subject,100),message=str(b.message,2000);if(!subject||message.length<5)fail(400,'请填写问题主题和详细说明');const id=uid();await stmt(db,"INSERT INTO tickets VALUES(?,?,?,?,'open','',?,?)",id,b.orderId,subject,message,now(),now()).run();return json({ok:true,id},201);
        }
        if(path==='payments/methods'&&method==='GET')return json({methods:paymentMethods});
        if(path==='payments/create'&&method==='POST'){
            await limit(db,request,'payment-create',10);const b=await body(request),order=await lookup(db,env,str(b.id,64),str(b.secret,128));const selected=str(b.method,20)||order.payment_method;if(!paymentMethods.some(p=>p.id===selected))fail(400,'支付方式无效');return json({...reservedPayment({orderId:order.id,amount:order.total,currency:'CNY',method:selected as PaymentMethod}),error:'支付接口已预留，尚未接通'},503);
        }
        if(path==='payments/check')fail(503,'支付查询接口已预留，尚未接通');
        if(path.startsWith('admin/')){
            const section=path.split('/')[1],roleMap:Record<string,string[]>={products:['owner','operator'],inventory:['owner','operator'],gifts:['owner'],shipment:['owner','operator'],categories:['owner','operator'],settings:['owner'],staff:['owner'],audits:['owner'],payment:['owner'],seed:['owner']};
            const p=await authenticated(db,request,roleMap[section]);await expire(db);
            if(section==='payment'&&method==='GET')return json({methods:paymentMethods,shippingFee:SHIPPING_FEE,demo:env.DEMO_MODE==='true'});
            if(section==='payment'&&method==='POST')fail(503,'三个支付接口均已预留，暂未接通');
            if(section==='supplier')fail(410,'实体商城不启用原数字货源采购接口');
            if(section==='overview'&&method==='GET'){
                const stats=await first(db,`SELECT count(*) AS orders,coalesce(sum(CASE WHEN status IN('paid','fulfilled') THEN total ELSE 0 END),0) AS revenue,coalesce(sum(status='pending'),0) AS pending,coalesce(sum(status='paid' AND shipping_status='pending'),0) AS awaitingShipment,coalesce(sum(shipping_status='shipped'),0) AS fulfilled FROM orders WHERE order_type='physical'`),stock=await first(db,'SELECT coalesce(sum(available),0) AS stock FROM physical_stock'),tickets=await first(db,"SELECT count(*) AS tickets FROM tickets WHERE status='open'");
                return json({stats:{...stats,...stock,...tickets},trend:await all(db,`SELECT date(created_at/1000,'unixepoch','+8 hours') AS day,count(*) AS orders,coalesce(sum(CASE WHEN status IN('paid','fulfilled') THEN total ELSE 0 END),0) AS revenue FROM orders WHERE order_type='physical' AND created_at>? GROUP BY day ORDER BY day`,now()-7*86400000),recent:await all(db,"SELECT id,contact,total,status,created_at,demo,shipping_status,tracking_number FROM orders WHERE order_type='physical' ORDER BY created_at DESC LIMIT 8"),lowStock:await all(db,productQuery+" WHERE p.product_type='physical' AND p.active=1 AND coalesce(s.available,0)<10 LIMIT 10"),demo:env.DEMO_MODE==='true',readiness:p.role==='owner'?{brandReady:!!(await settings(db)).brand,products:(await first<any>(db,"SELECT count(*) AS n FROM products WHERE product_type='physical' AND active=1")).n,stock:(stock as any).stock,gifts:(await first<any>(db,"SELECT count(*) AS n FROM telegram_gifts WHERE status='available' AND is_example=?",env.DEMO_MODE==='true'?1:0)).n,demo:env.DEMO_MODE==='true',encryptionReady:!!env.INVENTORY_KEY,paymentReady:false}:undefined});
            }
            if(section==='products'&&method==='GET')return json({products:await all(db,productQuery+" WHERE p.product_type='physical' ORDER BY p.created_at DESC"),categories:await all(db,categoryQuery)});
            if(section==='products'&&method==='POST'){
                const b=await body(request),id=str(b.id,64)||uid(),name=str(b.name,120),category=str(b.category_id,64),imageUrl=str(b.image_url,1000);
                if(!name||!await first(db,'SELECT id FROM categories WHERE id=?',category))fail(400,'商品名称或分类无效');if(await first(db,"SELECT id FROM products WHERE id=? AND product_type!='physical'",id))fail(409,'历史数字商品不能直接转为实体商品');
                if(imageUrl){try{const u=new URL(imageUrl);if(u.protocol!=='https:'||u.username||u.password)throw Error();}catch{fail(400,'商品图片需为有效的 HTTPS 地址');}}
                const price=integer(b.price,1,10000000),min=integer(b.min_qty,1,100),max=integer(b.max_qty,min,100),iconKey=str(b.icon_key,20);
                if(!['','cup','bottle','bag','lamp','notebook','desk','home','outdoor','umbrella','box'].includes(iconKey))fail(400,'请选择有效的实体商品图标');
                await db.batch([stmt(db,`INSERT INTO products(id,category_id,name,subtitle,description,instructions,price,compare_price,min_qty,max_qty,featured,active,region,tag,is_example,created_at,product_type,icon_key,image_url) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,'physical',?,?) ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id,name=excluded.name,subtitle=excluded.subtitle,description=excluded.description,instructions=excluded.instructions,price=excluded.price,compare_price=excluded.compare_price,min_qty=excluded.min_qty,max_qty=excluded.max_qty,featured=excluded.featured,active=excluded.active,region=excluded.region,tag=excluded.tag,icon_key=excluded.icon_key,image_url=excluded.image_url`,id,category,name,str(b.subtitle,150),str(b.description,4000),str(b.instructions,4000),price,integer(b.compare_price||0,0,10000000),min,max,b.featured?1:0,b.active?1:0,str(b.region,30),str(b.tag,30),now(),iconKey,imageUrl),stmt(db,'INSERT OR IGNORE INTO physical_stock(product_id) VALUES(?)',id),audit(db,p.id,'product.save',id,name)]);return json({ok:true,id});
            }
            if(section==='categories'&&method==='GET')return json(await all(db,categoryQuery));
            if(section==='categories'&&method==='POST'){const b=await body(request),id=str(b.id,64)||uid(),name=str(b.name,50);if(!name)fail(400,'请输入分类名称');await db.batch([stmt(db,'INSERT INTO categories VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,icon=excluded.icon,sort=excluded.sort,active=excluded.active',id,name,str(b.icon,20)||'box',integer(b.sort||0,0,1000),b.active?1:0),audit(db,p.id,'category.save',id,name)]);return json({ok:true});}
            if(section==='inventory'&&method==='GET')return json({products:await all(db,productQuery+" WHERE p.product_type='physical'")});
            if(section==='inventory'&&method==='POST'){
                const b=await body(request),id=str(b.product_id,64),delta=integer(b.delta,-100000,100000),reason=str(b.reason,300);if(!delta||reason.length<2)fail(400,'请填写调整数量及原因');if(!await first(db,"SELECT product_id FROM physical_stock WHERE product_id=?",id))fail(404,'实体商品不存在');
                try{await db.batch([stmt(db,'UPDATE physical_stock SET available=available+? WHERE product_id=?',delta,id),audit(db,p.id,'stock.adjust',id,`${delta>0?'+':''}${delta} / ${reason}`)]);}catch{fail(409,'可售库存不足，不能减少已锁定或已售数量');}return json({ok:true});
            }
            if(section==='gifts'&&method==='GET')return json({stats:await first(db,"SELECT coalesce(sum(status='available'),0) AS available,coalesce(sum(status='assigned'),0) AS assigned FROM telegram_gifts WHERE is_example=?",env.DEMO_MODE==='true'?1:0),recent:await all(db,'SELECT id,status,order_id,is_example,created_at,assigned_at FROM telegram_gifts ORDER BY created_at DESC LIMIT 100'),demo:env.DEMO_MODE==='true'});
            if(section==='gifts'&&method==='POST'){
                const b=await body(request),codes=String(b.codes||'').split('\n').map(x=>x.trim()).filter(Boolean);if(!codes.length||codes.length>30||codes.some(x=>x.length>2000||!x.split('|')[0].trim()))fail(400,'每次导入 1–30 个账号，每行一个，单条不超过 2000 字');if(!env.INVENTORY_KEY)fail(503,'赠送账号加密密钥未配置');const st=[];
                for(const code of new Set(codes)){const identity=code.split('|')[0].trim().toLowerCase();st.push(stmt(db,"INSERT OR IGNORE INTO telegram_gifts(id,ciphertext,fingerprint,status,is_example,created_at) VALUES(?,?,?,'available',?,?)",uid(),await encrypt(code,env.INVENTORY_KEY!,GIFT_CONTEXT),await sha('telegram-account:'+identity),env.DEMO_MODE==='true'?1:0,now()));}
                const results=await db.batch([...st,audit(db,p.id,'gift.import','telegram',`提交 ${codes.length} 个`)]),imported=results.slice(0,-1).reduce((n,r)=>n+r.meta.changes,0);return json({ok:true,imported,skipped:codes.length-imported});
            }
            if(section==='orders'&&method==='GET'){
                const page=Math.max(1,Math.min(10000,Math.trunc(Number(url.searchParams.get('page')))||1)),q=str(url.searchParams.get('q'),100),status=str(url.searchParams.get('status'),20);const where=" WHERE order_type='physical' AND id LIKE ? AND (?='' OR status=?)";return json({orders:await all(db,'SELECT id,contact,recipient,shipping_address,total,subtotal,shipping_fee,status,shipping_status,tracking_number,created_at,expires_at,demo FROM orders'+where+' ORDER BY created_at DESC LIMIT 50 OFFSET ?',`%${q}%`,status,status,(page-1)*50),total:(await first<any>(db,'SELECT count(*) AS n FROM orders'+where,`%${q}%`,status,status)).n,page});
            }
            if(section==='order'&&method==='GET'){
                const id=str(url.searchParams.get('id'),64),o=await first<any>(db,'SELECT id,contact,recipient,shipping_address,total,subtotal,shipping_fee,order_type,status,demo,shipping_status,tracking_number,shipped_at,payment_method,created_at,expires_at,paid_at,fulfilled_at,payment_provider,payment_ref FROM orders WHERE id=? AND ready=1',id);if(!o)fail(404,'订单不存在');return json({...o,items:await all(db,'SELECT product_id,product_name,price,quantity FROM order_items WHERE order_id=?',id),tickets:await all(db,'SELECT * FROM tickets WHERE order_id=? ORDER BY created_at DESC',id),giftAssigned:!!await first(db,'SELECT id FROM telegram_gifts WHERE order_id=?',id)});
            }
            if(section==='orders'&&method==='POST'){
                if(p.role!=='owner')fail(403,'仅店主可以确认收款或登记退款');const b=await body(request),id=str(b.id,64),reason=str(b.reason,300),reference=str(b.reference,100);if(reason.length<5||!reference)fail(400,'请填写处理依据和流水号');
                if(b.action==='refund'){if(!await first(db,"SELECT id FROM orders WHERE id=? AND order_type='physical' AND status IN('paid','fulfilled')",id))fail(409,'仅已付款订单可登记退款');await db.batch([stmt(db,"UPDATE orders SET status='refunded' WHERE id=? AND status IN('paid','fulfilled')",id),audit(db,p.id,'order.refund',id,reason+' / '+reference)]);return json({ok:true});}
                return json(await settleOrder(db,id,p.id,reason,env.DEMO_MODE==='true'?'demo-manual':'manual',reference));
            }
            if(section==='address'&&method==='POST'){
                const b=await body(request),id=str(b.id,64),recipient=str(b.recipient,60),contact=str(b.contact,100),address=str(b.shipping_address,500);
                try{await db.batch([
                    ...guard(db,"EXISTS(SELECT 1 FROM orders WHERE id=? AND order_type='physical' AND status IN('pending','paid') AND shipping_status='pending')",id),
                    stmt(db,'UPDATE orders SET recipient=?,contact=?,shipping_address=? WHERE id=?',recipient,contact,address,id),
                    audit(db,p.id,'order.address',id,'补充或修正收货资料')
                ]);}catch{fail(409,'仅待付款或已付款待发货的实体订单可以修改收货信息');}
                return json({ok:true});
            }
            if(section==='shipment'&&method==='POST'){
                const b=await body(request),id=str(b.id,64),tracking=str(b.tracking_number,100);if(!/^[A-Za-z0-9][A-Za-z0-9 _-]{3,99}$/.test(tracking))fail(400,'请填写有效物流单号（4–100 位）');const o=await first<any>(db,"SELECT * FROM orders WHERE id=? AND order_type='physical'",id);if(!o)fail(404,'订单不存在');if(o.shipping_status==='shipped'){if(o.tracking_number===tracking)return json({ok:true,idempotent:true});fail(409,'订单已发货，不能重复填写不同单号');}if(o.status!=='paid')fail(409,'请先确认收款，再进行发货');
                try{await db.batch([stmt(db,"UPDATE orders SET status='fulfilled',shipping_status='shipped',tracking_number=?,shipped_at=?,fulfilled_at=? WHERE id=? AND status='paid' AND shipping_status='pending'",tracking,now(),now(),id),...guard(db,"EXISTS(SELECT 1 FROM orders WHERE id=? AND status='fulfilled' AND shipping_status='shipped' AND tracking_number=?)",id,tracking),audit(db,p.id,'order.ship',id,tracking)]);}catch{fail(409,'订单状态已变化，请刷新核对');}return json({ok:true});
            }
            if(section==='tickets'&&method==='GET')return json(await all(db,'SELECT * FROM tickets ORDER BY created_at DESC LIMIT 200'));
            if(section==='tickets'&&method==='POST'){const b=await body(request),id=str(b.id,64),reply=str(b.reply,2000);if(!reply)fail(400,'请输入回复内容');if(!await first(db,'SELECT id FROM tickets WHERE id=?',id))fail(404,'工单不存在');await db.batch([stmt(db,'UPDATE tickets SET reply=?,status=?,updated_at=? WHERE id=?',reply,b.closed?'closed':'open',now(),id),audit(db,p.id,'ticket.reply',id)]);return json({ok:true});}
            if(section==='settings'&&method==='GET')return json(await settings(db));
            if(section==='settings'&&method==='POST'){const b=await body(request),keys=['brand','tagline','announcement','support','telegramSupport','businessHours','footer','terms','privacy'];const username=str(b.telegramSupport,40).replace(/^@/,'');if(b.telegramSupport&& !/^[A-Za-z0-9_]{5,32}$/.test(username))fail(400,'Telegram 客服用户名需为 5–32 位字母、数字或下划线');const st=keys.filter(k=>typeof b[k]==='string').map(k=>stmt(db,'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',k,k==='telegramSupport'?username:str(b[k],4000)));await db.batch([...st,audit(db,p.id,'settings.save','site')]);return json({ok:true});}
            if (section === 'staff' && method === 'GET')
                return json(await all(db, 'SELECT id,username,role,active,created_at FROM staff'));
            if (section === 'staff' && method === 'POST') {
                const b = await body(request), id = str(b.id, 64);
                if (id) {
                    const existing = await first<Staff>(db, 'SELECT * FROM staff WHERE id=?', id);
                    if (!existing)
                        fail(404, '员工不存在');
                    if (existing!.role === 'owner')
                        fail(403, '店主账号不能在此停用');
                    await db.batch([stmt(db, 'UPDATE staff SET active=? WHERE id=?', b.active ? 1 : 0, id), stmt(db, 'DELETE FROM sessions WHERE staff_id=?', id), audit(db, p.id, 'staff.status', id)]);
                    return json({ ok: true });
                }
                if (!/^[a-zA-Z0-9_-]{3,32}$/.test(b.username || '') || typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 128 || !['operator', 'support'].includes(b.role))
                    fail(400, '账号或密码无效，员工角色必须为运营或客服');
                try {
                    const staffId = uid();
                    await db.batch([stmt(db, 'INSERT INTO staff VALUES(?,?,?,?,1,?)', staffId, b.username, await hashPassword(b.password), b.role, now()), audit(db, p.id, 'staff.create', staffId, b.role)]);
                }
                catch {
                    fail(409, '账号已存在');
                }
                return json({ ok: true });
            }
            if (section === 'password' && method === 'POST') {
                const b = await body(request), s = await first<{
                    password_hash: string;
                }>(db, 'SELECT password_hash FROM staff WHERE id=?', p.id);
                if (typeof b.old !== 'string' || !await verifyPassword(b.old, s!.password_hash))
                    fail(400, '原密码不正确');
                if (typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 128)
                    fail(400, '新密码需为 12–128 位');
                await db.batch([stmt(db, 'UPDATE staff SET password_hash=? WHERE id=?', await hashPassword(b.password), p.id), stmt(db, 'DELETE FROM sessions WHERE staff_id=?', p.id), audit(db, p.id, 'password.change', p.id)]);
                return json({ ok: true });
            }
            if (section === 'audits' && method === 'GET')
                return json(await all(db, 'SELECT a.*, coalesce(s.username,a.actor) AS actor_name FROM audits a LEFT JOIN staff s ON a.actor=s.id ORDER BY a.created_at DESC LIMIT 200'));
            if(section==='seed'&&method==='POST')return json(await seed(db,env,p.id));
        }
        fail(404,'接口不存在');
    }catch(error){if(error instanceof ApiError)return json({error:error.message},error.status);console.error('commerce request failed',error instanceof Error?error.message:'unknown');return json({error:'服务暂时不可用，请稍后重试'},500);}
}
// No payment network requests until a real adapter is explicitly implemented.
export async function runPaymentReconciliation(env:RuntimeEnv){if(env.DB)await expire(env.DB);}
