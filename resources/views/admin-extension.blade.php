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

        .page { width: calc(100vw - 24px); margin: 12px auto; padding: 0 8px 12px; }
        .hero { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:12px 14px; margin-bottom:10px; }
        .hero h2 { margin:0; font-size:20px; }

        .tabs { display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:8px; position:sticky; top:0; z-index:2; background:#f3f4f6; padding:6px 0 10px; }
        .tab-btn { border:1px solid #d1d5db; background:#fff; color:#374151; border-radius:10px; padding:10px 12px; cursor:pointer; font-size:13px; text-align:center; height:40px; font-weight:600; }
        .tab-btn.active { background:#eff6ff; color:#1d4ed8; border-color:#93c5fd; box-shadow: inset 0 0 0 1px #bfdbfe; }
        @media (max-width: 980px) { .tabs { grid-template-columns:repeat(2, minmax(0, 1fr)); } }

        .panel { display:none; background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:12px; }
        .panel.active { display:block; }
        iframe { width:100%; min-height:82vh; border:1px solid #d1d5db; border-radius:10px; background:#fff; }

        .marketing-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; }
        .marketing-card { border:1px dashed #cbd5e1; border-radius:10px; background:#f8fafc; padding:14px; font-size:13px; color:#475569; }
        .marketing-card strong { display:block; color:#1f2937; margin-bottom:6px; }
    </style>
</head>
<body>
<div id="guestBlock">
    <h3>请先登录管理员后台</h3>
    <p>当前页面为 V2Board 运营中台，仅管理员可访问。</p>
    <a id="guestLoginLink" href="#">前往管理员登录</a>
</div>

<div id="content" style="display:none;">
    <div class="page">
        <div class="hero"><h2>V2Board 运营中台</h2></div>

        <div class="tabs">
            <button class="tab-btn active" data-tab="risk" onclick="switchTab('risk')">风控中心</button>
            <button class="tab-btn" data-tab="client" onclick="switchTab('client')">客户端中心</button>
            <button class="tab-btn" data-tab="logs" onclick="switchTab('logs')">日志中心</button>
            <button class="tab-btn" data-tab="i18n" onclick="switchTab('i18n')">国际化中心</button>
            <button class="tab-btn" data-tab="marketing" onclick="switchTab('marketing')">营销中心</button>
        </div>

        <section id="panel-risk" class="panel active">
            <iframe src="/{{ $ops_path }}/risk"></iframe>
        </section>

        <section id="panel-client" class="panel">
            <iframe src="/{{ $ops_path }}/client"></iframe>
        </section>

        <section id="panel-logs" class="panel">
            <iframe src="/{{ $ops_path }}/logs"></iframe>
        </section>

        <section id="panel-i18n" class="panel">
            <iframe src="/{{ $ops_path }}/i18n"></iframe>
        </section>

        <section id="panel-marketing" class="panel">
            <div class="marketing-grid">
                <div class="marketing-card"><strong>营销邮件</strong>模块建设中。</div>
                <div class="marketing-card"><strong>用户积分</strong>模块建设中。</div>
            </div>
        </section>
    </div>
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
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    document.querySelectorAll('.panel').forEach(panel => panel.classList.remove('active'));
    const target = document.getElementById(`panel-${tab}`);
    if (target) target.classList.add('active');
}

(function init() {
    if (!verifyAdmin()) return;
    document.getElementById('content').style.display = 'block';
})();
</script>
</body>
</html>
