<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>V2Board 运营中台</title>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, sans-serif; background: #f3f4f6; color: #111827; }
        #guestBlock { display:none; max-width:680px; margin:80px auto; padding:24px; background:#fff; border:1px solid #e5e7eb; border-radius:12px; }
        .layout { display:flex; min-height:100vh; }
        .sidebar { width:280px; flex:0 0 280px; background:#111827; color:#e5e7eb; padding:18px 14px; border-right:1px solid #1f2937; overflow-y:auto; }
        .brand { color:#fff; font-size:18px; font-weight:700; margin:0 0 14px; }
        .menu-group-title { font-size:11px; color:#9ca3af; margin:0 0 8px; letter-spacing:.4px; text-transform:uppercase; }
        .menu-list { display:flex; flex-direction:column; gap:8px; }
        .menu-btn, .sub-btn, .recent-btn {
            width:100%; text-align:left; border:1px solid #374151; background:#1f2937; color:#e5e7eb; border-radius:8px; padding:9px 10px; font-size:12px; min-height:36px; display:flex; align-items:center; cursor:pointer;
        }
        .menu-btn:hover, .sub-btn:hover, .recent-btn:hover { background:#2563eb; border-color:#2563eb; }
        .menu-btn.active, .sub-btn.active { background:#2563eb; border-color:#2563eb; color:#fff; }
        .submenu { display:none; margin:2px 0 10px 8px; padding-left:10px; border-left:1px dashed #374151; }
        .submenu.active { display:block; }
        .submenu .sub-btn { margin-top:6px; font-size:12px; background:#172033; }
        details.more { margin-top:6px; }
        details.more summary { list-style:none; cursor:pointer; color:#9ca3af; font-size:12px; }
        details.more[open] summary { color:#cbd5e1; }
        .recent-box { margin-bottom:14px; }
        .recent-btn { background:#172033; margin-top:6px; }
        .content { flex:1; padding:12px; }
        .hero { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:12px 14px; margin-bottom:10px; }
        .panel { display:none; background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:12px; }
        .panel.active { display:block; }
        iframe { width:100%; min-height:82vh; border:1px solid #d1d5db; border-radius:10px; background:#fff; }
        .marketing-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; }
        .marketing-card { border:1px dashed #cbd5e1; border-radius:10px; background:#f8fafc; padding:14px; font-size:13px; color:#475569; }
        @media (max-width: 1100px) { .layout { flex-direction:column; } .sidebar { width:100%; border-right:0; border-bottom:1px solid #1f2937; } }
    </style>
</head>
<body>
<div id="guestBlock">
    <h3>请先登录管理员后台</h3>
    <p>当前页面为 V2Board 运营中台，仅管理员可访问。</p>
    <a id="guestLoginLink" href="#">前往管理员登录</a>
</div>

<div id="content" style="display:none;" class="layout">
    <aside class="sidebar">
        <h2 class="brand">运营中台</h2>

        <div class="recent-box">
            <div class="menu-group-title">最近使用</div>
            <div id="recentList"></div>
        </div>

        <div class="menu-group-title">模块导航</div>
        <div class="menu-list">
            <button class="menu-btn" data-center="risk" onclick="switchCenter('risk')">风控中心</button>
            <div id="submenu-risk" class="submenu">
                <button class="sub-btn" title="调整风控核心阈值配置" data-key="risk:settings" data-src="/{{ $ops_path }}/risk?embedded=1&section=settings" onclick="openSub(this)">风控参数配置</button>
                <button class="sub-btn" title="管理风控规则与触发条件" data-key="risk:rules" data-src="/{{ $ops_path }}/risk?embedded=1&section=rules" onclick="openSub(this)">风控规则配置</button>
                <button class="sub-btn" title="维护风险黑名单" data-key="risk:blacklist" data-src="/{{ $ops_path }}/risk?embedded=1&section=blacklist" onclick="openSub(this)">风控黑名单</button>
                <details class="more"><summary>更多…</summary>
                    <button class="sub-btn" title="实时查看在线IP分布" data-key="risk:online" data-src="/{{ $ops_path }}/risk?embedded=1&section=online" onclick="openSub(this)">实时在线IP</button>
                    <button class="sub-btn" title="查看用户使用画像" data-key="risk:profile" data-src="/{{ $ops_path }}/risk?embedded=1&section=profile" onclick="openSub(this)">用户画像总览</button>
                </details>
            </div>

            <button class="menu-btn" data-center="client" onclick="switchCenter('client')">客户端中心</button>
            <div id="submenu-client" class="submenu">
                <button class="sub-btn" title="查看客户端策略触发总体情况" data-key="client:overview" data-src="/{{ $ops_path }}/client?embedded=1&section=client_overview" onclick="openSub(this)">客户端策略总览</button>
                <button class="sub-btn" title="编辑客户端策略细项" data-key="client:manage" data-src="/{{ $ops_path }}/client?embedded=1&section=client_manage" onclick="openSub(this)">客户端策略管理</button>
            </div>

            <button class="menu-btn" data-center="logs" onclick="switchCenter('logs')">日志中心</button>
            <div id="submenu-logs" class="submenu">
                <button class="sub-btn" title="查看用户连接行为日志" data-key="logs:connection" data-src="/{{ $ops_path }}/logs?embedded=1&section=log_connection" onclick="openSub(this)">连接日志</button>
                <button class="sub-btn" title="查看管理员/用户登录日志" data-key="logs:login" data-src="/{{ $ops_path }}/logs?embedded=1&section=log_login" onclick="openSub(this)">登录日志</button>
                <button class="sub-btn" title="查看订阅请求日志" data-key="logs:subscribe" data-src="/{{ $ops_path }}/logs?embedded=1&section=log_subscribe" onclick="openSub(this)">订阅日志</button>
                <details class="more"><summary>更多…</summary>
                    <button class="sub-btn" title="查看风控命中明细" data-key="logs:hit" data-src="/{{ $ops_path }}/logs?embedded=1&section=log_hit" onclick="openSub(this)">命中日志</button>
                </details>
            </div>

            <button class="menu-btn" data-center="i18n" onclick="switchCenter('i18n')">国际化中心</button>
            <div id="submenu-i18n" class="submenu">
                <button class="sub-btn" title="管理套餐名称与内容翻译" data-key="i18n:plan" data-src="/{{ $ops_path }}/i18n?embedded=1&tab=plan" onclick="openSub(this)">套餐翻译</button>
                <details class="more"><summary>更多…</summary>
                    <button class="sub-btn" title="管理站点文案翻译占位" data-key="i18n:copy" data-src="/{{ $ops_path }}/i18n?embedded=1&tab=copy" onclick="openSub(this)">站点文案翻译</button>
                </details>
            </div>

            <button class="menu-btn" data-center="marketing" onclick="switchCenter('marketing')">营销中心</button>
            <div id="submenu-marketing" class="submenu">
                <button class="sub-btn" title="营销邮件模块占位" data-key="marketing:mail" onclick="openMarketing(this)">营销邮件（占位）</button>
                <button class="sub-btn" title="用户积分模块占位" data-key="marketing:points" onclick="openMarketing(this)">用户积分（占位）</button>
            </div>
        </div>
    </aside>

    <main class="content">
        <div class="hero"><h2>V2Board 运营中台</h2></div>
        <section id="panel-frame" class="panel active"><iframe id="centerFrame" src=""></iframe></section>
        <section id="panel-marketing" class="panel"><div class="marketing-grid"><div class="marketing-card"><strong>营销邮件</strong>模块建设中。</div><div class="marketing-card"><strong>用户积分</strong>模块建设中。</div></div></section>
    </main>
</div>

<script>
const securePath = @json($secure_path);
const recentKey = 'ops_recent_subs';

function getAuthorization() { return localStorage.getItem('authorization') || localStorage.getItem('token') || ''; }
function verifyAdmin() {
    const token = getAuthorization();
    document.getElementById('guestLoginLink').href = `/${securePath}`;
    if (!token) { document.getElementById('guestBlock').style.display = 'block'; return false; }
    return true;
}

function saveRecent(item) {
    const list = JSON.parse(localStorage.getItem(recentKey) || '[]').filter(i => i.key !== item.key);
    list.unshift(item);
    localStorage.setItem(recentKey, JSON.stringify(list.slice(0, 5)));
    renderRecent();
}

function renderRecent() {
    const list = JSON.parse(localStorage.getItem(recentKey) || '[]');
    const box = document.getElementById('recentList');
    if (!list.length) { box.innerHTML = '<div style="font-size:12px;color:#9ca3af;">暂无</div>'; return; }
    box.innerHTML = list.map(item => `<button class="recent-btn" title="${item.tip || ''}" onclick="openRecent('${item.center}','${item.key}')">${item.label}</button>`).join('');
}

function openRecent(center, key) {
    switchCenter(center);
    const target = document.querySelector(`.sub-btn[data-key="${key}"]`);
    if (!target) return;
    if (center === 'marketing') openMarketing(target); else openSub(target);
}

function switchCenter(center) {
    document.querySelectorAll('.menu-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.center === center));
    document.querySelectorAll('.submenu').forEach(el => el.classList.remove('active'));
    const submenu = document.getElementById(`submenu-${center}`);
    if (submenu) submenu.classList.add('active');

    const firstSub = submenu ? submenu.querySelector('.sub-btn') : null;
    if (firstSub) { if (center === 'marketing') openMarketing(firstSub); else openSub(firstSub); }
}

function openSub(btn) {
    document.querySelectorAll('.sub-btn').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-marketing').classList.remove('active');
    document.getElementById('panel-frame').classList.add('active');
    document.getElementById('centerFrame').src = btn.dataset.src || '';
    saveRecent({ key: btn.dataset.key || '', center: document.querySelector('.menu-btn.active')?.dataset.center || '', label: btn.textContent.trim(), tip: btn.title || '' });
}

function openMarketing(btn) {
    document.querySelectorAll('.sub-btn').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-frame').classList.remove('active');
    document.getElementById('panel-marketing').classList.add('active');
    saveRecent({ key: btn.dataset.key || '', center: 'marketing', label: btn.textContent.trim(), tip: btn.title || '' });
}

(function init() {
    if (!verifyAdmin()) return;
    document.getElementById('content').style.display = 'flex';
    renderRecent();
    switchCenter('risk');
})();
</script>
</body>
</html>
