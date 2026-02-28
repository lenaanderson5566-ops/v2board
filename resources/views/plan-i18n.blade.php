<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>套餐国际化管理</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 24px; color: #1f2937; }
        .row { display: flex; gap: 12px; margin-bottom: 12px; align-items: center; }
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
    <p style="color:#6b7280;line-height:1.7;">当前页面为套餐国际化设置，仅管理员可访问。</p>
    <a id="guestLoginLink" href="#" style="color:#2563eb;">前往管理员登录</a>
</div>

<div id="content" style="display:none;">
<h2>套餐国际化管理（名称/内容）</h2>
<p class="muted">复用管理员 API。请先在当前浏览器登录后台后再使用（默认读取 localStorage.token）。</p>

<div class="row">
    <label>Token:</label>
    <input id="token" style="min-width:420px" />
</div>
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
    <input id="name" style="width:100%" />

    <div style="margin-top:10px"><strong>默认内容</strong></div>
    <div id="defaultContent" class="muted"></div>
    <div style="margin-top:10px"><strong>翻译内容</strong></div>
    <textarea id="content"></textarea>

    <div class="row" style="margin-top:10px">
        <button onclick="saveTranslation()">保存翻译</button>
        <button onclick="clearTranslation()">清空该语言翻译</button>
        <span id="status" class="muted"></span>
    </div>
</div>
</div>

<script>
const securePath = @json($secure_path);
const apiPrefix = `/api/v1/${securePath}`;

function getAuthorization() {
    const custom = document.getElementById('token').value.trim();
    if (custom) return custom;

    const fromAuthorization = window.localStorage.getItem('authorization');
    if (fromAuthorization) return fromAuthorization;

    const fromToken = window.localStorage.getItem('token');
    if (fromToken) return fromToken;

    const fromQuery = new URLSearchParams(window.location.search).get('auth_data');
    if (fromQuery) {
        window.localStorage.setItem('authorization', fromQuery);
        return fromQuery;
    }

    return '';
}

async function api(url, method = 'GET', body = null) {
    const token = getAuthorization();
    const headers = {
        'Authorization': token,
        'Content-Type': 'application/json'
    };
    const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null
    });
    const json = await res.json();
    if (!res.ok || (json && json.message)) {
        throw new Error((json && json.message) || `HTTP ${res.status}`);
    }
    return json.data;
}


async function verifyAdmin() {
    const token = getAuthorization();
    const loginUrl = `/${securePath}`;
    const loginLink = document.getElementById('guestLoginLink');
    loginLink.href = loginUrl;

    if (!token) {
        document.getElementById('guestBlock').style.display = 'block';
        return false;
    }

    try {
        const res = await fetch(`/api/v1/${securePath}/stat/getStat`, {
            headers: { Authorization: token }
        });
        if (!res.ok) return false;
        const json = await res.json();
        return !!(json && json.data);
    } catch (e) {
        return false;
    }
}

async function init() {
    const ok = await verifyAdmin();
    if (!ok) {
        document.getElementById('guestBlock').style.display = 'block';
        return;
    }

    document.getElementById('content').style.display = 'block';
    document.getElementById('token').value = window.localStorage.getItem('authorization') || window.localStorage.getItem('token') || '';
    const [plans, locales] = await Promise.all([
        api(`${apiPrefix}/plan/fetch`),
        api(`${apiPrefix}/plan/i18n/locales`)
    ]);

    const planSelect = document.getElementById('plan');
    planSelect.innerHTML = plans.map(p => `<option value="${p.id}">${p.id} - ${escapeHtml(p.name)}</option>`).join('');

    const localeSelect = document.getElementById('locale');
    localeSelect.innerHTML = locales.map(l => `<option value="${l}">${l}</option>`).join('');

    if (plans.length && locales.length) {
        await loadTranslation();
    }
}

function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

async function loadTranslation() {
    try {
        const planId = parseInt(document.getElementById('plan').value, 10);
        const locale = document.getElementById('locale').value;
        const data = await api(`${apiPrefix}/plan/i18n/fetch?plan_id=${planId}`);
        const row = data.translations[locale] || {};

        document.getElementById('defaultName').textContent = data.default.name || '';
        document.getElementById('defaultContent').textContent = data.default.content || '';
        document.getElementById('name').value = row.name || '';
        document.getElementById('content').value = row.content || '';
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
        const content = document.getElementById('content').value;
        await api(`${apiPrefix}/plan/i18n/save`, 'POST', { plan_id, locale, name, content });
        setStatus('保存成功', 'ok');
    } catch (e) {
        setStatus(e.message, 'err');
    }
}

async function clearTranslation() {
    document.getElementById('name').value = '';
    document.getElementById('content').value = '';
    await saveTranslation();
}

function setStatus(text, cls) {
    const node = document.getElementById('status');
    node.textContent = text;
    node.className = cls;
}

init().catch((e) => setStatus(e.message, 'err'));
</script>
</body>
</html>
