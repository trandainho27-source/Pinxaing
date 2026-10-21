'use client';
import {useState} from 'react';
import {api,date} from '@/lib/commerce/client';
const labels:Record<string,string>={pending:'等待发送',blocked:'等待邮件配置',processing:'正在发送',failed:'发送未确认',sent:'邮件服务已接收',review:'需人工核对'};
export default function NotificationPanel({data,csrf,refresh}:{data:any;csrf?:string;refresh:()=>Promise<void>}){
 const [busy,setBusy]=useState(''),[error,setError]=useState('');
 return <section className="panel"><div className="panel-title"><h3>订单邮件通知</h3><button className="secondary" disabled={!!busy} onClick={()=>refresh().catch(e=>setError(e.message))}>刷新状态</button></div><p className="hint">下单通知与付款成功通知分别记录。邮件服务接收不等于收件箱已投递；演示订单不发送真实邮件。</p>{error&&<p className="error-text" role="alert">{error}</p>}<div className="table-scroll"><table><thead><tr><th>订单 / 邮箱</th><th>类型</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>{data.notifications.map((n:any)=><tr key={n.id}><td><span className="mono">{n.order_id}</span><small>{n.recipient}</small></td><td>{n.event==='paid'?'付款成功':'下单成功'}</td><td>{labels[n.status]}{n.last_error&&<small>{n.last_error}</small>}</td><td>{date(n.sent_at||n.created_at)}</td><td>{['pending','blocked','failed'].includes(n.status)&&<button className="text-button" disabled={!!busy} onClick={async()=>{setBusy(n.id);setError('');try{await api('admin/notifications',{id:n.id},csrf);await refresh();}catch(e){setError((e as Error).message);}finally{setBusy('');}}}>{busy===n.id?'处理中…':'重新尝试'}</button>}</td></tr>)}</tbody></table></div>{!data.notifications.length&&<p className="small-empty">正式订单填写联系邮箱后，通知记录会显示在这里。</p>}</section>;
}
