import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'品享 PINXIANG · 数字商品商城',description:'品享数字商品商城：数字资源、软件授权、订阅服务与技术支持。',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
