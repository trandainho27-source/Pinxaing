import type {RuntimeEnv,Staff} from './types.ts';
import {stmt,first,now,fail,json,audit,limit} from './api-common.ts';
import {uid} from './security.ts';
const MAX_IMAGE=5*1024*1024;
const assetPattern=/^\/api\/media\/[a-f0-9-]{36}$/;
export async function validateImages(db:D1Database,values:unknown):Promise<string[]> {
    if(!Array.isArray(values)||values.length>8)fail(400,'每个商品最多添加 8 张图片');
    const result:string[]=[];
    for(const value of values){
        if(typeof value!=='string'||value.length>1000)fail(400,'图片地址无效');
        const url=value.trim();if(!url)continue;
        if(assetPattern.test(url)){if(!await first(db,'SELECT id FROM media_assets WHERE id=?',url.split('/').pop()))fail(400,'上传图片不存在，请重新上传');}
        else{try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error();}catch{fail(400,'商品图片需为上传图片或有效的 HTTPS 地址');}}
        if(!result.includes(url))result.push(url);
    }
    return result;
}
async function readImage(request:Request){
    if(Number(request.headers.get('content-length')||0)>MAX_IMAGE)fail(413,'单张图片不能超过 5 MB');
    const reader=request.body?.getReader();if(!reader)fail(400,'请选择图片文件');
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>MAX_IMAGE){await reader.cancel();fail(413,'单张图片不能超过 5 MB');}chunks.push(next.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;
}
export async function uploadMedia(db:D1Database,env:RuntimeEnv,request:Request,staff:Staff){
    if(!env.BUCKET)fail(503,'本地图片上传尚未配置。请在 Cloudflare 绑定 R2 存储桶，变量名为 BUCKET；目前可使用图片链接。');
    await limit(db,request,'product-image-upload',20);
    const bytes=await readImage(request),mime=request.headers.get('content-type')?.split(';')[0];
    const jpg=bytes.length>4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    const png=bytes.length>24&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b);
    const webp=bytes.length>16&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
    if(!((mime==='image/jpeg'&&jpg)||(mime==='image/png'&&png)||(mime==='image/webp'&&webp)))fail(400,'请上传有效的 JPG、PNG 或 WebP 图片，不支持 SVG 或其他文件');
    const id=uid(),key='product-images/'+id;
    await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:mime,cacheControl:'public, max-age=31536000, immutable'}});
    try{await db.batch([stmt(db,'INSERT INTO media_assets(id,object_key,mime_type,size,actor,created_at) VALUES(?,?,?,?,?,?)',id,key,mime,bytes.length,staff.id,now()),audit(db,staff.id,'product.image.upload',id)]);}catch(e){await env.BUCKET.delete(key);throw e;}
    return json({id,url:'/api/media/'+id},201);
}
export async function serveMedia(db:D1Database,env:RuntimeEnv,id:string){
    if(!/^[a-f0-9-]{36}$/.test(id))fail(404,'图片不存在');
    const asset=await first<any>(db,'SELECT object_key,mime_type FROM media_assets WHERE id=?',id);
    if(!asset||!env.BUCKET)fail(404,'图片不存在');
    const object=await env.BUCKET.get(asset.object_key);if(!object)fail(404,'图片不存在');
    return new Response(object.body,{headers:{'Content-Type':asset.mime_type,'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'ETag':object.httpEtag}});
}
