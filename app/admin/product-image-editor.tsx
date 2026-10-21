'use client';
import {useRef,useState} from 'react';
import {Upload,Plus,ArrowLeft,ArrowRight,Trash2,ImagePlus} from 'lucide-react';
export default function ProductImageEditor({images,onChange,csrf,ready,onBusy}:{images:string[];onChange:(images:string[])=>void;csrf?:string;ready:boolean;onBusy:(busy:boolean)=>void}){
 const [url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const picker=useRef<HTMLInputElement>(null),replacement=useRef<number|null>(null);
 async function upload(file:File){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){setError('请选择不超过 5 MB 的 JPG、PNG 或 WebP 图片');return;}
  setBusy(true);onBusy(true);setError('');
  try{const response=await fetch('/api/admin/media/upload',{method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type,'x-csrf-token':csrf||''},body:file});const result=await response.json() as {url:string;error?:string};if(!response.ok)throw Error(result.error||'图片上传失败');const next=[...images];if(replacement.current===null)next.push(result.url);else next[replacement.current]=result.url;onChange(next);}
  catch(e){setError((e as Error).message);}finally{setBusy(false);onBusy(false);replacement.current=null;}
 }
 function move(index:number,direction:number){const next=[...images];[next[index],next[index+direction]]=[next[index+direction],next[index]];onChange(next);}
 return <section className="product-image-editor"><h3><ImagePlus size={18}/>商品图片 <small>{images.length} / 8</small></h3><p className="hint">第一张为商品主图。可添加、替换、移除和调整顺序；保存商品后生效。</p>
 <div className="image-editor-grid">{images.map((src,i)=><div className="image-editor-card" key={i}><img src={src} alt={`商品图片 ${i+1}`} referrerPolicy="no-referrer"/>{i===0&&<span className="image-cover-badge">主图</span>}<div><button type="button" className="icon-button" aria-label={`图片 ${i+1} 前移`} disabled={busy||i===0} onClick={()=>move(i,-1)}><ArrowLeft size={14}/></button><button type="button" className="icon-button" aria-label={`图片 ${i+1} 后移`} disabled={busy||i===images.length-1} onClick={()=>move(i,1)}><ArrowRight size={14}/></button><button type="button" className="text-button" disabled={busy||!ready} onClick={()=>{replacement.current=i;picker.current?.click();}}>替换</button><button type="button" className="icon-button" aria-label={`移除图片 ${i+1}`} disabled={busy} onClick={()=>onChange(images.filter((_,index)=>index!==i))}><Trash2 size={14}/></button></div></div>)}</div>
 <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)upload(file);}}/>
 <div className="button-row"><button type="button" className="secondary" disabled={busy||images.length>=8||!ready} onClick={()=>{replacement.current=null;picker.current?.click();}}><Upload size={15}/>{busy?'上传中…':'上传本地图片'}</button><small>JPG / PNG / WebP · 每张不超过 5 MB</small></div>
 {!ready&&<p className="info-box">本地上传等待图片存储配置。可先添加 HTTPS 图片链接；开通上传需为 Worker 绑定 R2 存储桶，变量名 BUCKET。</p>}
 <label>添加图片链接<div className="image-url-input"><input type="url" maxLength={1000} value={url} disabled={busy||images.length>=8} onChange={e=>setUrl(e.target.value)} placeholder="https://…"/><button type="button" className="secondary" disabled={busy||!url.trim()||images.length>=8} onClick={()=>{try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error();onChange([...new Set([...images,url.trim()])]);setUrl('');setError('');}catch{setError('请输入有效的 HTTPS 图片地址');}}}><Plus size={16}/>添加</button></div></label>
 {error&&<p className="error-text" role="alert">{error}</p>}</section>;
}
