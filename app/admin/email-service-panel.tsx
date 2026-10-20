'use client';
import {useState} from 'react';
import {Mail, RefreshCw, ArrowUpRight} from 'lucide-react';
import type {EmailConfiguration} from '@/lib/commerce/email-configuration';

export default function EmailServicePanel({configuration, checkedAt, demo, refresh}: {
    configuration?: EmailConfiguration; checkedAt?: number; demo?: boolean; refresh: () => Promise<void>;
}) {
    const [checking, setChecking] = useState(false);
    if (!configuration) return <section className="panel email-service-panel">正在读取邮箱服务状态…</section>;
    return <section className="panel email-service-panel">
        <div className="panel-title"><h3><Mail size={19}/>邮箱注册与登录</h3><button className="secondary" disabled={checking} onClick={async () => {setChecking(true); try {await refresh();} finally {setChecking(false);}}}><RefreshCw size={15}/>{checking ? '正在检测…' : '重新检测'}</button></div>
        <p className={configuration.ready ? 'success-text' : 'error-text'} role="status">{configuration.ready ? '运行时配置齐全，可进行收信与登录验收。' : '邮箱登录尚不可用，请完成下方标出的配置。'}</p>
        <p className="hint">{demo ? '当前为演示环境。正式域名使用独立的 Worker 配置。' : '当前为正式环境。'}检测读取正在运行的服务，密钥内容不会显示。</p>
        <div className="email-service-checks">{configuration.checks.map(check => <div className="email-service-check" key={check.name}>
            <div><code>{check.name}</code><span className={'tag '+(check.status === 'configured' ? 'muted' : 'email-check-issue')}>{({configured: '已设置', missing: '未设置', invalid: '格式不正确'})[check.status]}</span></div>
            <p>{check.help}</p>
        </div>)}</div>
        <p className="hint">在 Cloudflare 保存变量并部署后，点击「重新检测」。配置齐全仅代表可发起请求，仍需实际收信并登录才能确认邮件服务可用。</p>
        <div className="email-service-actions"><a className="secondary" href="/account" target="_blank" rel="noreferrer">打开邮箱登录页验收 <ArrowUpRight size={15}/></a>{checkedAt && <small>检测时间：{new Date(checkedAt).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false})}</small>}</div>
    </section>;
}
