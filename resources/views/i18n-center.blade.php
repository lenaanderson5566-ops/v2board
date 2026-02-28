<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>国际化模块</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 24px; color: #1f2937; background: #f9fafb; }
        .layout { display: grid; grid-template-columns: 220px 1fr; gap: 14px; }
        .nav, .panel { background:#fff; border:1px solid #e5e7eb; border-radius: 10px; padding: 14px; }
        .nav button { width:100%; text-align:left; margin-bottom:8px; padding:8px 10px; border:1px solid #d1d5db; border-radius:8px; background:#fff; cursor:pointer; }
        .nav button.active { border-color:#2563eb; background:#eff6ff; color:#1d4ed8; }
        .row { display:flex; gap:12px; margin-bottom:12px; align-items:center; }
        select, input, textarea, button { padding: 8px; font-size: 14px; }
        textarea { width: 100%; min-height: 120px; }
        .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-top: 12px; }
        .muted { color: #6b7280; font-size: 12px; }
        .ok { color: #059669; }
        .err { color: #dc2626; }
    </style>
</head>
<body>
<div id="guestBlock" style="display:none;max-width:680px;margin:40px auto;padding:24px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;">
    <h3 style="margin-top:0;">请先登录管理员后台</h3>
    <p style="color:#6b7280;line-height:1.7;">当前页面为国际化模块，仅管理员可访问。</p>
    <a id="guestLoginLink" href="#" style="color:#2563eb;">前往管理员登录</a>
</div>

<div id="contentArea" style="display:none;">
    <h2>国际化模块</h2>
    <p class="muted">国际化模块包含多个子功能，当前已支持：套餐翻译。</p>
    <div class="layout">
        <div class="nav">
            <button id="tab-plan" class="active" onclick="switchTab('plan')">套餐翻译</button>
            <button id="tab-copy" onclick="switchTab('copy')">站点文案翻译（占位）</button>
        </div>
        <div class="panel">
            <div id="panel-plan">
                <div class="row">
                    <label>套餐:</label>
                    <select id="plan"></select>
                    <label>语言:</label>
                    <select id="locale"></select>
                    <button onclick="loadTranslation()">加载</button>
                </div>

                <div class="card">
                    <div><strong>默认名称</strong></div>
                    <div id="defaultName" class="muted"></div>
                    <div style="margin-top:10px"><strong>翻译名称</strong></div>
                    <input id="name" style="width:100%" placeholder="请输入该语言的套餐名称" />

                    <div style="margin-top:10px"><strong>默认内容</strong></div>
                    <div id="defaultContent" class="muted"></div>
                    <div style="margin-top:10px"><strong>翻译内容</strong></div>
                    <textarea id="content_text" placeholder="请输入该语言的套餐内容"></textarea>

                    <div class="row" style="margin-top:10px">
                        <button onclick="saveTranslation()">保存翻译</button>
                        <button onclick="clearTranslation()">清空该语言翻译</button>
                        <span id="status" class="muted"></span>
                    </div>
                </div>
            </div>
            <div id="panel-copy" style="display:none;">
                <div class="card">
                    <strong>站点文案翻译（占位）</strong>
                    <p class="muted" style="margin-top:8px;">预留给后续站点 UI 文案、邮件模板文案的集中翻译管理。</p>
                </div>
            </div>
        </div>
    </div>
</div>
<script>
const securePath = @json($secure_path);
const apiPrefix = `/api/v1/${securePath}`;

function switchTab(tab) {
    document.getElementById('tab-plan').classList.toggle('active', tab === 'plan');
    document.getElementById('tab-copy').classList.toggle('active', tab === 'copy');
    document.getElementById('panel-plan').style.display = tab === 'plan' ? 'block' : 'none';
    document.getElementById('panel-copy').style.display = tab === 'copy' ? 'block' : 'none';
}

function getAuthorization() {
    const fromAuthorization = window.localStorage.getItem('authorization');
    if (fromAuthorization) return fromAuthorization;

    const fromToken = window.localStorage.getItem('token');
    if (fromToken) return fromToken;

    return '';
}

async function api(url, method = 'GET', body = null) {
    const token = getAuthorization();
    const headers = {
        'Authorization': token,
        'Content-Type': 'application/json'
    };
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : null });
    const json = await res.json();
    if (!res.ok || (json && json.message)) throw new Error((json && json.message) || `HTTP ${res.status}`);
    return json.data;
}

function verifyAdmin() {
    const token = getAuthorization();
    const loginUrl = `/${securePath}`;
    document.getElementById('guestLoginLink').href = loginUrl;
    if (!token) {
        document.getElementById('guestBlock').style.display = 'block';
        return false;
    }
    return true;
}

async function init() {
    const ok = verifyAdmin();
    if (!ok) return;
    document.getElementById('contentArea').style.display = 'block';
    const [plans, locales] = await Promise.all([
        api(`${apiPrefix}/plan/fetch`),
        api(`${apiPrefix}/ops/i18n/plan/locales`)
    ]);

    document.getElementById('plan').innerHTML = plans.map(p => `<option value="${p.id}">${p.id} - ${escapeHtml(p.name)}</option>`).join('');
    document.getElementById('locale').innerHTML = locales.map(l => `<option value="${l}">${l}</option>`).join('');
    if (plans.length && locales.length) await loadTranslation();
}

function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

async function loadTranslation() {
    try {
        const planId = parseInt(document.getElementById('plan').value, 10);
        const locale = document.getElementById('locale').value;
        const data = await api(`${apiPrefix}/ops/i18n/plan/fetch?plan_id=${planId}`);
        const row = data.translations[locale] || {};
        document.getElementById('defaultName').textContent = data.default.name || '';
        document.getElementById('defaultContent').textContent = data.default.content || '';
        document.getElementById('name').value = row.name || '';
        document.getElementById('content_text').value = row.content || '';
        setStatus('已加载', 'ok');
    } catch (e) {
        setStatus(e.message, 'err');
    }
}

async function saveTranslation() {
    try {
        const plan_id = parseInt(document.getElementById('plan').value, 10);
        const locale = document.getElementById('locale').value;
        const name = document.getElementById('name').value;
        const content = document.getElementById('content_text').value;
        await api(`${apiPrefix}/ops/i18n/plan/save`, 'POST', { plan_id, locale, name, content });
        setStatus('保存成功', 'ok');
    } catch (e) {
        setStatus(e.message, 'err');
    }
}

async function clearTranslation() {
    document.getElementById('name').value = '';
    document.getElementById('content_text').value = '';
    await saveTranslation();
}

function setStatus(text, cls) {
    const node = document.getElementById('status');
    node.textContent = text;
    node.className = `muted ${cls}`;
}

init().catch((e) => setStatus(e.message, 'err'));
</script>
</body>
</html>
