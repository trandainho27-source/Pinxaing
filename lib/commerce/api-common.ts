import type { RuntimeEnv, Staff } from './types.ts';
import {uid,randomToken,sha,safeEqual} from './security.ts';
class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}
function fail(status: number, message: string): never {
    throw new ApiError(status, message);
}
const now = () => Date.now();
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const str = (v: unknown, max = 500) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const integer = (v: unknown, min: number, max: number) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
        fail(400, '数字超出允许范围');
    return v as number;
};
async function body(request: Request): Promise<Record<string, any>> {
    const raw = await request.text();
    if (raw.length > 150000)
        fail(413, '提交内容过大');
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return fail(400, '提交格式无效');
        return parsed as Record<string, any>;
    }
    catch {
        fail(400, '提交格式无效');
    }
}
function database(env: RuntimeEnv) {
    if (!env.DB)
        fail(503, '数据库未配置，请完成 Cloudflare 部署');
    return env.DB!;
}
const stmt = (db: D1Database, sql: string, ...values: any[]) => db.prepare(sql).bind(...values);
async function all<T = any>(db: D1Database, sql: string, ...values: any[]) {
    return (await stmt(db, sql, ...values).all<T>()).results;
}
async function first<T = any>(db: D1Database, sql: string, ...values: any[]) {
    return stmt(db, sql, ...values).first<T>();
}
function audit(db: D1Database, actor: string, action: string, target: string, detail = '') {
    return stmt(db, 'INSERT INTO audits VALUES(?,?,?,?,?,?)', uid(), actor, action, target, detail, now());
}
async function limit(db: D1Database, request: Request, action: string, max: number) {
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    const bucket = Math.floor(now() / 60000);
    const key = await sha(`${action}:${ip}:${bucket}`);
    const result = await stmt(db, 'INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count', key, now() + 120000).first<{
        count: number;
    }>();
    if (result!.count > max)
        fail(429, '操作太频繁，请稍后再试');
}
async function authenticated(db: D1Database, request: Request, roles?: string[]) {
    const token = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('px_session='))?.slice(11);
    if (!token)
        fail(401, '请先登录管理后台');
    const person = await first<Staff>(db, 'SELECT s.id,s.username,s.role,s.active,x.csrf FROM sessions x JOIN staff s ON x.staff_id=s.id WHERE x.hash=? AND x.expires_at>? AND s.active=1', await sha(token!), now());
    if (!person)
        fail(401, '登录已过期，请重新登录');
    if (roles && !roles.includes(person!.role))
        fail(403, '当前账号没有该操作权限');
    if (request.method !== 'GET' && !safeEqual(request.headers.get('x-csrf-token') || '', person!.csrf!))
        fail(403, '安全校验失败，请刷新后重试');
    return person!;
}
async function loginSession(db: D1Database, id: string) {
    const token = randomToken(), csrf = randomToken();
    await stmt(db, 'INSERT INTO sessions VALUES(?,?,?,?)', await sha(token), id, csrf, now() + 8 * 3600000).run();
    return json({ ok: true, csrf }, 200, { 'Set-Cookie': `px_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800` });
}

export {ApiError,fail,now,json,str,integer,body,database,stmt,all,first,audit,limit,authenticated,loginSession};
