export interface RuntimeEnv {
    DB?: D1Database;
    INVENTORY_KEY?: string;
    BOOTSTRAP_TOKEN?: string;
    DEMO_MODE?: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    PAYMENT_WEBHOOK_SECRET?: string;
    PAYMENT_PROVIDER?: string;
    TRON_RECEIVING_ADDRESS?: string;
    TRONGRID_API_KEY?: string;
    USDT_CNY_RATE?: string;
    DIDIPIFA_API_TOKEN?: string;
    DIDIPIFA_PURCHASE_ENABLED?: string;
}
export interface Product {
    product_type?: string;
    image_url?: string;
    id: string;
    category_id: string;
    name: string;
    subtitle: string;
    description: string;
    instructions: string;
    price: number;
    compare_price: number;
    min_qty: number;
    max_qty: number;
    featured: number;
    active: number;
    region: string;
    tag: string;
    is_example: number;
    stock: number;
    created_at: number;
    icon_key?: string;
    country_code?: string;
}
export interface Category {
    id: string;
    name: string;
    icon: string;
    sort: number;
    active: number;
}
export interface Staff {
    id: string;
    username: string;
    role: string;
    active: number;
    csrf?: string;
}
export interface Order {
    customer_id?: string | null;
    shipment_group_id?: string | null;
    order_type?: string;
    subtotal?: number;
    shipping_fee?: number;
    recipient?: string;
    shipping_address?: string;
    shipping_status?: string;
    tracking_number?: string;
    shipped_at?: number | null;
    payment_method?: string;
    telegram_gift?: string | null;
    telegram_gift_unlocked?: boolean;
    id: string;
    contact: string;
    total: number;
    status: string;
    created_at: number;
    expires_at: number;
    paid_at: number | null;
    demo: number;
    payment?: PaymentInvoice | null;
    items: {
        product_name: string;
        quantity: number;
        price: number;
        product_id: string;
    }[];
    delivery?: string[];
    tickets?: Ticket[];
}
export interface Customer {
    id: string;
    email: string;
    display_name: string;
    recipient: string;
    contact: string;
    shipping_address: string;
    verified_at: number | null;
    is_demo: number;
    csrf: string;
}
export interface PaymentInvoice {
    id: string;
    order_id: string;
    address: string;
    amount: string;
    base_amount: string;
    adjustment: string;
    rate: string;
    status: string;
    created_at: number;
    pay_before: number;
    watch_until: number;
    tx_id: string | null;
    review_reason: string;
    network: 'TRON / TRC20';
}
export interface Ticket {
    id: string;
    order_id: string;
    subject: string;
    message: string;
    status: string;
    reply: string;
    created_at: number;
}
export interface Catalog {
    shippingFee?: number;
    giftAvailable?: boolean;
    paymentMethods?: {id:string;name:string;enabled:boolean;status:string}[];
    products: Product[];
    categories: Category[];
    settings: Record<string, string>;
    demo: boolean;
    paymentEnabled: boolean;
}
