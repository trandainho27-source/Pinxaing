// Shared display rules; the API checks payment before it even reads encrypted gift content.
export const GIFT_LABEL = '加密通讯账号-极致的隐私与安全';
export function giftIsUnlocked(order: {status:string;paid_at?:number|null}) {
    return typeof order.paid_at === 'number' && order.paid_at > 0
        && ['paid','fulfilled','refunded'].includes(order.status);
}
export function shipmentDisplay(value: unknown) {
    const number = typeof value === 'string' ? value.trim() : '';
    const trackingNumber = number === '无' ? '' : number;
    return {trackingNumber, shipped: !!trackingNumber, label: trackingNumber ? '已发货' : '未发货'};
}
