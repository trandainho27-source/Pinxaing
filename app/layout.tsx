import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'品享 PINXIANG · 实体好物商城',description:'品享实体好物商城：日常好物自助选购，每单固定邮费 20 元，下单赠送 Telegram 通讯账号。',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
