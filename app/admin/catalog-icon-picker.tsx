'use client';
import {catalogIconChoices,customIconText} from '@/lib/commerce/catalog-icons';
import CatalogIcon from '../catalog-icon';
export default function CatalogIconPicker({value,onChange,label}:{value:string;onChange:(value:string)=>void;label:string}){
 const custom=value.startsWith('text:'),known=catalogIconChoices.some(([key])=>key===value)||value==='';
 return <div className="catalog-icon-picker"><label>{label}<select value={custom?'custom':value||'box'} onChange={e=>onChange(e.target.value==='custom'?'text:':e.target.value)}>{catalogIconChoices.map(([key,name])=><option key={key} value={key}>{name}</option>)}{!custom&&!known&&<option value={value}>原有图标（可更换）</option>}<option value="custom">自定义文字 / 表情</option></select></label>{custom&&<label>自定义标识<input required maxLength={32} value={customIconText(value)} onChange={e=>onChange('text:'+e.target.value)} placeholder="输入品牌简称、文字或表情"/><small className="hint">最多 8 个字符；上传商品图片后优先展示图片。</small></label>}<div className="catalog-icon-preview"><CatalogIcon value={value} size={28}/><small>图标预览</small></div></div>;
}
