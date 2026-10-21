import {first,stmt,now,fail,audit} from './api-common.ts';
import {transactionGuard} from './api-common.ts';
import {uid} from './security.ts';
import {queueOrderEmail} from './order-notifications.ts';

export async function settleOrder(db:D1Database,id:string,actor:string,reason:string,provider:string,reference:string,amount?:number,walletCustomer?:string){
    const order=await first<any>(db,"SELECT * FROM orders WHERE id=? AND order_type='physical' AND ready=1",id);if(!order)fail(404,'实体订单不存在');
    if(walletCustomer&&order.customer_id!==walletCustomer)fail(404,'订单不存在或不属于当前账号');
    if(amount!==undefined&&amount!==order.total)fail(400,'付款金额必须等于订单总额（含适用邮费）');
    if(['paid','fulfilled'].includes(order.status)){if(order.payment_ref!==reference||order.payment_provider!==provider)fail(409,'订单已有其他付款记录');return {ok:true,idempotent:true};}
    if(order.status!=='pending'||order.expires_at<=now()||order.archived_at)fail(409,'订单已关闭或过期');
    const ts=now(),st:D1PreparedStatement[]=[...transactionGuard(db,"EXISTS(SELECT 1 FROM orders WHERE id=? AND status='pending' AND expires_at>? AND archived_at IS NULL)",id,ts)];
    if(['manual','demo-manual'].includes(provider))st.push(...transactionGuard(db,"NOT EXISTS(SELECT 1 FROM wallet_topups WHERE status='approved' AND reference=lower(?)) AND NOT EXISTS(SELECT 1 FROM orders WHERE id!=? AND payment_provider IN('manual','demo-manual') AND lower(payment_ref)=lower(?))",reference,id,reference));
    if(walletCustomer){
        const w=await first<any>(db,'SELECT balance FROM wallet_accounts WHERE customer_id=?',walletCustomer);
        if(!w||w.balance<order.total)fail(409,'账户余额不足，请先充值或选择其他付款方式');
        st.push(...transactionGuard(db,'EXISTS(SELECT 1 FROM wallet_accounts w JOIN customers c ON c.id=w.customer_id WHERE w.customer_id=? AND c.active=1 AND w.balance>=?)',walletCustomer,order.total),
            stmt(db,'UPDATE wallet_accounts SET balance=balance-?,updated_at=? WHERE customer_id=?',order.total,ts,walletCustomer),
            stmt(db,`INSERT INTO wallet_ledger(id,event_key,customer_id,kind,delta,balance_after,order_id,description,created_at) SELECT ?,?,customer_id,'purchase',?,balance,?,?,? FROM wallet_accounts WHERE customer_id=?`,uid(),'purchase:'+id,-order.total,id,'订单余额支付',ts,walletCustomer));
    }
    st.push(stmt(db,"UPDATE orders SET status='paid',revision=revision+1,paid_at=?,payment_provider=?,payment_ref=? WHERE id=?",ts,provider,reference,id),
        stmt(db,`UPDATE physical_stock SET reserved=reserved-(SELECT quantity FROM physical_reservations WHERE product_id=physical_stock.product_id AND order_id=? AND status='reserved'),sold=sold+(SELECT quantity FROM physical_reservations WHERE product_id=physical_stock.product_id AND order_id=? AND status='reserved') WHERE product_id IN(SELECT product_id FROM physical_reservations WHERE order_id=? AND status='reserved')`,id,id,id),
        stmt(db,"UPDATE physical_reservations SET status='committed' WHERE order_id=? AND status='reserved'",id),
        ...transactionGuard(db,`EXISTS(SELECT 1 FROM orders o WHERE o.id=? AND o.status='paid' AND NOT EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=o.id AND NOT EXISTS(SELECT 1 FROM physical_reservations r WHERE r.order_id=o.id AND r.product_id=i.product_id AND r.quantity=i.quantity AND r.status='committed')))`,id),
        queueOrderEmail(db,id,'paid'),audit(db,actor,'order.paid',id,reason));
    try{await db.batch(st);}catch{fail(409,'订单、余额或库存状态冲突，请刷新核对；未重复扣款');}
    return {ok:true};
}
export async function refundWalletOrder(db:D1Database,id:string,actor:string,reason:string){
    const o=await first<any>(db,"SELECT * FROM orders WHERE id=? AND payment_provider='balance'",id);if(!o)fail(404,'余额支付订单不存在');
    if(o.status==='refunded'&&await first(db,'SELECT id FROM wallet_ledger WHERE event_key=?','refund:'+id))return {ok:true,idempotent:true};
    if(!o.customer_id)fail(409,'订单没有有效的余额账号');
    try{await db.batch([
        ...transactionGuard(db,"EXISTS(SELECT 1 FROM orders WHERE id=? AND status IN('paid','fulfilled') AND archived_at IS NULL AND shipment_group_id IS NULL)",id),
        ...transactionGuard(db,"EXISTS(SELECT 1 FROM wallet_ledger WHERE event_key=? AND customer_id=? AND delta=?)",'purchase:'+id,o.customer_id,-o.total),
        stmt(db,'UPDATE wallet_accounts SET balance=balance+?,updated_at=? WHERE customer_id=?',o.total,now(),o.customer_id),
        stmt(db,`INSERT INTO wallet_ledger(id,event_key,customer_id,kind,delta,balance_after,order_id,description,created_at) SELECT ?,?,customer_id,'refund',?,balance,?,?,? FROM wallet_accounts WHERE customer_id=?`,uid(),'refund:'+id,o.total,id,'订单退款退回余额',now(),o.customer_id),
        stmt(db,"UPDATE orders SET status='refunded',revision=revision+1 WHERE id=?",id),audit(db,actor,'order.refund.balance',id,reason)
    ]);}catch{fail(409,'订单状态或账户余额已变化，无法重复退款；合并订单需先解除合并');}
    return {ok:true};
}
