// Synthetic read responses shared by menu regression tests and local visual fixtures.
export function adminPageFixture(path: string) {
    let data: unknown = [];
    if (path.includes("config/fetch")) data = {
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
