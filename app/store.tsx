'use client';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { ArrowRight, RotateCw, Search, ShoppingBag, ShieldCheck, Zap, Headphones, Send, Globe, Sparkles, Code2, FileText, Box, Apple, AtSign as Twitter, ChevronRight, X, Minus, Plus, ArrowUpRight, Check, Copy, SlidersHorizontal, PackageCheck, Clock3, AlertCircle, ExternalLink, Menu, House, TreePine, LayoutGrid, UserRound } from 'lucide-react';
import { api, money, date, statuses } from '@/lib/commerce/client';
import AccountCenter, {type CustomerState} from './account-center';
import OrderSummary from './order-summary';
import TelegramGift from './telegram-gift';
import {GIFT_LABEL} from '@/lib/commerce/order-display';
import HelpCenter from './help-center';
import BrandMark from './brand-mark';
import { useDialogs } from '@/hooks/use-dialogs';
import ProductGallery from './product-gallery';
import ProductIcon from './product-icon';
import type { Catalog, Product, Order } from '@/lib/commerce/types';
const icons: Record<string, any> = { send: Send, twitter: Twitter, apple: Apple, globe: Globe, sparkles: Sparkles, code: Code2, file: FileText, headphones: Headphones, box: Box, home:House, bag:ShoppingBag, desk:LayoutGrid, outdoor:TreePine };
export default function Store({ initialPage = 'shop', initialProduct }: {
    initialPage?: string;
    initialProduct?: string;
}) {
    const [catalog, setCatalog] = useState<Catalog | null>(null), [error, setError] = useState(''), [page, setPage] = useState(initialPage), [category, setCategory] = useState('all'), [search, setSearch] = useState(''), [sort, setSort] = useState('recommended'), [stockOnly, setStockOnly] = useState(false), [mobileMenu, setMobileMenu] = useState(false);
    const [cart, setCart] = useState<Record<string, number>>({}), [drawer, setDrawer] = useState(false), [selected, setSelected] = useState<Product | null>(null), [qty, setQty] = useState(1), [notice, setNotice] = useState(''), [contact, setContact] = useState(''), [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [receipt, setReceipt] = useState<any>(null);
    const [orderId, setOrderId] = useState(''), [secret, setSecret] = useState(''), [order, setOrder] = useState<Order | null>(null), [recent, setRecent] = useState<{
        id: string;
        secret: string;
    }[]>([]), [ticketOpen, setTicketOpen] = useState(false), [ticketSubject, setTicketSubject] = useState(''), [ticketMessage, setTicketMessage] = useState(''), [policy, setPolicy] = useState<string | null>(null);
    const [contactEmail,setContactEmail]=useState('');
    const [recipient,setRecipient]=useState(''),[address,setAddress]=useState(''),[paymentMethod,setPaymentMethod]=useState('wechat');
    const [account,setAccount]=useState<CustomerState|null>(null),[accountError,setAccountError]=useState('');
    const accountRef=useRef<CustomerState|null>(null),accountRequest=useRef(0);
    const refreshAccount=useCallback(async()=>{
        const request=++accountRequest.current;
        try{
            const next=await api<CustomerState>('customer/session');
            if(request!==accountRequest.current)return;
            const previous=accountRef.current;accountRef.current=next;setAccount(next);setAccountError('');
            if(previous?.customer&&!next.customer){setOrder(null);setSecret('');setReceipt(null);setPaymentMethod('wechat');}
        }catch(e){
            if(request===accountRequest.current)setAccountError('账号服务连接失败，请重新加载。');
            throw e;
        }
    },[]);
    const checkoutIdentity=useRef({payload:'',token:''});
    useDialogs([selected?'product':'',drawer?'cart':'',receipt?'receipt':'',ticketOpen?'ticket':'',policy||''].join('|'),()=>{
        if(policy) setPolicy(null); else if(ticketOpen) setTicketOpen(false); else if(receipt){setReceipt(null);navigate('orders');lookup(receipt.id,receipt.secret);} else if(drawer) setDrawer(false); else setSelected(null);
    });
    async function refresh() {
        try {
            setCatalog(await api<Catalog>('catalog'));
            setError('');
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    useEffect(() => {
        refresh();
        try {
            setCart(JSON.parse(localStorage.getItem('px-cart') || '{}'));
            setRecent(JSON.parse(localStorage.getItem('px-recent') || '[]'));
        }
        catch {
        }
    }, []);
    useEffect(()=>{
        refreshAccount().catch(()=>{});
        if(page!=='account')return;
        // Refresh an anonymous login screen after runtime settings change, without
        // overwriting a signed-in customer's unsaved profile edits.
        const recheck=()=>{if(!accountRef.current?.customer&&document.visibilityState==='visible')refreshAccount().catch(()=>{});};
        window.addEventListener('focus',recheck);
        const timer=window.setInterval(recheck,30000);
        return()=>{window.removeEventListener('focus',recheck);window.clearInterval(timer);};
    },[page,refreshAccount]);
    useEffect(() => {
        if (initialProduct && catalog) {
            const p = catalog.products.find(x => x.id === initialProduct);
            if (p) {
                setSelected(p);
                setQty(p.min_qty);
            }
        }
    }, [initialProduct, catalog]);
    useEffect(() => {
        if (notice) {
            const t = setTimeout(() => setNotice(''), 3500);
            return () => clearTimeout(t);
        }
    }, [notice]);
    function updateCart(next: Record<string, number>) {
        setCart(next);
        localStorage.setItem('px-cart', JSON.stringify(next));
    }
    function add(p: Product, q = 1) {
        if (!p.stock)
            return;
        updateCart({ ...cart, [p.id]: Math.min(p.max_qty, p.stock, (cart[p.id] || 0) + q) });
        setNotice('已加入购物车');
    }
    function navigate(next: string) {
        setPage(next);
        setMobileMenu(false);
        setError('');
        history.replaceState(null, '', next === 'shop' ? '/' : '/' + next);
        window.scrollTo({ top: 0 });
    }
    const filtered = useMemo(() => {
        let list = (catalog?.products || []).filter(p => (category === 'all' || (category==='__other__'?p.shipping_class==='other':p.category_id === category)) && (p.name + p.subtitle + p.region + p.tag).toLowerCase().includes(search.toLowerCase()) && (!stockOnly || p.stock > 0));
        return [...list].sort((a, b) => sort === 'price-asc' ? a.price - b.price : sort === 'price-desc' ? b.price - a.price : sort === 'newest' ? b.created_at - a.created_at : b.featured - a.featured);
    }, [catalog, category, search, sort, stockOnly]);
    const cartLines = Object.entries(cart).map(([id, q]) => ({ p: catalog?.products.find(p => p.id === id), q })).filter(x => x.p) as {
        p: Product;
        q: number;
    }[], subtotal = cartLines.reduce((v, l) => v + l.p.price * l.q, 0), shippingFee = cartLines.some(l=>l.p.shipping_class!=='other') ? (catalog?.shippingFee ?? 2000) : 0, total = subtotal + shippingFee, cartCount = cartLines.reduce((v, l) => v + l.q, 0);
    async function checkout() {
        setBusy(true);
        try {
            const payload = {contact,contact_email:contactEmail.trim(), recipient, shipping_address:address, payment_method:paymentMethod, acceptedTerms:accepted,items:cartLines.map(l=>({id:l.p.id,quantity:l.q}))};
            const serialized=JSON.stringify({...payload,customer:account?.customer?.id});
            if(checkoutIdentity.current.payload!==serialized){const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');checkoutIdentity.current={payload:serialized,token};}
            const r=await api('orders',{...payload,accountCheckout:!!account?.customer,checkoutToken:checkoutIdentity.current.token},account?.customer?.csrf);
            checkoutIdentity.current={payload:'',token:''};
            setReceipt(r);
            const next = [{ id: r.id, secret: r.secret }, ...recent].slice(0, 20);
            setRecent(next);
            localStorage.setItem('px-recent', JSON.stringify(next));
            updateCart({});
            setDrawer(false);
            setSelected(null);
            setOrderId(r.id);
            setSecret(r.secret);
            await refresh();
        }
        catch (e) {
            setNotice((e as Error).message);
            if((e as Error).message.includes('登录已过期'))await refreshAccount().catch(()=>{});
        }
        finally {
            setBusy(false);
        }
    }
    async function lookup(id = orderId, key = secret) {
        setBusy(true);
        setError('');
        try {
            setOrder(await api<Order>('orders/lookup', { id, secret: key },account?.customer?.csrf));
            setOrderId(id);
            setSecret(key);
        }
        catch (e) {
            setError((e as Error).message);
            setOrder(null);
        }
        finally {
            setBusy(false);
        }
    }
    async function copy(s: string) {
        try {
            await navigator.clipboard.writeText(s);
            setNotice('已复制');
        }
        catch {
            setNotice('复制失败，请手动选择文本');
        }
    }
    function download(s: string, name: string) {
        const url = URL.createObjectURL(new Blob([s], { type: 'text/plain;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
    }
    return <div className="store"><div className="topline"><span><ShieldCheck size={13}/> 实体好物 · 自助选购</span><span>中文服务 <i /> 人民币 CNY</span></div>
    <header className="store-header"><div className="header-inner"><a className="brand" href="/" onClick={e => {
        e.preventDefault();
        navigate('shop');
    }}><span className="brand-mark"><BrandMark size={25}/></span><span>{catalog?.settings.brand || '品香'}<small>PINXIANG</small></span></a><nav className={mobileMenu ? 'open' : ''}>{[['shop', '商品商城'], ['help', '帮助中心']].map(([key, label]) => <a key={key} className={page === key ? 'active' : ''} href={key === 'shop' ? '/' : '/' + key} onClick={e => {
        e.preventDefault();
        navigate(key);
    }}>{label}</a>)}</nav><div className="header-actions"><a href="/orders" className={'header-order-link '+(page==='orders'?'active':'')} onClick={e=>{e.preventDefault();navigate('orders');}}><Search size={17}/><span>订单查询</span></a><a href="/account" className="header-login" onClick={e=>{e.preventDefault();navigate('account');}}><UserRound size={17}/><span>{account?.customer?'我的账号':'登录'}</span></a><button className="cart-button" onClick={() => setDrawer(true)}><ShoppingBag size={18}/><span>购物车</span>{cartCount > 0 && <b>{cartCount}</b>}</button><button className="icon-button menu-button" aria-label="打开菜单" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={20}/></button></div></div></header>
    <main className="store-main">{page === 'shop' ? <>
        <section className="hero"><div className="hero-copy"><div className="eyebrow"><span /> PINXIANG · EVERYDAY ESSENTIALS</div><h1>日常好物，<br /><em>随选，随享。</em></h1><p>{catalog?.settings.tagline || '精选日常好物，让生活多一点喜欢。'}<br />普通商品整单邮费 ¥20，其他商品单独购买免邮。</p><div className="hero-actions"><button className="primary" onClick={() => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' })}>发现精选商品 <ArrowRight size={17}/></button><button className="hero-guide" onClick={()=>navigate('help')}>第一次购买？ <ArrowUpRight size={16}/></button></div><div className="hero-proof"><span><Zap size={15}/> 自助下单</span><span><ShieldCheck size={15}/> 其他商品免邮</span><span><Headphones size={15}/> 售后支持</span></div></div><div className="hero-art" aria-hidden="true"><div className="editorial-orbit"/><div className="feature-ticket ticket-back"><ShoppingBag size={26}/><small>MAKE EVERYDAY BETTER</small><strong>好物随行，<br/>让生活更轻盈。</strong><span>HOME & EVERYDAY</span></div><div className="feature-ticket ticket-front"><div className="ticket-label"><span>品香精选</span><ArrowUpRight size={21}/></div><div className="ticket-symbol"><Sparkles size={62} strokeWidth={1.25}/></div><strong>每一份日常<br/>都值得被喜欢。</strong><div className="ticket-rule"/><small>A LITTLE MORE JOY.</small></div><div className="floating-label"><span className="success-circle"><Check size={15}/></span><div>把喜欢带回日常<small>选购 · 下单 · 等待好物</small></div></div><span className="art-index">CURATED FOR YOUR EVERYDAY / 01</span></div></section>
        <div className="announcement"><span className="announcement-label"><AlertCircle size={16}/> 商城公告</span><p>{catalog?.settings.announcement || '下单前请仔细查看商品说明与使用条件。'}</p><a href="/help" onClick={e => {
            e.preventDefault();
            navigate('help');
        }}>购买须知 <ChevronRight size={15}/></a></div>
        <section className="catalog-layout" id="catalog"><aside className="catalog-sidebar"><div className="sidebar-heading">商品分类 <span>{catalog?.categories.length || 0}</span></div><button className={category === 'all' ? 'category active' : 'category'} onClick={() => setCategory('all')}><Box size={17}/> 全部商品 <span>{catalog?.products.length || 0}</span></button><button className={category==='__other__'?'category active':'category'} onClick={()=>setCategory('__other__')}><Box size={17}/>其他商品 <span>免邮</span></button>{catalog?.categories.map(c => {
            const Icon = icons[c.icon] || Box;
            return <button key={c.id} className={category === c.id ? 'category active' : 'category'} onClick={() => setCategory(c.id)}><Icon size={17}/> {c.name}<span>{catalog.products.filter(p => p.category_id === c.id).length}</span></button>;
        })}<div className="sidebar-help"><Headphones size={25}/><h4>选购遇到问题？</h4><p>查看购买指南，<br />或提交订单售后工单。</p><button onClick={() => navigate('help')}>前往帮助中心 <ArrowRight size={14}/></button></div></aside><div className="catalog-content"><div className="catalog-heading"><div><h2>{category==='__other__'?'其他商品 · 免邮':category === 'all' ? '精选日常好物' : catalog?.categories.find(c => c.id === category)?.name}</h2><p>居家、随行与桌面，找到你的日常所需</p></div>{catalog?.demo && <span className="tag muted"><span className="small-dot"/> 演示商城 · 示例商品</span>}</div><div className="catalog-tools"><label className="search-input"><Search size={18}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索商品、地区或关键词"/>{search && <button aria-label="清空搜索" onClick={() => setSearch('')}><X size={14}/></button>}</label><select aria-label="商品排序" value={sort} onChange={e => setSort(e.target.value)}><option value="recommended">推荐排序</option><option value="price-asc">价格从低到高</option><option value="price-desc">价格从高到低</option><option value="newest">最新上架</option></select><label className="stock-filter"><input type="checkbox" checked={stockOnly} onChange={e => setStockOnly(e.target.checked)}/> 仅看有货</label></div><div className="result-count">共 <strong>{filtered.length}</strong> 件商品 <span>价格以人民币计价</span></div>
        {error ? <div className="empty"><AlertCircle size={30}/><h3>暂时无法加载商品</h3><p>{error}</p><button className="secondary" onClick={refresh}>重试</button></div> : !catalog ? <div className="product-grid">{[1, 2, 3, 4, 5, 6].map(x => <div key={x} className="product-card skeleton"/>)}</div> : !filtered.length ? <div className="empty"><Search size={34}/><h3>{catalog.products.length ? '没有找到相关商品' : '商城正在准备中'}</h3><p>{catalog.products.length ? '试试其他关键词，或查看全部分类。' : '商家完成商品上架后，商品会显示在这里。'}</p><button className="secondary" onClick={() => {
            setSearch('');
            setCategory('all');
            setStockOnly(false);
        }}>查看全部商品</button></div> : <div className="product-grid">{filtered.map(p => <article key={p.id} className="product-card"><div className="product-card-top"><ProductIcon product={p}/><span className={`tag ${p.featured ? 'violet' : 'muted'}`}>{p.featured ? '热门推荐' : p.tag || '精选商品'}</span></div><button className="product-title" onClick={() => {
            setSelected(p);
            setQty(p.min_qty);
        }}>{p.name}</button><p className="product-subtitle">{p.subtitle}</p><div className="product-meta"><span><Globe size={12}/>{p.region}</span><span><Zap size={12}/>{p.shipping_class==='other'?'其他商品 · 免邮':'普通商品'}</span></div><div className="product-card-bottom"><div><span className="price">{money(p.price)}</span>{p.compare_price > p.price && <del>{money(p.compare_price)}</del>}<small className={p.stock ? 'stock' : 'out-stock'}><span /> {p.stock ? '库存 ' + p.stock : p.id.startsWith('dp-') ? '备货中' : '暂时缺货'}</small></div><button className="buy-button" disabled={!p.stock} onClick={() => {
            setSelected(p);
            setQty(p.min_qty);
        }}>选购 <ArrowRight size={14}/></button></div></article>)}</div>}
        </div></section><section className="benefit-strip">{[[ShieldCheck, '订单访问保护', '凭订单号与密钥安全查询'], [Zap, '清楚透明的邮费', '普通商品 20 元，其他商品单独免邮'], [Send, '付款后领取账号', '加密通讯账号 · 客服与售后'], [Headphones, '售后服务支持', '每个问题都有处理记录']].map(([Icon, title, desc]: any) => <div key={title}><Icon size={24}/><span><strong>{title}</strong><small>{desc}</small></span></div>)}</section>
        </> : page === 'account' ? <AccountCenter session={account} sessionError={accountError} refresh={refreshAccount} shop={()=>navigate('shop')} openOrder={id=>{navigate('orders');lookup(id,'');}}/> : page === 'orders' ? <section className="subpage"><div className="eyebrow">MY ORDERS</div><h1>订单与售后，都在这里。</h1><p className="subpage-lead">输入订单号与查询密钥，查看发货状态和物流单号，付款后可查看赠送的加密通讯账号。</p><div className="order-layout"><div>{account?.customer&&<div className="panel account-order-shortcut"><UserRound size={20}/><div><strong>已登录，可直接查看本人订单</strong><button className="text-button" onClick={()=>navigate('account')}>前往我的订单 <ArrowRight size={14}/></button></div></div>}<form className="panel lookup-form" onSubmit={e => {
            e.preventDefault();
            lookup();
        }}><h3><Search size={19}/> 查询订单</h3><label>订单号<input required value={orderId} onChange={e => setOrderId(e.target.value)} placeholder="例如 PX20261013…"/></label><label>查询密钥<input required type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="下单时获得的查询密钥"/></label><button className="primary" disabled={busy}>{busy ? '正在查询…' : '查询我的订单'}<ArrowRight size={16}/></button>{error && <p className="error-text">{error}</p>}</form><div className="panel local-orders"><h3><Clock3 size={18}/> 本机最近订单</h3><p>仅记录在当前浏览器，请妥善保存查询密钥。</p>{recent.length ? recent.map(o => <button key={o.id} onClick={() => lookup(o.id, o.secret)}><span>{o.id}</span><ChevronRight size={16}/></button>) : <div className="small-empty">当前浏览器暂无订单</div>}</div></div><div>{order ? <OrderSummary order={order} secret={secret} csrf={account?.customer?.csrf} catalog={catalog} busy={busy} customer={account?.customer} refreshAccount={refreshAccount} update={setOrder} ticket={()=>setTicketOpen(true)} copy={copy} cancel={async()=>{setBusy(true);try{await api('orders/cancel',{id:orderId,secret},account?.customer?.csrf);await lookup();await refresh();}catch(e){setNotice((e as Error).message);}finally{setBusy(false);}}}/> : <div className="panel empty order-placeholder"><PackageCheck size={52}/><h3>订单信息将在这里显示</h3><p>查询后可查看未发货或已发货状态、物流单号，付款后显示赠送账号。</p></div>}</div></div></section> : <HelpCenter settings={catalog?.settings || {}} navigate={navigate}/>}
    </main><footer className="store-footer"><div><a className="brand" href="/"><span className="brand-mark"><BrandMark size={23}/></span><span>{catalog?.settings.brand || '品香'}<small>PINXIANG</small></span></a><p>{catalog?.settings.footer || '日常好物，自助选购'} · 把喜欢带回生活</p></div><div className="footer-links"><button onClick={() => setPolicy('terms')}>购买协议</button><button onClick={() => setPolicy('privacy')}>隐私政策</button><small>© {new Date().getFullYear()} PINXIANG</small></div></footer>
    {notice && <div className="toast" role="status"><Check size={17}/>{notice}</div>}
    {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><div className="modal product-modal" role="dialog" aria-modal="true" aria-label="商品详情" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="关闭" onClick={() => setSelected(null)}><X size={22}/></button><ProductGallery key={selected.id} product={selected}/><p className="hint">{selected.shipping_class==='other'?'其他商品：单独购买免邮，与普通商品同购时整单邮费 20 元。':'普通实体商品：整单固定邮费 20 元。'}</p><span className="tag violet">{selected.tag}</span><h2>{selected.name}</h2><p>{selected.subtitle}</p><div className="detail-price">{money(selected.price)} <span>/ 件</span></div><div className="detail-spec"><span>适用地区 <strong>{selected.region}</strong></span><span>可售库存 <strong>{selected.stock} 件</strong></span></div><h4>商品介绍</h4><p className="pre-wrap">{selected.description}</p><h4>购买须知</h4><p className="pre-wrap">{selected.instructions}</p><div className="quantity-row"><span>购买数量</span><div className="quantity"><button aria-label="减少数量" disabled={qty <= selected.min_qty} onClick={() => setQty(qty - 1)}><Minus size={14}/></button><span>{qty}</span><button aria-label="增加数量" disabled={qty >= Math.min(selected.max_qty, selected.stock)} onClick={() => setQty(qty + 1)}><Plus size={14}/></button></div></div><div className="button-row"><button className="secondary" disabled={!selected.stock} onClick={() => add(selected, qty)}>加入购物车</button><button className="primary" disabled={!selected.stock} onClick={() => {
        add(selected, qty);
        setSelected(null);
        setDrawer(true);
    }}>立即购买 <ArrowRight size={16}/></button></div></div></div>}
    {drawer && <div className="modal-backdrop drawer-backdrop" onClick={() => setDrawer(false)}><aside className="cart-drawer" role="dialog" aria-modal="true" aria-label="购物车" onClick={e => e.stopPropagation()}><div className="drawer-title"><h2><ShoppingBag size={21}/> 我的购物车 <span>{cartCount}</span></h2><button className="icon-button" aria-label="关闭购物车" onClick={() => setDrawer(false)}><X size={22}/></button></div>{cartLines.length ? <><div className="cart-items">{cartLines.map(({ p, q }) => <div className="cart-item" key={p.id}><ProductIcon product={p}/><div><strong>{p.name}</strong><small>{money(p.price)} / 件</small><div className="quantity"><button aria-label="减少" onClick={() => {
        if (q <= p.min_qty) {
            const next = { ...cart };
            delete next[p.id];
            updateCart(next);
        }
        else
            updateCart({ ...cart, [p.id]: q - 1 });
    }}><Minus size={12}/></button><span>{q}</span><button aria-label="增加" disabled={q >= Math.min(p.stock, p.max_qty)} onClick={() => updateCart({ ...cart, [p.id]: q + 1 })}><Plus size={12}/></button></div></div><button className="icon-button" aria-label="删除商品" onClick={() => {
        const next = { ...cart };
        delete next[p.id];
        updateCart(next);
    }}><X size={15}/></button></div>)}</div><div className="cart-checkout"><div className="checkout-account-note"><UserRound size={17}/><span>{account?.customer?'订单将保存到你的账号':'免登录下单，记得保存订单凭证'}</span>{account?.customer&&(account.customer.recipient||account.customer.contact||account.customer.shipping_address)&&<button className="text-button" onClick={()=>{setRecipient(account.customer!.recipient);setContact(account.customer!.contact);setAddress(account.customer!.shipping_address);}}>使用常用信息</button>}</div><label>收货人 <small>选填</small><input value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="可留空，稍后联系客服补充" maxLength={60}/></label><label>收货地址 <small>选填</small><textarea rows={2} value={address} onChange={e=>setAddress(e.target.value)} placeholder="省市区、街道与门牌号（可留空）" maxLength={500}/></label><label>联系方式 <small>选填</small><input value={contact} onChange={e => setContact(e.target.value)} placeholder="手机号或其他联系方式（可留空）" maxLength={100}/></label><label>联系邮箱 <small>选填 · 接收订单通知</small><input type="email" autoComplete="email" maxLength={254} value={contactEmail} onChange={e=>setContactEmail(e.target.value)} placeholder="you@example.com"/></label>{account?.customer&&!account.customer.is_demo&&<button className="text-button" onClick={()=>setContactEmail(account.customer!.email)}>使用登录邮箱</button>}<p className="hint">填写即同意接收下单和付款成功通知。邮件不含查询密钥或赠送账号；留空不影响下单。</p><label className="checkbox-label"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}/>我已阅读商品说明并同意<button onClick={() => setPolicy('terms')}>购买协议</button></label><div className="checkout-method-picker"><span>付款方式 <small>余额可用，外部接口待接入</small></span><div>{[...(account?.customer?[['balance','账户余额']]:[]),['wechat','微信支付'],['alipay','支付宝'],['usdt','USDT']].map(([id,label])=><label key={id}><input type="radio" name="payment-method" value={id} checked={paymentMethod===id} onChange={()=>setPaymentMethod(id)}/>{label}</label>)}</div></div><div className="cart-breakdown"><div><span>商品金额</span><strong>{money(subtotal)}</strong></div><div className="mandatory-shipping"><span><Check size={15}/> 邮费 <small>{shippingFee?'含普通商品 · 固定费用':'仅其他商品 · 免邮'}</small></span><strong>{money(shippingFee)}</strong></div><div className="free-gift-line"><span><Send size={15}/><span>{GIFT_LABEL} × 1</span></span><strong>付款后领取</strong></div></div><div className="cart-total"><span>应付金额</span><strong>{money(total)}</strong></div>{!catalog?.giftAvailable&&<div className="info-box">赠送账号暂时缺货，请稍后再下单。</div>}{catalog?.demo && <div className="info-box">演示订单：不会扣款或配送，赠送账号为测试内容。</div>}<button className="primary" disabled={busy || !accepted || !catalog?.giftAvailable} onClick={checkout}>{busy ? '正在创建订单…' : '提交订单'} <ArrowRight size={17}/></button><small><ShieldCheck size={12}/> 订单凭证用于查询发货和领取赠送账号</small></div></> : <div className="empty"><ShoppingBag size={44}/><h3>购物车还是空的</h3><p>去发现值得入手的日常好物。</p><button className="primary" onClick={() => {
        setDrawer(false);
        navigate('shop');
    }}>去逛逛 <ArrowRight size={16}/></button></div>}</aside></div>}
    {receipt && <div className="modal-backdrop"><div className="modal receipt-modal" role="dialog" aria-modal="true" aria-label="订单创建成功"><span className="receipt-icon"><Check size={30}/></span><h2>订单已创建</h2><p>请保存以下信息用于查询订单。付款成功后才能查看赠送账号。</p><p className="hint">{receipt.contact_email?`订单通知邮箱：${receipt.contact_email}。请以订单页面状态为准，未收到邮件也不影响订单。`:'未填写联系邮箱，请保存下方订单凭证。'}</p><div className="credential"><small>订单号</small><code>{receipt.id}</code><small>查询密钥</small><code>{receipt.secret}</code></div><TelegramGift unlocked={receipt.telegram_gift_unlocked===true} content={receipt.telegram_gift} demo={!!receipt.demo} support={catalog?.settings.telegramSupport}/><div className="info-box">{receipt.demo ? '这是测试订单，请勿付款。' : catalog?.paymentEnabled ? '订单已保存，请前往订单页查看。' : account?.customer?'可前往订单页确认余额付款。微信、支付宝、USDT 在线接口尚未接入。':'微信、支付宝、USDT 接口待接入。登录用户可使用已充值余额付款。'}</div><div className="button-row"><button className="secondary" onClick={() => download(`订单号：${receipt.id}\n查询密钥：${receipt.secret}\n订单金额：${money(receipt.total)}`, receipt.id + '-凭证.txt')}>保存凭证</button><button className="primary" onClick={() => {
        setReceipt(null);
        navigate('orders');
        lookup(receipt.id, receipt.secret);
    }}>查看订单 <ArrowRight size={15}/></button></div></div></div>}
    {ticketOpen && <div className="modal-backdrop" onClick={() => setTicketOpen(false)}><form className="modal" role="dialog" aria-modal="true" aria-label="提交售后工单" onClick={e => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            await api('tickets', { orderId, secret, subject: ticketSubject, message: ticketMessage },account?.customer?.csrf);
            setTicketOpen(false);
            setTicketSubject('');
            setTicketMessage('');
            await lookup();
            setNotice('工单已提交');
        }
        catch (e) {
            setNotice((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }}><button type="button" className="modal-close" aria-label="关闭" onClick={() => setTicketOpen(false)}><X /></button><h2>提交售后工单</h2><label>问题主题<input required value={ticketSubject} onChange={e => setTicketSubject(e.target.value)} maxLength={100}/></label><label>详细说明<textarea required minLength={5} value={ticketMessage} onChange={e => setTicketMessage(e.target.value)} rows={5} maxLength={2000}/></label><button className="primary" disabled={busy}>提交工单 <ArrowRight size={15}/></button></form></div>}
    {policy && <div className="modal-backdrop" onClick={() => setPolicy(null)}><div className="modal" role="dialog" aria-modal="true" aria-label="商城协议" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="关闭" onClick={() => setPolicy(null)}><X /></button><h2>{policy === 'terms' ? '购买协议' : '隐私政策'}</h2><p className="pre-wrap">{catalog?.settings[policy] || '商家暂未填写，请联系商家确认。'}</p><button className="primary" onClick={() => setPolicy(null)}>我已了解</button></div></div>}
    </div>;
}
