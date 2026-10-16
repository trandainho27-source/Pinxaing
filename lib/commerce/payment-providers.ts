// All three providers deliberately fail closed until a real adapter is implemented.
export const paymentMethods = [
    {id:'wechat', name:'微信支付', enabled:false, status:'reserved'},
    {id:'alipay', name:'支付宝', enabled:false, status:'reserved'},
    {id:'usdt', name:'USDT', enabled:false, status:'reserved'}
] as const;
export type PaymentMethod = typeof paymentMethods[number]['id'];
export interface PaymentRequest { orderId:string; amount:number; currency:'CNY'; method:PaymentMethod; }
export interface PaymentResult { status:'unavailable'; method:PaymentMethod; message:string; }
export function reservedPayment(input:PaymentRequest):PaymentResult {
    return {status:'unavailable',method:input.method,message:'该支付接口已预留，暂未接通，请勿转账。'};
}
