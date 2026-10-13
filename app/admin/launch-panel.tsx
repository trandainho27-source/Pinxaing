import { Check, ChevronRight, Compass } from 'lucide-react';
export default function LaunchPanel({data, navigate}: {data: any; navigate: (section: string) => void}) {
    if (!data) return null;
    const steps = [
        {name: '完善店铺信息', note: '品牌、客服与购买说明', done: data.brandReady, to: 'settings'},
        {name: '上架商品', note: `${data.products} 件在售${data.demo ? '示例' : ''}商品`, done: data.products > 0, to: 'products'},
        {name: '准备交付库存', note: `${data.stock} 份可交付内容`, done: data.stock > 0 && data.encryptionReady, to: 'inventory'},
        {name: '配置收款', note: data.demo ? '演示中不收取真实款项' : data.paymentReady ? '已配置，仍需实付验收' : '等待配置收款通道', done: data.paymentReady, to: 'payment'}
    ];
    return <section className="launch-panel"><div className="launch-title"><span><Compass size={20}/><strong>{data.demo ? '从这里了解你的店铺' : '开店准备'}</strong></span><small>{data.demo ? '先体验商品、下单与交付，再配置正式经营信息。' : '完成基础配置后，还需用实际商品验证付款与交付。'}</small></div><div className="launch-steps">{steps.map((s,i)=><button key={s.to} onClick={()=>navigate(s.to)}><span className={s.done?'launch-number done':'launch-number'}>{s.done?<Check size={16}/>:i+1}</span><span><strong>{s.name}</strong><small>{s.note}</small></span><ChevronRight size={15}/></button>)}</div></section>;
}
