import definitions from './v10-contracts.json';

type Fields = Record<string, string[]>;
type Contract = { input: Record<string,string>; output: string; bindings: Record<string,string>; path:string; method:string; key:string };
const contracts = definitions.endpoints as Record<string,Contract>;
const schemas = definitions.schemas as Record<string,Fields>;
const routes = definitions.routes as Record<string,string>;
const periods: Record<string,string> = {month_price:'monthly',quarter_price:'quarterly',half_year_price:'semiannual',year_price:'annual',two_year_price:'biennial',three_year_price:'triennial',onetime_price:'credits',reset_price:'reset',deposit:'deposit'};
const statuses = ['unpaid','processing','cancelled','completed','discounted'];
export type { V10Problem, V10Pagination, V10Envelope, V10Authentication } from './v10-types';

// Existing components keep their view models; the wire contract is explicitly mapped here.
export function v10Request(path: string, body?: Record<string,any>) {
    const [base,search] = path.split('?');
    const methodRoutes = definitions.methodRoutes as Record<string,string>;
    const id = methodRoutes[`${body ? 'POST' : 'GET'} ${base}`] ?? routes[base];
    if (!id) throw new Error(`User API has no V10 contract: ${base}`);
    const source = {...Object.fromEntries(new URLSearchParams(search)),...body};
    const details=definitions.details as Record<string,string>;
    const contract = contracts[source.id != null && details[base] ? details[base] : id];
    const input: Record<string,any> = {};
    for (const [publicName,internalName] of Object.entries(contract.input)) {
        const value = source[internalName] ?? (internalName === 'page_size' ? source.pageSize : undefined);
        if (value !== undefined) input[publicName] = value;
    }
    if (input.billingPeriod) input.billingPeriod = periods[input.billingPeriod];
    if (input.status != null) input.status = statuses[Number(input.status)];
    if (input.priority != null) input.priority = ['normal','high','urgent'][Number(input.priority)];
    let resource = contract.path;
    for (const [parameter,internal] of Object.entries(contract.bindings)) {
        const value = source[internal];
        if (value == null) throw new Error(`Missing resource identifier: ${parameter}`);
        resource = resource.replace(`{${parameter}}`, encodeURIComponent(String(value)));
    }
    const query = new URLSearchParams();
    if (contract.method === 'GET') for (const [name,value] of Object.entries(input)) if (value != null) query.set(name,String(value));
    return {url:`/api/v10/${resource}${query.size ? '?'+query : ''}`,method:contract.method,body:contract.method === 'GET' ? undefined : JSON.stringify(input),decode:(payload:any)=>decodeEnvelope(contract,payload)};
}
function decodeEnvelope(contract:Contract,payload:any) {
    const result:any = {data:decode(contract.output,payload.data)};
    if (contract.output === 'payment') {
        result.type = ({confirmed:-1,qr:0,redirect:1,pending:2} as Record<string,number>)[payload.data.kind];
        result.data=payload.data.value;
    }
    if (payload.meta) result.meta=payload.meta;
    if (payload.meta?.pagination) {
        result.total=payload.meta.pagination.total;
        if (contract.output === 'inbox') result.data.total=result.total;
    }
    return result;
}
function decode(name:string,value:any):any {
    if (value == null) return value;
    if (name === 'authentication') return {auth_data:value.accessToken,is_admin:value.account.administrator};
    if (name === 'orderCreated') return value.orderNumber;
    if (name === 'orderStatus') return statuses.indexOf(value.status);
    if (name === 'summary') return [value.pendingOrders,value.pendingTickets,value.referrals];
    if (name === 'referrals') return {rewards:value.rewards,stat:[value.registeredUsers,value.earnedCommission,value.pendingCommission,value.commissionRate,value.availableCommission]};
    if (name === 'inbox') return {...value,items:decode('array:notification',value.items)};
    if (name === 'articles') return value.id ? decode('article',value) : Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode('array:article',v)]));
    if (name.includes(':')) {
        const [kind,child]=name.split(':');
        if (kind === 'flex') return Array.isArray(value) ? decode(`array:${child}`,value) : decode(child,value);
        return kind === 'dictionary' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(child,v)])) : value.map((v:any)=>decode(child,v));
    }
    if (!schemas[name]) return value;
    const out:Record<string,any>={};
    for (const [external,[internal,type,child]] of Object.entries(schemas[name])) {
        if (!(external in value)) continue;
        let v=value[external];
        if (type === 'time') v=v ? Math.floor(Date.parse(v)/1000) : null;
        else if (type === 'boolean') v=['auto_renewal','remind_expire','remind_traffic','banned','is_admin','is_online','is_read','is_telegram','withdraw_close','commission_distribution_enable','renew','is_email_verify','is_invite_force','is_recaptcha'].includes(internal) ? (v ? 1 : 0) : v;
        else if (type === 'gb') v=Number(v)/1073741824;
        else if (type === 'period') v=Object.keys(periods).find(k=>periods[k]===v);
        else if (type === 'orderStatus') v=statuses.indexOf(v);
        else if (type === 'orderKind') v=({new:1,renewal:2,switch:3,reset:4} as Record<string,number>)[v] || 0;
        else if (type === 'ticketStatus') v=v === 'closed' ? 1 : 0;
        else if (type === 'priority') v=['normal','high','urgent'].indexOf(v);
        else if (type === 'couponType') v=v === 'percentage' ? 2 : 1;
        else if (type === 'replyStatus') v=v === 'awaiting-user' ? 1 : 0;
        else if (type === 'object') v=decode(child,v);
        else if (type === 'array') v=decode(`array:${child}`,v);
        out[internal]=v;
    }
    return out;
}
