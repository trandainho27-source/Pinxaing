import type {Staff} from './types.ts';
import {all,first,stmt,now,fail,json,str,body,audit} from './api-common.ts';
import {transactionGuard} from './customer-api.ts';
import {uid} from './security.ts';
import {shipmentDisplay} from './order-display.ts';
const fields='id,customer_id,shipment_group_id,archived_at,admin_note,revision,contact,recipient,shipping_address,total,subtotal,shipping_fee,order_type,status,demo,shipping_status,tracking_number,shipped_at,payment_method,created_at,expires_at,paid_at,fulfilled_at,payment_provider,payment_ref';
export async function listOrders(db:D1Database,url:URL) {
    const page=Math.max(1,Math.min(10000,Math.trunc(Number(url.searchParams.get('page')))||1)),q=str(url.searchParams.get('q'),100),status=str(url.searchParams.get('status'),20),shipping=str(url.searchParams.get('shipping'),20),archived=url.searchParams.get('archived')==='1';
    const where=` WHERE order_type='physical' AND ${archived?'archived_at IS NOT NULL':'archived_at IS NULL'} AND (id LIKE ? OR contact LIKE ? OR recipient LIKE ? OR tracking_number LIKE ? OR shipment_group_id LIKE ?) AND (?='' OR status=?) AND (?='' OR CASE WHEN trim(coalesce(tracking_number,'')) IN('','无') THEN 'pending' ELSE 'shipped' END=?)`;
    const args=[...Array(5).fill(`%${q}%`),status,status,shipping,shipping];
    return json({orders:await all(db,'SELECT '+fields+' FROM orders'+where+' ORDER BY created_at DESC LIMIT 50 OFFSET ?',...args,(page-1)*50),total:(await first<any>(db,'SELECT count(*) AS n FROM orders'+where,...args)).n,page});
}
export async function orderDetail(db:D1Database,id:string) {
    const o=await first<any>(db,'SELECT '+fields+' FROM orders WHERE id=? AND ready=1',id);if(!o)fail(404,'订单不存在');
    const shipping=shipmentDisplay(o.tracking_number);
    return json({...o,shipping_status:shipping.shipped?'shipped':'pending',tracking_number:shipping.trackingNumber,
        customer:o.customer_id?await first(db,'SELECT email,display_name,is_demo FROM customers WHERE id=?',o.customer_id):null,
        group_orders:o.shipment_group_id?await all(db,'SELECT id,total,status,tracking_number,revision FROM orders WHERE shipment_group_id=? ORDER BY created_at',o.shipment_group_id):[],
        items:await all(db,'SELECT product_id,product_name,price,quantity FROM order_items WHERE order_id=?',id),
        tickets:await all(db,'SELECT * FROM tickets WHERE order_id=? ORDER BY created_at DESC',id),
        history:await all(db,"SELECT a.id,a.action,a.detail,a.created_at,coalesce(s.username,CASE WHEN a.actor='system' THEN '系统' ELSE '客户 / 系统' END) AS actor_name FROM audits a LEFT JOIN staff s ON s.id=a.actor WHERE a.target=? ORDER BY a.created_at DESC LIMIT 100",id),
        giftAssigned:!!await first(db,'SELECT id FROM telegram_gifts WHERE order_id=?',id)});
}
function snapshot(db:D1Database,orders:any[]) {return orders.flatMap(o=>transactionGuard(db,'EXISTS(SELECT 1 FROM orders WHERE id=? AND revision=?)',o.id,o.revision));}
function requireReason(value:unknown){const reason=str(value,300);if(reason.length<5)fail(400,'请填写至少 5 个字的操作原因');return reason;}
async function commit(db:D1Database,statements:D1PreparedStatement[]){try{await db.batch(statements);}catch{fail(409,'订单已被其他操作修改，请刷新后重试');}}
async function single(db:D1Database,id:string){const o=await first<any>(db,"SELECT * FROM orders WHERE id=? AND ready=1 AND order_type='physical'",id);if(!o)fail(404,'实体订单不存在');return o;}
export async function manageOrders(db:D1Database,request:Request,p:Staff,section:string){
    const b=await body(request),action=section==='shipment'?'ship':str(b.action,30),id=str(b.id,64);
    if(!['owner','operator'].includes(p.role)&&action!=='note')fail(403,'当前账号没有订单管理权限');
    if(['archive','restore'].includes(action)&&p.role!=='owner')fail(403,'仅店主可以删除或恢复订单');
    if(action==='merge'){
        const reason=requireReason(b.reason),ids=Array.isArray(b.ids)?[...new Set(b.ids.map((x:unknown)=>str(x,64)))]:[];
        if(ids.length<2||ids.length>20)fail(400,'请选择 2–20 笔订单合并发货');
        const orders=[];for(const orderId of ids)orders.push(await single(db,orderId));
        const base=orders[0];
        if(orders.some(o=>o.status!=='paid'||!o.paid_at||o.archived_at||o.shipment_group_id||shipmentDisplay(o.tracking_number).shipped))fail(409,'仅未合并、未删除的已付款待发货订单可以合并');
        if(!base.recipient.trim()||!base.contact.trim()||!base.shipping_address.trim()||orders.some(o=>o.recipient!==base.recipient||o.contact!==base.contact||o.shipping_address!==base.shipping_address||o.customer_id!==base.customer_id||o.demo!==base.demo))fail(409,'请先确认所有订单的账号归属、收货人、联系方式和地址一致且完整');
        const group='MG'+uid().replaceAll('-','').slice(0,16).toUpperCase();
        await commit(db,[...snapshot(db,orders),stmt(db,'INSERT INTO shipment_groups VALUES(?,?,?)',group,now(),p.id),...orders.flatMap(o=>[
            stmt(db,'UPDATE orders SET shipment_group_id=?,revision=revision+1 WHERE id=?',group,o.id),audit(db,p.id,'order.merge',o.id,`${group} / ${reason} / 保留每单原费用与赠送账号`)
        ])]);return json({ok:true,group_id:group,count:orders.length});
    }
    const o=await single(db,id);
    if(b.revision!==undefined&&b.revision!==o.revision)fail(409,'订单已更新，请刷新详情后重试');
    if(o.archived_at&&action!=='restore')fail(409,'请先从回收站恢复订单');
    if(action==='unmerge'){
        const reason=requireReason(b.reason);if(!o.shipment_group_id)fail(409,'订单尚未合并');
        const members=await all(db,'SELECT * FROM orders WHERE shipment_group_id=?',o.shipment_group_id);
        if(members.some(x=>x.archived_at||x.status!=='paid'||shipmentDisplay(x.tracking_number).shipped))fail(409,'合并组已经发货或关闭，请先处理配送状态');
        await commit(db,[...snapshot(db,members),...members.flatMap(x=>[stmt(db,'UPDATE orders SET shipment_group_id=NULL,revision=revision+1 WHERE id=?',x.id),audit(db,p.id,'order.unmerge',x.id,`${o.shipment_group_id} / ${reason}`)])]);return json({ok:true});
    }
    if(['ship','amend-shipment','clear-shipment'].includes(action)){
        const tracking=action==='clear-shipment'?'':str(b.tracking_number,100),reason=action==='ship'?(str(b.reason,300)||'填写单号确认发货'):requireReason(b.reason);
        if(action!=='clear-shipment'&&!/^[A-Za-z0-9][A-Za-z0-9 _-]{3,99}$/.test(tracking))fail(400,'请填写有效物流单号（4–100 位）');
        const members=o.shipment_group_id?await all(db,'SELECT * FROM orders WHERE shipment_group_id=?',o.shipment_group_id):[o];
        if(members.some(x=>!['paid','fulfilled'].includes(x.status)||!x.paid_at||x.archived_at))fail(409,'请先确认收款；已退款或删除的订单不能修改发货信息');
        if(action==='ship'&&members.every(x=>shipmentDisplay(x.tracking_number).trackingNumber===tracking))return json({ok:true,idempotent:true});
        if(action==='ship'&&members.some(x=>shipmentDisplay(x.tracking_number).shipped))fail(409,'已发货订单请使用修正物流单号操作');
        if(action!=='ship'&&members.some(x=>!shipmentDisplay(x.tracking_number).shipped))fail(409,'尚未发货，请使用确认发货操作');
        const ts=now();
        await commit(db,[...snapshot(db,members),...members.flatMap(x=>[
            stmt(db,'UPDATE orders SET status=?,shipping_status=?,tracking_number=?,shipped_at=?,fulfilled_at=?,revision=revision+1 WHERE id=?',tracking?'fulfilled':'paid',tracking?'shipped':'pending',tracking,tracking?(x.shipped_at||ts):null,tracking?(x.fulfilled_at||ts):null,x.id),
            audit(db,p.id,action==='ship'?'order.ship':action==='clear-shipment'?'order.shipment.clear':'order.shipment.amend',x.id,`${x.tracking_number||'无'} → ${tracking||'无'} / ${reason}`)
        ])]);return json({ok:true,count:members.length});
    }
    const reason=action==='note'?str(b.note,2000):requireReason(b.reason),statements=snapshot(db,[o]);
    if(action==='cancel'){
        if(o.status!=='pending')fail(409,'仅待付款订单可以关闭，已付款订单请登记退款');
        statements.push(stmt(db,"UPDATE orders SET status='cancelled',revision=revision+1 WHERE id=?",id),
            stmt(db,`UPDATE physical_stock SET available=available+(SELECT quantity FROM physical_reservations WHERE order_id=? AND product_id=physical_stock.product_id AND status='reserved'),reserved=reserved-(SELECT quantity FROM physical_reservations WHERE order_id=? AND product_id=physical_stock.product_id AND status='reserved') WHERE product_id IN(SELECT product_id FROM physical_reservations WHERE order_id=? AND status='reserved')`,id,id,id),
            stmt(db,"UPDATE physical_reservations SET status='released' WHERE order_id=? AND status='reserved'",id));
    }else if(action==='archive'){
        if(!['expired','cancelled','refunded','fulfilled'].includes(o.status))fail(409,'请先完成发货或关闭订单，再移入回收站');
        statements.push(stmt(db,'UPDATE orders SET archived_at=?,revision=revision+1 WHERE id=?',now(),id));
    }else if(action==='restore'){
        if(!o.archived_at)fail(409,'订单不在回收站');statements.push(stmt(db,'UPDATE orders SET archived_at=NULL,revision=revision+1 WHERE id=?',id));
    }else if(action==='note'){
        statements.push(stmt(db,'UPDATE orders SET admin_note=?,revision=revision+1 WHERE id=?',reason,id));
    }else fail(400,'不支持该订单操作');
    statements.push(audit(db,p.id,'order.'+action,id,action==='note'?'更新内部备注':reason));await commit(db,statements);return json({ok:true});
}
