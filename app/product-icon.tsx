'use client';
import {useEffect,useState} from 'react';
import {Package,ShoppingBag,Coffee,LampDesk,NotebookPen,LayoutGrid,House,TreePine,GlassWater,Umbrella} from 'lucide-react';
import type {Product} from '@/lib/commerce/types';
const icons:Record<string,any>={cup:Coffee,bottle:GlassWater,bag:ShoppingBag,lamp:LampDesk,notebook:NotebookPen,desk:LayoutGrid,home:House,outdoor:TreePine,umbrella:Umbrella};
export default function ProductIcon({product,large=false}:{product:Pick<Product,'category_id'|'icon_key'|'country_code'>&{name?:string;image_url?:string};large?:boolean}){
 const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[product.image_url]);const key=product.icon_key||product.category_id.replace('px-',''),Icon=icons[key]||Package;
 return <div className={`product-icon physical-product physical-${key} ${product.image_url&&!failed?'product-photo':''} ${large?'large':''}`} role="img" aria-label={product.name||'实体商品'}>{product.image_url&&!failed?<img src={product.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<Icon size={large?48:32} strokeWidth={1.55}/>}</div>;
}
