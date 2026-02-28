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
        #guestBlock h3 { margin-top:0; }
        #guestBlock p { color:#6b7280; line-height:1.7; }
        #guestBlock a { display:inline-block; margin-top:8px; color:#2563eb; }

        .layout { display:flex; min-height:100vh; }
        .sidebar {
            width:240px;
            flex:0 0 240px;
            background:#111827;
            color:#e5e7eb;
            padding:20px 16px;
            border-right:1px solid #1f2937;
        }
        .brand { color:#fff; font-size:18px; font-weight:700; margin:0 0 14px; }
        .menu-group-title { font-size:11px; color:#9ca3af; margin:0 0 8px; letter-spacing:.4px; text-transform:uppercase; }
        .menu-list { display:flex; flex-direction:column; gap:8px; }
        .menu-btn {
            width:100%;
            text-align:left;
            border:1px solid #374151;
            background:#1f2937;
            color:#e5e7eb;
            border-radius:8px;
            padding:9px 10px;
            font-size:12px;
            line-height:1.2;
            height:36px;
            display:flex;
            align-items:center;
            cursor:pointer;
        }
        .menu-btn:hover { background:#2563eb; border-color:#2563eb; }
        .menu-btn.active { background:#2563eb; border-color:#2563eb; color:#fff; }

        .content { flex:1; padding:12px; }
        .hero { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:12px 14px; margin-bottom:10px; }
        .hero h2 { margin:0; font-size:20px; }

        .panel { display:none; background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:12px; }
        .panel.active { display:block; }
        iframe { width:100%; min-height:82vh; border:1px solid #d1d5db; border-radius:10px; background:#fff; }

        .marketing-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; }
        .marketing-card { border:1px dashed #cbd5e1; border-radius:10px; background:#f8fafc; padding:14px; font-size:13px; color:#475569; }
        .marketing-card strong { display:block; color:#1f2937; margin-bottom:6px; }

        @media (max-width: 1100px) {
            .layout { flex-direction:column; }
            .sidebar { width:100%; border-right:0; border-bottom:1px solid #1f2937; }
        }
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
        <div class="menu-group-title">模块导航</div>
        <div class="menu-list">
            <button class="menu-btn active" data-tab="risk" onclick="switchTab('risk')">风控中心</button>
            <button class="menu-btn" data-tab="client" onclick="switchTab('client')">客户端中心</button>
            <button class="menu-btn" data-tab="logs" onclick="switchTab('logs')">日志中心</button>
            <button class="menu-btn" data-tab="i18n" onclick="switchTab('i18n')">国际化中心</button>
            <button class="menu-btn" data-tab="marketing" onclick="switchTab('marketing')">营销中心</button>
        </div>
    </aside>

    <main class="content">
        <div class="hero"><h2>V2Board 运营中台</h2></div>

        <section id="panel-risk" class="panel active">
            <iframe src="/{{ $ops_path }}/risk?embedded=1"></iframe>
        </section>

        <section id="panel-client" class="panel">
            <iframe src="/{{ $ops_path }}/client?embedded=1"></iframe>
        </section>

        <section id="panel-logs" class="panel">
            <iframe src="/{{ $ops_path }}/logs?embedded=1"></iframe>
        </section>

        <section id="panel-i18n" class="panel">
            <iframe src="/{{ $ops_path }}/i18n?embedded=1"></iframe>
        </section>

        <section id="panel-marketing" class="panel">
            <div class="marketing-grid">
                <div class="marketing-card"><strong>营销邮件</strong>模块建设中。</div>
                <div class="marketing-card"><strong>用户积分</strong>模块建设中。</div>
            </div>
        </section>
    </main>
</div>

<script>
const securePath = @json($secure_path);

function getAuthorization() {
    const fromAuthorization = localStorage.getItem('authorization');
    if (fromAuthorization) return fromAuthorization;
    const fromToken = localStorage.getItem('token');
    if (fromToken) return fromToken;
    return '';
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

function switchTab(tab) {
    document.querySelectorAll('.menu-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    document.querySelectorAll('.panel').forEach(panel => panel.classList.remove('active'));
    const target = document.getElementById(`panel-${tab}`);
    if (target) target.classList.add('active');
}

(function init() {
    if (!verifyAdmin()) return;
    document.getElementById('content').style.display = 'flex';
})();
</script>
</body>
</html>
