<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>V2Board 管理补充中心</title>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, sans-serif; background: #f3f4f6; color: #111827; }
        .layout { display: flex; min-height: 100vh; }
        .sidebar { width: 240px; background: #111827; color: #e5e7eb; padding: 16px; }
        .sidebar h2 { margin: 0 0 8px; font-size: 18px; color: #fff; }
        .sidebar p { margin: 0 0 14px; font-size: 12px; color: #9ca3af; }
        .menu { display: flex; flex-direction: column; gap: 8px; }
        .menu button { border: 1px solid #374151; background: #1f2937; color: #e5e7eb; border-radius: 8px; padding: 9px 10px; text-align: left; cursor: pointer; }
        .menu button.active, .menu button:hover { background: #2563eb; border-color: #2563eb; }
        .main { flex: 1; display: flex; flex-direction: column; }
        .header { background: #fff; border-bottom: 1px solid #e5e7eb; padding: 12px 16px; }
        .header h3 { margin: 0; font-size: 18px; }
        .header p { margin: 4px 0 0; color: #6b7280; font-size: 12px; }
        .frame-wrap { flex: 1; padding: 12px; }
        iframe { width: 100%; height: calc(100vh - 92px); border: 1px solid #d1d5db; border-radius: 10px; background: #fff; }
        #guestBlock { display:none; max-width:680px; margin:80px auto; padding:24px; background:#fff; border:1px solid #e5e7eb; border-radius:12px; }
        #guestBlock h3 { margin-top:0; }
        #guestBlock p { color:#6b7280; line-height:1.7; }
        #guestBlock a { display:inline-block; margin-top:8px; color:#2563eb; }
    </style>
</head>
<body>
<div id="guestBlock">
    <h3>请先登录管理员后台</h3>
    <p>当前页面为 V2Board 管理补充中心（风控后台 + 国际化设置），仅管理员可访问。</p>
    <a id="guestLoginLink" href="#">前往管理员登录</a>
</div>

<div class="layout" id="layout" style="display:none;">
    <aside class="sidebar">
        <h2>管理补充中心</h2>
        <p>V2Board Admin Extension</p>
    </aside>
    <main class="main">
        <div class="header">
            <h3>管理补充中心</h3>
            <p>统一入口，点击进入具体模块。</p>
        </div>
        <div class="frame-wrap">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;">
                <button onclick="openModule('risk-control')" style="text-align:left;padding:14px;border:1px solid #d1d5db;border-radius:10px;background:#fff;cursor:pointer;">
                    <div style="font-weight:700;margin-bottom:6px;">风控后台</div>
                    <div style="color:#6b7280;font-size:12px;">用于风控规则、订阅行为和连接日志分析。</div>
                </button>
                <button onclick="openModule('plan-i18n')" style="text-align:left;padding:14px;border:1px solid #d1d5db;border-radius:10px;background:#fff;cursor:pointer;">
                    <div style="font-weight:700;margin-bottom:6px;">套餐国际化设置</div>
                    <div style="color:#6b7280;font-size:12px;">配置套餐名称与内容的多语言翻译。</div>
                </button>
            </div>
        </div>
    </main>
</div>

<script>
const securePath = @json($secure_path);
const adminExtensionPath = @json($admin_extension_path);
const modules = {
    'risk-control': {
        title: '风控后台',
        desc: '用于风控规则、订阅行为和连接日志分析。',
        path: `/${adminExtensionPath}/risk-control`
    },
    'plan-i18n': {
        title: '套餐国际化设置',
        desc: '配置套餐名称与内容的多语言翻译。',
        path: `/${adminExtensionPath}/plan-i18n`
    }
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
    const item = modules[key];
    if (!item) return;
    const auth = encodeURIComponent(getAuthorization());
    const url = auth ? `${item.path}?auth_data=${auth}` : item.path;
    window.location.href = url;
}

function verifyAdmin() {
    const token = getAuthorization();
    const loginUrl = `/${securePath}`;
    const loginLink = document.getElementById('guestLoginLink');
    loginLink.href = loginUrl;

    if (!token) {
        document.getElementById('guestBlock').style.display = 'block';
        return false;
    }

    return true;
}

(async function init() {
    const ok = verifyAdmin();
    if (!ok) return;

    document.getElementById('layout').style.display = 'flex';
})();
</script>
</body>
</html>
