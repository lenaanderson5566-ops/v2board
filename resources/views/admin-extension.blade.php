<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>V2Board 运营中心</title>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, sans-serif; background: #f3f4f6; color: #111827; }
        .wrap { max-width: 980px; margin: 28px auto; padding: 0 16px; }
        .hero { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:16px; margin-bottom:12px; }
        .hero h2 { margin:0 0 6px; }
        .hero p { margin:0; color:#6b7280; font-size:13px; }
        .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }
        .card { background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:14px; cursor:pointer; text-align:left; }
        .card:hover { border-color:#93c5fd; background:#f8fbff; }
        .card h3 { margin:0 0 8px; font-size:16px; }
        .card p { margin:0; color:#6b7280; font-size:12px; line-height:1.6; }
        #guestBlock { display:none; max-width:680px; margin:80px auto; padding:24px; background:#fff; border:1px solid #e5e7eb; border-radius:12px; }
        #guestBlock h3 { margin-top:0; }
        #guestBlock p { color:#6b7280; line-height:1.7; }
        #guestBlock a { display:inline-block; margin-top:8px; color:#2563eb; }
    </style>
</head>
<body>
<div id="guestBlock">
    <h3>请先登录管理员后台</h3>
    <p>当前页面为 V2Board 运营中心，仅管理员可访问。</p>
    <a id="guestLoginLink" href="#">前往管理员登录</a>
</div>

<div id="content" style="display:none;">
    <div class="wrap">
        <div class="hero">
            <h2>V2Board 运营中心</h2>
            <p>统一整合风控、国际化及运营扩展能力。</p>
        </div>
        <div class="grid">
            <button class="card" onclick="openModule('risk-control')">
                <h3>风控模块</h3>
                <p>风控规则、日志检索、策略管理。</p>
            </button>
            <button class="card" onclick="openModule('i18n')">
                <h3>国际化模块</h3>
                <p>站点国际化能力管理（含套餐翻译）。</p>
            </button>
            <button class="card" onclick="openModule('marketing-email')">
                <h3>营销邮件模块</h3>
                <p>占位：后续用于活动邮件与自动化触达。</p>
            </button>
            <button class="card" onclick="openModule('user-points')">
                <h3>用户积分模块</h3>
                <p>占位：后续用于积分规则、兑换与账本。</p>
            </button>
        </div>
    </div>
</div>

<script>
const securePath = @json($secure_path);
const opsPath = @json($ops_path);
const modules = {
    'risk-control': `/${opsPath}/risk-control`,
    'i18n': `/${opsPath}/i18n`,
    'marketing-email': `/${opsPath}/marketing-email`,
    'user-points': `/${opsPath}/user-points`,
};

function getAuthorization() {
    const fromAuthorization = localStorage.getItem('authorization');
    if (fromAuthorization) return fromAuthorization;

    const fromToken = localStorage.getItem('token');
    if (fromToken) return fromToken;

    const fromQuery = new URLSearchParams(window.location.search).get('auth_data');
    if (fromQuery) {
        localStorage.setItem('authorization', fromQuery);
        return fromQuery;
    }

    return '';
}

function openModule(key) {
    const path = modules[key];
    if (!path) return;
    const auth = encodeURIComponent(getAuthorization());
    const url = auth ? `${path}?auth_data=${auth}` : path;
    window.location.href = url;
}

function verifyAdmin() {
    const token = getAuthorization();
    document.getElementById('guestLoginLink').href = `/${securePath}`;
    if (!token) {
        document.getElementById('guestBlock').style.display = 'block';
        return false;
    }
    return true;
}

(function init() {
    if (!verifyAdmin()) return;
    document.getElementById('content').style.display = 'block';
})();
</script>
</body>
</html>
