import countries from "../../../../resources/client/node-countries.json";
import locations from "../../../../resources/client/node-locations.json";
// Synthetic read responses shared by menu regression tests and local visual fixtures.
export function adminPageFixture(path: string) {
    let data: unknown = [];
    if (path.includes("system/observability")) data = {stale:false,snapshot:{checkedAt:1792454400,health:{checks:[{key:"database",label:"数据库",status:"healthy",message:"数据库连接正常"}]},queue:{available:true,failedJobs:0,items:[{name:"default",length:0,wait:0,processes:2}]}},alerts:[],settings:{sample_percent:10,slow_request_ms:2000,slow_query_ms:200,error_percent:5,slow_percent:20,min_samples:20,queue_length:100,queue_wait_seconds:60,failed_jobs:1},metrics:{total:{samples:125,averageMs:180,p95UpperMs:500,errors:0,slowRequests:1,slowQueries:2},routes:[{route:"GET api/v10/subscriptions/{subscriptionToken}",samples:125,errors:0,averageMs:180,p95UpperMs:500,slowQueries:2,maxQueryMs:250}],dropped:0},assets:{modes:[{mode:"user",startupGzipBytes:274673,totalBytes:2829678,fileCount:314}],warnings:[]}};
    else if (path.includes("dictionary/clients")) data = {version:0,items:[{code:"flclash",name:"FlClash",defaultName:"FlClash",builtinAliases:["FlClash"],aliases:[],priority:100},{code:"sing-box",name:"sing-box",defaultName:"sing-box",builtinAliases:["sing-box","singbox","Hiddify"],aliases:[],priority:100}]};
    else if (path.includes("dictionary/fetch")) data = {catalog:{...locations,regions:countries},defaults:{regions:countries,cities:locations.cities},versions:{},overrides:{},languages:Object.keys(countries.US)};
    else if (path.includes("config/fetch")) data = {
        site: { app_name: "界面验证站点", app_description: "测试说明", app_url: "https://example.com" },
        safe: { browser_policy_wechat: "prompt", browser_policy_weibo: "guide" },
        app: { fastai_enabled: 1, fastai_releases: [] },
        invite: {}, subscribe: {}, email: {}, server: {}, telegram: {}
    };
    else if (path.includes("me/security/passkeys")) data = {enabled:false,credentials:[]};
    else if (path.includes("Schema")) data = {};
    else if (path.includes("analytics/report")) data = {
        settings: { enabled: false, sampleRate: 100, retentionDays: 30 }, ready: true,
        timeZone: "Asia/Shanghai", from: "2026-10-01", to: "2026-10-19", effectiveFrom: "2026-10-01", latestEventAt: null, collectionStartedAt: null,
        sessions: 0, views: 0, daily: [], pages: [], devices: [], funnel: [], previous: null,
        cohort: { from: "2026-10-01", to: "2026-10-19", windowDays: 7, registered: 0, ordered: 0, paid: 0, completed: 0 }
    };
    else if (path.includes("analytics/settings")) data = {settings:{enabled:false,sampleRate:100,retentionDays:30},ready:true};
    else if (/getOverride|getSystemStatus|risk\/summary|logRetention|mfa\/status|passkey\/status/.test(path)) data = {};
    return { data, total: 0 };
}
