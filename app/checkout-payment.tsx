'use client';
import {useState} from 'react';
import {Wallet,Check} from 'lucide-react';
import {api} from '@/lib/commerce/client';
import type {Order} from '@/lib/commerce/types';
const methods=[['wechat','微信支付'],['alipay','支付宝'],['usdt','USDT']];
export default function CheckoutPayment({order,secret,onUpdate}: {order:Order;secret:string;enabled?:boolean;onUpdate:(order:Order)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <section className="reserved-checkout"><h4><Wallet size={19}/>付款方式</h4><div className="reserved-methods">{methods.map(([id,label])=><div className={id===order.payment_method?'selected':''} key={id}><span>{label}{id===order.payment_method&&<Check size={13}/>}</span><small>接口待接入</small></div>)}</div><p className="hint">支付接口已统一预留，暂不支持在线付款，请勿转账。</p>{!!order.demo&&order.status==='pending'&&<button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{onUpdate(await api<Order>('orders/demo-pay',{id:order.id,secret}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{busy?'正在处理…':'模拟确认付款（不扣款）'}</button>}{error&&<p className="error-text" role="alert">{error}</p>}</section>;
}
