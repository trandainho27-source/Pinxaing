import type {RuntimeEnv} from './types.ts';

export type EmailConfiguration = {
    ready: boolean;
    checks: {name: 'RESEND_API_KEY' | 'EMAIL_FROM' | 'INVENTORY_KEY'; status: 'configured' | 'missing' | 'invalid'; help: string}[];
};

function senderValid(value: string) {
    if (/[\r\n]/.test(value)) return false;
    const trimmed = value.trim();
    const mailbox = trimmed.includes('<') ? trimmed.match(/^[^<>]+<([^<>]+)>$/)?.[1].trim() : trimmed;
    return !!mailbox && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(mailbox);
}

// Return only configuration checks. Never include secret values in diagnostics.
export function emailConfiguration(env: RuntimeEnv): EmailConfiguration {
    const state = (value: unknown, valid: (value: string) => boolean) =>
        value === undefined || value === null || value === '' ? 'missing' as const :
        typeof value === 'string' && valid(value) ? 'configured' as const : 'invalid' as const;
    const checks: EmailConfiguration['checks'] = [
        {name: 'RESEND_API_KEY', status: state(env.RESEND_API_KEY, value => value.length > 0 && !/\s/.test(value)), help: '在当前 Worker 的「设置 → 变量和机密」中添加 Secret，填入 Resend 发送密钥。构建变量和 Cloudflare 构建 API 令牌不能替代它。'},
        {name: 'EMAIL_FROM', status: state(env.EMAIL_FROM, senderValid), help: '运行时变量填写：品香 <login@auth.pinxiang.lol>。对应的 auth.pinxiang.lol 必须在 Resend 中完成域名验证。'},
        {name: 'INVENTORY_KEY', status: state(env.INVENTORY_KEY, value => /^[a-f0-9]{64}$/i.test(value)), help: '使用本项目原有的 64 位十六进制加密密钥，不能有空格或引号。已导入赠送账号时，请恢复原密钥，不要重新生成替换。'},
    ];
    return {ready: checks.every(check => check.status === 'configured'), checks};
}
