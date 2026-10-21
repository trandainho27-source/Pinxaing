import type {Product} from './types.ts';
export function productImages(product:Pick<Product,'image_url'|'images_json'>):string[]{
    try{const values=JSON.parse(product.images_json||'[]');if(Array.isArray(values)&&values.length)return values.filter((x:unknown)=>typeof x==='string').slice(0,8);}catch{}
    return product.image_url?[product.image_url]:[];
}
