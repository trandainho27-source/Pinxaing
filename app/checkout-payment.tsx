'use client';
import {useState} from 'react';
import {Wallet,Check} from 'lucide-react';
import {api,money} from '@/lib/commerce/client';
import type {Order,Customer} from '@/lib/commerce/types';
const methods=[['wechat','微信支付'],['alipay','支付宝'],['usdt','USDT']];
export default function CheckoutPayment({order,secret,csrf,customer,refreshAccount,onUpdate}:{order:Order;secret:string;csrf?:string;customer?:Customer|null;refreshAccount?:()=>Promise<void>;onUpdate:(order:Order)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const owns=!!customer&&order.customer_id===customer.id;
 return <section className="reserved-checkout"><h4><Wallet size={19}/>付款方式</h4>
 {owns&&<div className="balance-payment"><div><strong>账户余额 {money(customer.wallet_balance||0)}</strong><p>本次扣款 {money(order.total)}，包含订单中适用的邮费。</p></div><button className="primary" disabled={busy||order.status!=='pending'} onClick={async()=>{
  setBusy(true);setError('');let paid=false;
  try{await api('customer/wallet/pay',{id:order.id},customer.csrf);paid=true;onUpdate(await api<Order>('orders/lookup',{id:order.id,secret},customer.csrf));await refreshAccount?.();}
  catch(e){setError(paid?'付款已完成，请刷新订单查看最新状态。':(e as Error).message);}finally{setBusy(false);}
 }}>{busy?'正在处理…':`确认余额支付 ${money(order.total)}`}</button><a className="text-button" href="/account">查看余额 / 充值</a></div>}
 {!owns&&<p className="hint">余额支付仅限已登录账号名下的订单。游客订单可先在账号中心凭订单号与查询密钥绑定。</p>}
 <div className="reserved-methods">{methods.map(([id,label])=><div className={id===order.payment_method?'selected':''} key={id}><span>{label}{id===order.payment_method&&<Check size={13}/>}</span><small>在线接口待接入</small></div>)}</div><p className="hint">微信、支付宝、USDT 在线付款尚未开通，请先与商家确认其他收款安排。</p>
 {!!order.demo&&order.status==='pending'&&<button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{onUpdate(await api<Order>('orders/demo-pay',{id:order.id,secret},csrf));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{busy?'正在处理…':'模拟确认付款（不扣款）'}</button>}
 {error&&<p className="error-text" role="alert">{error}</p>}</section>;
}
