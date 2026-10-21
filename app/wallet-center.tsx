'use client';
import {useEffect,useRef,useState} from 'react';
import {Wallet,Plus,RefreshCw,ArrowUpRight} from 'lucide-react';
import {api,money,date} from '@/lib/commerce/client';
import type {Customer} from '@/lib/commerce/types';
const methods:Record<string,string>={wechat:'微信',alipay:'支付宝',usdt:'USDT'};
const states:Record<string,string>={pending:'待核实到账',approved:'已入账',rejected:'未通过',cancelled:'已取消'};
export default function WalletCenter({customer,refreshAccount,openOrder}:{customer:Customer;refreshAccount:()=>Promise<void>;openOrder:(id:string)=>void}){
 const [data,setData]=useState<any>(null),[page,setPage]=useState(1),[form,setForm]=useState(false),[amount,setAmount]=useState('100'),[method,setMethod]=useState('wechat'),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const request=useRef({payload:'',key:''});
 async function load(){setData(await api('customer/wallet?page='+page));}
 useEffect(()=>{load().catch(e=>setError(e.message));},[customer.id,page]);
 async function run(fn:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="wallet-center">
  <section className="panel wallet-balance"><div><span><Wallet size={19}/>账户余额</span><strong>{money(data?.balance??customer.wallet_balance??0)}</strong><small>人民币余额 · 可支付本人订单的全部金额</small></div><div className="button-row"><button className="secondary" disabled={busy} onClick={()=>run(async()=>{await load();await refreshAccount();})}><RefreshCw size={15}/>刷新</button><button className="primary" onClick={()=>setForm(!form)}><Plus size={16}/>{form?'收起申请':'申请充值'}</button></div></section>
  {customer.is_demo===1&&<p className="info-box">演示余额仅用于体验，不代表真实资金。</p>}
  {error&&<p className="error-text" role="alert">{error}</p>}{notice&&<p className="info-box" role="status">{notice}</p>}
  {form&&<form className="panel wallet-topup-form" onSubmit={e=>{e.preventDefault();run(async()=>{
   if(!/^\d+(\.\d{1,2})?$/.test(amount))throw Error('请输入最多两位小数的充值金额');
   const values={amount:Math.round(Number(amount)*100),method,note},serialized=JSON.stringify(values);
   if(request.current.payload!==serialized)request.current={payload:serialized,key:Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('')};
   const result=await api('customer/wallet/topup',{...values,request_key:request.current.key},customer.csrf);
   request.current={payload:'',key:''};setNotice('充值申请 '+result.id+' 已提交。请按下方指引联系客服，核实到账后入账。');setForm(false);setNote('');await load();
  });}}><h3>提交充值申请</h3><p className="hint">在线充值接口尚未接入。提交申请不会扣款，也不会增加余额；请与商家确认收款方式后再付款。</p><div className="form-grid"><label>充值金额（元）<input type="number" min="1" max="10000" step="0.01" required value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>希望使用的付款方式<select value={method} onChange={e=>setMethod(e.target.value)}>{Object.entries(methods).map(([v,n])=><option key={v} value={v}>{n} · 人工核实</option>)}</select></label></div><label>备注（选填）<textarea rows={2} maxLength={300} value={note} onChange={e=>setNote(e.target.value)} placeholder="便于商家核对的信息，请勿填写密码或验证码"/></label><button className="primary" disabled={busy}>{busy?'正在提交…':'提交充值申请'}</button></form>}
  <section className="panel"><h3>充值指引</h3><p className="pre-wrap">{data?.instructions||'正在读取充值指引…'}</p><p className="hint">余额用于本商城消费。充值与退款问题请联系客服处理。</p></section>
  <section className="panel"><div className="panel-title"><h3>充值申请</h3><small>最近 50 笔</small></div>{!data?<p>正在加载…</p>:data.topups.length?<div className="table-scroll"><table><thead><tr><th>申请</th><th>金额</th><th>方式</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.topups.map((t:any)=><tr key={t.id}><td><span className="mono">{t.id}</span><small>{date(t.created_at)}</small>{t.review_note&&<small>{t.review_note}</small>}</td><td>{money(t.amount)}</td><td>{methods[t.method]}</td><td>{states[t.status]}</td><td>{t.status==='pending'&&<button className="text-button" disabled={busy} onClick={()=>run(async()=>{await api('customer/wallet/cancel',{id:t.id},customer.csrf);await load();})}>取消申请</button>}</td></tr>)}</tbody></table></div>:<p className="small-empty">暂无充值申请，点击「申请充值」开始。</p>}</section>
  <section className="panel"><div className="panel-title"><h3>余额明细</h3><small>每一笔收支都有记录</small></div>{data?.ledger.length?<><div className="table-scroll"><table><thead><tr><th>事项</th><th>变动</th><th>变动后余额</th><th>时间</th></tr></thead><tbody>{data.ledger.map((l:any)=><tr key={l.id}><td>{l.description}{l.order_id&&<button className="text-button" onClick={()=>openOrder(l.order_id)}>查看订单 <ArrowUpRight size={12}/></button>}</td><td className={l.delta>0?'success-text':''}>{l.delta>0?'+':''}{money(l.delta)}</td><td>{money(l.balance_after)}</td><td>{date(l.created_at)}</td></tr>)}</tbody></table></div>{data.ledger_total>20&&<div className="pagination"><button className="secondary" disabled={page===1} onClick={()=>setPage(page-1)}>上一页</button><span>第 {page} 页</span><button className="secondary" disabled={page*20>=data.ledger_total} onClick={()=>setPage(page+1)}>下一页</button></div>}</>:<p className="small-empty">充值到账、余额付款和退款会显示在这里。</p>}</section>
 </div>;
}
