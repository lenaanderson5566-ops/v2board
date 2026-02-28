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

        .page { width: calc(100vw - 24px); max-width: 100%; margin: 12px auto; padding: 0 8px 12px; }
        .hero { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; }
        .hero h2 { margin: 0 0 6px; font-size: 22px; }
        .hero p { margin: 0; color: #6b7280; font-size: 13px; }

        .tabs { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; position: sticky; top: 0; background: #f3f4f6; padding: 6px 0; z-index: 2; }
        .tab-btn { border: 1px solid #d1d5db; background: #fff; color: #374151; border-radius: 8px; padding: 8px 12px; cursor: pointer; }
        .tab-btn.active { background: #eff6ff; color: #1d4ed8; border-color: #93c5fd; }

        .panel { display: none; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; }
        .panel.active { display: block; }

        .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }
        .card { border:1px solid #e5e7eb; border-radius:10px; padding:14px; background:#fafafa; cursor:pointer; }
        .card:hover { border-color:#93c5fd; background:#f8fbff; }
        .card h3 { margin:0 0 8px; font-size:16px; }
        .card p { margin:0; color:#6b7280; font-size:12px; line-height:1.6; }

        iframe { width: 100%; min-height: 82vh; border: 1px solid #d1d5db; border-radius: 10px; background: #fff; }

        .placeholder { border:1px dashed #cbd5e1; border-radius:10px; background:#f8fafc; padding:16px; color:#475569; }
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
        <div class="hero">
            <h2>V2Board 运营中台</h2>
            <p>统一整合风控、国际化与运营扩展能力（营销邮件、用户积分）。</p>
        </div>

        <div class="tabs">
            <button class="tab-btn active" data-tab="overview" onclick="switchTab('overview')">总览</button>
            <button class="tab-btn" data-tab="risk" onclick="switchTab('risk')">风控中心</button>
            <button class="tab-btn" data-tab="i18n" onclick="switchTab('i18n')">国际化中心</button>
            <button class="tab-btn" data-tab="mail" onclick="switchTab('mail')">营销邮件</button>
            <button class="tab-btn" data-tab="points" onclick="switchTab('points')">用户积分</button>
        </div>

        <section id="panel-overview" class="panel active">
            <div class="grid">
                <div class="card" onclick="switchTab('risk')">
                    <h3>风控中心</h3>
                    <p>风险规则、审计日志、客户端策略等安全能力。</p>
                </div>
                <div class="card" onclick="switchTab('i18n')">
                    <h3>国际化中心</h3>
                    <p>站点国际化管理，套餐翻译作为子功能统一维护。</p>
                </div>
                <div class="card" onclick="switchTab('mail')">
                    <h3>营销邮件</h3>
                    <p>占位：活动触达、邮件模板、发送分群。</p>
                </div>
                <div class="card" onclick="switchTab('points')">
                    <h3>用户积分</h3>
                    <p>占位：积分规则、账本、兑换活动。</p>
                </div>
            </div>
        </section>

        <section id="panel-risk" class="panel">
            <iframe id="riskFrame" src="/{{ $ops_path }}/risk-control"></iframe>
        </section>

        <section id="panel-i18n" class="panel">
            <iframe id="i18nFrame" src="/{{ $ops_path }}/i18n"></iframe>
        </section>

        <section id="panel-mail" class="panel">
            <h3>营销邮件（占位）</h3>
            <div class="placeholder">后续将在此集成营销邮件活动配置、模板管理、分群发送与数据回流看板。</div>
        </section>

        <section id="panel-points" class="panel">
            <h3>用户积分（占位）</h3>
            <div class="placeholder">后续将在此集成积分发放规则、积分流水、兑换与风控联动能力。</div>
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
