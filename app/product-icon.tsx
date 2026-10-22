'use client';
import {useEffect,useState} from 'react';
import CatalogIcon from './catalog-icon';
import type {Product} from '@/lib/commerce/types';
export default function ProductIcon({product,large=false}:{product:Pick<Product,'category_id'|'icon_key'|'country_code'>&{name?:string;image_url?:string};large?:boolean}){
 const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[product.image_url]);const key=product.icon_key||'box';
 return <div className={`product-icon physical-product ${product.image_url&&!failed?'product-photo':''} ${large?'large':''}`} role="img" aria-label={product.name||'商品'}>{product.image_url&&!failed?<img src={product.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<CatalogIcon value={key} size={large?48:32}/>}</div>;
}
