'use client';
import {useState} from 'react';
import {Send,Copy,ExternalLink,LockKeyhole} from 'lucide-react';
import {GIFT_LABEL} from '@/lib/commerce/order-display';
export default function TelegramGift({content,unlocked=false,demo,support}: {content?:string|null;unlocked?:boolean;demo?:boolean;support?:string}) {
 const [message,setMessage]=useState('');
 const visible=unlocked&&!!content;
 return <section className="telegram-gift"><div className="gift-title">{visible?<Send size={20}/>:<LockKeyhole size={20}/>}<div><h4>{GIFT_LABEL}</h4><small>随单赠送一个，用于联系客服及售后</small></div><span>{visible?'已解锁':'付款后领取'}</span></div>{visible?<>{demo&&<p className="hint">演示内容，不能登录 Telegram。</p>}<pre>{content}</pre><div className="button-row"><button className="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(content!);setMessage('账号内容已复制');}catch{setMessage('复制失败，请手动选择上方内容');}}}><Copy size={14}/>复制账号内容</button>{support&&/^[A-Za-z0-9_]{5,32}$/.test(support)?<a className="secondary" href={'https://t.me/'+support} target="_blank" rel="noreferrer">联系客服 <ExternalLink size={14}/></a>:<span className="hint">客服用户名待商家配置，可先提交订单工单。</span>}</div>{message&&<p role="status" className="hint">{message}</p>}<small>请保存订单凭证，付款后可凭订单号和密钥再次查看账号。</small></>:<p className="gift-locked-note">{unlocked?'账号暂时无法显示，请提交订单工单联系客服。':'付款成功后显示账号内容。未付款时无法查看或复制账号，仍可提交订单工单。'}</p>}</section>;
}
