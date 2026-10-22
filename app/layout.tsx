import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'品香 PINXIANG · 自助商城',description:'品香自助商城：商品自助选购，普通商品整单邮费 20 元、其他商品单独免邮，付款成功后领取赠送的 Telegram 通讯账号。',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
