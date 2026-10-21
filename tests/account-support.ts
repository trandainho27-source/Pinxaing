import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleApi } from '../lib/commerce/api.ts';
class Query {
    constructor(public database: DatabaseSync, public sql: string, public values: any[] = []) {
    }
    bind(...values: any[]) {
        return new Query(this.database, this.sql, values);
    }
    async first() {
        return this.database.prepare(this.sql).get(...this.values) || null;
    }
    async all() {
        return { results: this.database.prepare(this.sql).all(...this.values) };
    }
    async run() {
        const r = this.database.prepare(this.sql).run(...this.values);
        return { success: true, meta: { changes: Number(r.changes) } };
    }
    execute() {
        const statement = this.database.prepare(this.sql);
        if (statement.columns().length) {
            const results = statement.all(...this.values);
            return { results, meta: { changes: Number(this.database.prepare('SELECT changes() AS n').get()!.n) } };
        }
        const result = statement.run(...this.values);
        return { results: [], meta: { changes: Number(result.changes) } };
    }
}
export class DB {
    raw = new DatabaseSync(':memory:');
    constructor(migrationCount=Infinity) {
        this.raw.exec('PRAGMA foreign_keys=ON');
        for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort().slice(0,migrationCount))
            this.raw.exec(readFileSync('drizzle/' + file, 'utf8'));
    }
    prepare(sql: string) {
        return new Query(this.raw, sql);
    }
    async batch(queries: Query[]) {
        this.raw.exec('BEGIN');
        try {
            const results = queries.map(q => q.execute());
            this.raw.exec('COMMIT');
            return results;
        }
        catch (e) {
            this.raw.exec('ROLLBACK');
            throw e;
        }
    }
}

export function client(env:any) {
 const cookies=new Map<string,string>();let staffCsrf='',customerCsrf='';
 return async(path:string,b?:any,extra:Record<string,string>={})=>{
  const method=b===undefined?'GET':'POST';
  const r=await handleApi(new Request('https://store.test/api/'+path,{method,headers:{origin:'https://store.test',...(b===undefined?{}:{'content-type':'application/json'}),cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'x-csrf-token':path.startsWith('admin/')||path.startsWith('auth/')?staffCsrf:customerCsrf,...extra},...(b===undefined?{}:{body:b instanceof Uint8Array?new Uint8Array(b).buffer:JSON.stringify(b)})}),env);
  const d=await r.json() as any,header=r.headers.get('set-cookie');
  if(header){const [key,value]=header.split(';')[0].split('=');cookies.set(key,value);if(d.csrf){if(key==='px_customer')customerCsrf=d.csrf;else staffCsrf=d.csrf;}}
  return {r,d};
 };
}
export async function fixture(){const db=new DB(),env:any={DB:db,DEMO_MODE:'true',INVENTORY_KEY:'c'.repeat(64)},guest=client(env),admin=client(env),catalog=(await guest('catalog')).d;await admin('auth/demo',{});return {db,env,guest,admin,p:catalog.products[0],catalog};}
export async function login(c:ReturnType<typeof client>){const ch=(await c('customer/email/demo',{})).d;const result=await c('customer/email/verify',{challenge_id:ch.challenge_id,code:ch.demo_code});if(result.r.status!==200)throw Error(JSON.stringify(result.d));return (await c('customer/session')).d.customer;}
export const cart=(id:string,extra:any={})=>({acceptedTerms:true,items:[{id,quantity:1}],...extra});
export const row=(s:any,sql:string,...args:any[])=>s.db.raw.prepare(sql).get(...args) as any;
export const shipping={recipient:'测试客户',contact:'test-contact',shipping_address:'仅供测试的收货地址'};
