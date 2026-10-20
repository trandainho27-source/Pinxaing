'use client';
import {useState} from 'react';
import {KeyRound, Copy, RefreshCw, Eye, EyeOff} from 'lucide-react';

export default function BootstrapGuide({configured,legacyDemo,token,setToken,refresh}: {
    configured:boolean;legacyDemo:boolean;token:string;setToken:(value:string)=>void;refresh:()=>Promise<void>;
}) {
    const [notice,setNotice]=useState(''),[checking,setChecking]=useState(false),[visible,setVisible]=useState(false);
    function generate(){setToken(Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join(''));setNotice('令牌已在本机生成。复制后填入 Cloudflare，保存并部署；它尚未自动配置到服务器。');}
    async function copy(){try{await navigator.clipboard.writeText(token);setNotice('已复制。请在 Cloudflare 中将它保存为 BOOTSTRAP_TOKEN，然后部署。');}catch{setVisible(true);setNotice('自动复制失败，请手动选择并复制下方令牌。');}}
    return <section className="bootstrap-guide" aria-label="首次开通后台">
        <h2><KeyRound size={18}/>首次开通后台</h2>
        <p>无需已有的网站账号。先在 Cloudflare 设置开通令牌，再创建你自己的店主账号。</p>
        {legacyDemo&&<p className="info-box">检测到此前的演示管理员，可继续创建正式店主。成功后旧演示会话失效，现有业务记录保留。</p>}
        <ol><li>生成并保存下方令牌，或填入你已设置的令牌。</li><li>在 Cloudflare 打开 <strong>pinxiang-commerce → 设置 → 变量和机密 → 添加</strong>，类型选 <strong>Secret</strong>，名称填 <code>BOOTSTRAP_TOKEN</code>，值填同一令牌，然后点击<strong>部署</strong>。</li><li>回到这里点击「重新检测」，再填写下方账号和密码。</li></ol>
        <div className="bootstrap-tools"><button type="button" className="secondary" onClick={generate}>生成令牌</button><button type="button" className="secondary" disabled={!token} onClick={copy}><Copy size={14}/>复制令牌</button><a className="secondary" href="https://dash.cloudflare.com/" target="_blank" rel="noreferrer">打开 Cloudflare</a></div>
        <label>初始化令牌<div className="bootstrap-token"><input required type={visible?'text':'password'} maxLength={128} autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} placeholder="生成令牌，或粘贴 Cloudflare 中设置的值"/><button type="button" className="icon-button" aria-label={visible?'隐藏令牌':'显示令牌'} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={16}/>:<Eye size={16}/>}</button></div></label>
        {notice&&<p className="hint" role="status">{notice}</p>}
        <div className="bootstrap-check"><span className={configured?'success-text':'error-text'} role="status">{configured?'已检测到服务器初始化令牌':'服务器尚未设置有效的初始化令牌'}</span><button type="button" className="text-button" disabled={checking} onClick={async()=>{setChecking(true);try{await refresh();}finally{setChecking(false);}}}><RefreshCw size={14}/>{checking?'检测中…':'重新检测'}</button></div>
        <p className="hint">请自行保存令牌，不要发给客服。成功创建店主后，可在 Cloudflare 删除 BOOTSTRAP_TOKEN；以后使用账号和密码登录。</p>
    </section>;
}
