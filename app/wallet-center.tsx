'use client';
import {useEffect,useRef,useState} from 'react';
import {Wallet,Plus,RefreshCw,ArrowUpRight,ShieldCheck} from 'lucide-react';
import {api,money,date} from '@/lib/commerce/client';
import type {Customer} from '@/lib/commerce/types';
const methods:Record<string,string>={wechat:'微信支付',alipay:'支付宝',usdt:'USDT'};
const states:Record<string,string>={pending:'待支付',approved:'已到账',rejected:'已关闭',cancelled:'已取消',expired:'已过期'};
export default function WalletCenter({customer,refreshAccount,openOrder}:{customer:Customer;refreshAccount:()=>Promise<void>;openOrder:(id:string)=>void}){
 const [data,setData]=useState<any>(null),[page,setPage]=useState(1),[form,setForm]=useState(false),[amount,setAmount]=useState('100'),[method,setMethod]=useState('wechat'),[invoice,setInvoice]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const request=useRef({payload:'',key:''});
 async function load(){setData(await api('customer/wallet?page='+page));}
 useEffect(()=>{load().catch(e=>setError(e.message));},[customer.id,page]);
 async function run(fn:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function demoPay(id:string){await api('customer/wallet/recharge/demo-pay',{id},customer.csrf);setInvoice(null);request.current={payload:'',key:''};setNotice('演示充值已到账，可用余额支付演示订单。');await load();await refreshAccount();}
 return <div className="wallet-center">
  <section className="panel wallet-balance"><div><span><Wallet size={19}/>账户余额</span><strong>{money(data?.balance??customer.wallet_balance??0)}</strong><small>人民币余额 · 可直接支付本人订单</small></div><div className="button-row"><button className="secondary" disabled={busy} onClick={()=>run(async()=>{await load();await refreshAccount();})}><RefreshCw size={15}/>刷新</button><button className="primary" onClick={()=>setForm(!form)}><Plus size={16}/>{form?'收起':'充值余额'}</button></div></section>
  {customer.is_demo===1&&<p className="info-box">演示账户仅用于体验，充值和余额均不代表真实资金。</p>}
  {error&&<p className="error-text" role="alert">{error}</p>}{notice&&<p className="info-box" role="status">{notice}</p>}
  {form&&<form className="panel wallet-topup-form" onSubmit={e=>{e.preventDefault();run(async()=>{
   if(!/^\d+(\.\d{1,2})?$/.test(amount))throw Error('请输入最多两位小数的充值金额');
   const values={amount:Math.round(Number(amount)*100),method},serialized=JSON.stringify(values);
   if(request.current.payload!==serialized)request.current={payload:serialized,key:Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('')};
   setInvoice(await api('customer/wallet/recharge',{...values,request_key:request.current.key},customer.csrf));await load();
  });}}><h3>充值余额</h3><p className="hint">选择金额并完成支付，系统确认到账后自动增加余额。</p><div className="recharge-presets">{[50,100,200,500].map(value=><button type="button" key={value} className={amount===String(value)?'active':''} onClick={()=>setAmount(String(value))}>¥{value}</button>)}</div><div className="form-grid"><label>充值金额（元）<input type="number" min="1" max="10000" step="0.01" required value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>付款方式<select value={method} onChange={e=>setMethod(e.target.value)}>{Object.entries(methods).map(([value,name])=><option key={value} value={value}>{name}{data?.mode==='demo'?' · 演示':' · 暂未开通'}</option>)}</select></label></div>
  {data?.mode==='demo'?<p className="hint">此处生成演示充值单，下一步模拟付款，全程不扣真实款项。</p>:<p className="info-box" role="status">充值支付暂未开通。接入支付服务后即可直接付款充值，到账自动加入余额。</p>}
  <button className="primary" disabled={busy||!data?.recharge_enabled}>{busy?'正在处理…':data?.mode==='demo'?'进入演示支付':'充值支付暂未开通'}</button></form>}
  {invoice&&invoice.demo&&<section className="panel recharge-invoice"><h3>演示充值付款</h3><p className="mono">{invoice.id}</p><strong>{money(invoice.amount)}</strong><p>仅模拟到账，不发生真实付款。</p><button className="primary" disabled={busy} onClick={()=>run(()=>demoPay(invoice.id))}>模拟付款并充值（不扣款）</button></section>}
  <section className="panel"><h3><ShieldCheck size={18}/>到账后即可消费</h3><p>余额可用于支付商品及适用邮费。打开本人订单，点击「确认余额支付」即可扣款下单。</p><p className="hint">充值到账、消费扣款和余额退款都会记录在下方明细中。</p></section>
  <section className="panel"><div className="panel-title"><h3>充值记录</h3><small>最近 50 笔</small></div>{!data?<p>正在加载…</p>:data.topups.length?<div className="table-scroll"><table><thead><tr><th>充值单</th><th>金额</th><th>方式</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.topups.map((t:any)=><tr key={t.id}><td><span className="mono">{t.id}</span><small>{date(t.created_at)}</small>{t.flow==='manual'&&<small>旧版记录</small>}</td><td>{money(t.amount)}</td><td>{methods[t.method]}</td><td>{t.flow==='manual'&&t.status==='pending'?'历史待处理':states[t.status]}</td><td>{t.flow==='demo'&&t.status==='pending'&&<button className="text-button" disabled={busy} onClick={()=>run(()=>demoPay(t.id))}>继续演示付款</button>}{t.flow==='manual'&&t.status==='pending'&&<button className="text-button" disabled={busy} onClick={()=>run(async()=>{await api('customer/wallet/cancel',{id:t.id},customer.csrf);await load();})}>取消旧记录</button>}</td></tr>)}</tbody></table></div>:<p className="small-empty">还没有充值记录。</p>}</section>
  <section className="panel"><div className="panel-title"><h3>余额明细</h3><small>每一笔收支都有记录</small></div>{data?.ledger.length?<><div className="table-scroll"><table><thead><tr><th>事项</th><th>变动</th><th>变动后余额</th><th>时间</th></tr></thead><tbody>{data.ledger.map((l:any)=><tr key={l.id}><td>{l.description}{l.order_id&&<button className="text-button" onClick={()=>openOrder(l.order_id)}>查看订单 <ArrowUpRight size={12}/></button>}</td><td className={l.delta>0?'success-text':''}>{l.delta>0?'+':''}{money(l.delta)}</td><td>{money(l.balance_after)}</td><td>{date(l.created_at)}</td></tr>)}</tbody></table></div>{data.ledger_total>20&&<div className="pagination"><button className="secondary" disabled={page===1} onClick={()=>setPage(page-1)}>上一页</button><span>第 {page} 页</span><button className="secondary" disabled={page*20>=data.ledger_total} onClick={()=>setPage(page+1)}>下一页</button></div>}</>:<p className="small-empty">充值到账、余额付款和退款会显示在这里。</p>}</section>
 </div>;
}
