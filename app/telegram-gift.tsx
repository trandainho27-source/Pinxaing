'use client';
import {useState} from 'react';
import {Send,Copy,ExternalLink} from 'lucide-react';
export default function TelegramGift({content,demo,support}: {content?:string|null;demo?:boolean;support?:string}) {
 const [message,setMessage]=useState('');
 if(!content)return null;
 return <section className="telegram-gift"><div className="gift-title"><Send size={20}/><div><h4>随单赠送 · Telegram 通讯账号</h4><small>用于联系客服及售后，每单赠送一个</small></div><span>免费赠送</span></div>{demo&&<p className="hint">演示内容，不能登录 Telegram。</p>}<pre>{content}</pre><div className="button-row"><button className="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(content);setMessage('账号内容已复制');}catch{setMessage('复制失败，请手动选择上方内容');}}}><Copy size={14}/>复制账号内容</button>{support&&/^[A-Za-z0-9_]{5,32}$/.test(support)?<a className="secondary" href={'https://t.me/'+support} target="_blank" rel="noreferrer">联系客服 <ExternalLink size={14}/></a>:<span className="hint">客服用户名待商家配置，可先提交订单工单。</span>}</div>{message&&<p role="status" className="hint">{message}</p>}<small>请保存订单凭证；账号内容仅在凭密钥查询订单时展示。</small></section>;
}
