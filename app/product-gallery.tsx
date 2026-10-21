'use client';
import {useState} from 'react';
import type {Product} from '@/lib/commerce/types';
import {productImages} from '@/lib/commerce/product-images';
import ProductIcon from './product-icon';
export default function ProductGallery({product}:{product:Product}){
 const images=productImages(product),[selected,setSelected]=useState(0);
 if(!images.length)return <ProductIcon product={product} large/>;
 return <div className="product-gallery"><img className="product-gallery-main" src={images[selected]||images[0]} alt={product.name} referrerPolicy="no-referrer"/>{images.length>1&&<div className="product-gallery-thumbs">{images.map((src,i)=><button type="button" key={src} className={selected===i?'active':''} aria-label={`查看商品图片 ${i+1}`} aria-pressed={selected===i} onClick={()=>setSelected(i)}><img src={src} alt="" loading="lazy" referrerPolicy="no-referrer"/></button>)}</div>}</div>;
}
