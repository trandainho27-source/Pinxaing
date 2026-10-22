// Values are presentation choices, independent of product category and shipping rules.
export const catalogIconChoices = [
    ['box','通用商品'],['sparkles','精选'],['star','星标'],['heart','爱心'],
    ['tag','标签'],['shield','盾牌'],['zap','闪电'],['grid','方格'],
] as const;
const legacy=['cup','bottle','bag','lamp','notebook','desk','home','outdoor','umbrella','send','twitter','apple','globe','code','file','headphones'];
export function customIconText(value?:string){return value?.startsWith('text:')?value.slice(5):'';}
export function validCatalogIcon(value:unknown):value is string {
    if(typeof value!=='string')return false;
    if(value===''||catalogIconChoices.some(([key])=>key===value)||legacy.includes(value))return true;
    const text=customIconText(value);
    return value.startsWith('text:')&&text.trim()===text&&text.length>0&&[...text].length<=8&&value.length<=40&&!/[\u0000-\u001f\u007f-\u009f<>]/u.test(text);
}
