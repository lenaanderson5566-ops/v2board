<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>国际化中心</title>
    <style>
        :root {
            --bg: #f6f8fb;
            --card: #ffffff;
            --text: #1f2937;
            --muted: #6b7280;
            --border: #e5e7eb;
            --primary: #2563eb;
        }
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; margin: 0; background: var(--bg); color: var(--text); min-height: 100%; }

        .layout { display: flex; min-height: 100vh; }
        .sidebar {
            width: 240px;
            flex: 0 0 240px;
            background: #111827;
            color: #e5e7eb;
            padding: 20px 16px;
            border-right: 1px solid #1f2937;
        }
        .menu-group-title { font-size:11px; color:#9ca3af; margin:0 0 8px; letter-spacing:.4px; text-transform:uppercase; }
        .menu-list { display: flex; flex-direction: column; gap: 8px; }
        .menu-btn {
            width: 100%;
            text-align: left;
            border: 1px solid #374151;
            background: #1f2937;
            color: #e5e7eb;
            border-radius: 8px;
            padding: 9px 10px;
            font-size: 12px;
            line-height: 1.2;
            height: 36px;
            display: flex;
            align-items: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: pointer;
        }
        .menu-btn:hover { background: #2563eb; border-color: #2563eb; }
        .menu-btn.active { background: #2563eb; border-color: #2563eb; color: #fff; }

        .content { flex: 1; padding: 16px; }
        .container { max-width: 1480px; margin: 0 auto; }
        .header { margin-bottom: 14px; }
        .title { margin: 0; font-size: 24px; }

        .panel { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 14px; min-height: 360px; }
        .row { display:flex; gap:12px; margin-bottom:12px; align-items:center; flex-wrap: wrap; }
        select, input, textarea, button { padding: 8px; font-size: 14px; border:1px solid #d1d5db; border-radius:8px; }
        button { background:#fff; cursor:pointer; }
        button:hover { border-color:#93c5fd; }
        textarea { width: 100%; min-height: 120px; }
        .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-top: 12px; }
        .table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        .table th, .table td { border: 1px solid #e5e7eb; padding: 8px; font-size: 12px; text-align: left; }
        .table th { background: #f9fafb; }
        .muted { color: var(--muted); font-size: 12px; }
        .ok { color: #059669; }
        .err { color: #dc2626; }
        .locale-picker { max-height: 130px; overflow:auto; border:1px solid #e5e7eb; border-radius:8px; padding:8px; background:#fafafa; }
        .locale-tag { display:inline-flex; align-items:center; gap:4px; margin:4px 8px 4px 0; font-size:12px; }

        .layout.embedded .content { padding: 0; }
        .layout.embedded .container { max-width: none; }

        @media (max-width: 1100px) {
            .layout { flex-direction: column; }
            .sidebar { width: 100%; border-right: 0; border-bottom: 1px solid #1f2937; }
        }
    </style>
</head>
<body>
@php($embedded = request()->boolean('embedded'))
<div id="guestBlock" style="display:none;max-width:680px;margin:40px auto;padding:24px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;">
    <h3 style="margin-top:0;">请先登录管理员后台</h3>
    <p style="color:#6b7280;line-height:1.7;">当前页面为国际化中心，仅管理员可访问。</p>
    <a id="guestLoginLink" href="#" style="color:#2563eb;">前往管理员登录</a>
</div>

<div id="contentArea" style="display:none;" class="layout{{ $embedded ? ' embedded' : '' }}">
    @unless($embedded)
    <aside class="sidebar">
        <div class="menu-group-title">国际化中心</div>
        <div class="menu-list">
            <button id="tab-plan" class="menu-btn active" onclick="switchTab('plan')">套餐翻译</button>
            <button id="tab-currency" class="menu-btn" onclick="switchTab('currency')">汇率与币种设置</button>
            <button id="tab-copy" class="menu-btn" onclick="switchTab('copy')">站点文案翻译（占位）</button>
        </div>
    </aside>
    @endunless

    <main class="content">
        <div class="container">
            <div class="header">
                <h2 class="title">国际化中心</h2>
            </div>

            <div class="panel">
                <div id="panel-plan">
                    <div class="row">
                        <label>套餐:</label>
                        <select id="plan"></select>
                        <label>语言:</label>
                        <select id="locale"></select>
                        <button onclick="prevLocale()">上一语言</button>
                        <button onclick="nextLocale()">下一语言</button>
                        <button onclick="loadTranslation()">加载</button>
                    </div>
                    <div class="card" style="margin-top:0;">
                        <div class="row" style="margin-bottom:8px;">
                            <strong>可编辑语言（勾选后出现在下拉）</strong>
                            <button onclick="setLocalePreset('recommended')">推荐语言</button>
                            <button onclick="setLocalePreset('all')">全选</button>
                            <button onclick="setLocalePreset('none')">清空</button>
                        </div>
                        <div id="localePicker" class="locale-picker"></div>
                    </div>

                    <div class="card">
                        <div><strong>默认名称</strong></div>
                        <div id="defaultName" class="muted"></div>
                        <div style="margin-top:10px" class="row"><strong>翻译名称</strong><button onclick="copyDefaultName()">复制默认名称</button></div>
                        <input id="name" style="width:100%" placeholder="请输入该语言的套餐名称" />

                        <div style="margin-top:10px"><strong>默认内容</strong></div>
                        <div id="defaultContent" class="muted"></div>
                        <div style="margin-top:10px" class="row"><strong>翻译内容</strong><button onclick="copyDefaultContent()">复制默认内容</button></div>
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

                <div id="panel-currency" style="display:none;">
                    <div class="card">
                        <strong>业务基准币种与汇率源</strong>
                        <div class="row" style="margin-top:10px;">
                            <label>业务基准币种:</label>
                            <input id="business_base_currency" placeholder="例如 CNY / USD" style="width:140px; text-transform:uppercase;" />
                            <label>汇率API:</label>
                            <input id="currency_rate_api" placeholder="https://open.er-api.com/v6/latest/{base}" style="width:420px;" />
                            <button onclick="saveCurrencySettings()">保存设置</button>
                            <button onclick="syncCurrencyRates()">立即同步汇率</button>
                        </div>
                        <div id="currency_status" class="muted"></div>
                    </div>

                    <div class="card">
                        <strong>支付网关币种设置</strong>
                        <table class="table" id="payment_table">
                            <thead>
                            <tr>
                                <th>ID</th>
                                <th>名称</th>
                                <th>网关</th>
                                <th>支付币种</th>
                                <th>操作</th>
                            </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>

                    <div class="card">
                        <strong>最新汇率列表（相对基准币）</strong>
                        <div class="muted" id="latest_fetched_at" style="margin-top:8px;"></div>
                        <table class="table" id="rate_table">
                            <thead>
                            <tr>
                                <th>币种</th>
                                <th>1该币种=基准币</th>
                                <th>更新时间</th>
                            </tr>
                            </thead>
                            <tbody></tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    </main>
</div>

<script>
const securePath = @json($secure_path);
const apiPrefix = `/api/v1/${securePath}`;
let allLocales = [];
let recommendedLocales = [];

function switchTab(tab) {
    const tabPlan = document.getElementById('tab-plan');
    const tabCurrency = document.getElementById('tab-currency');
    const tabCopy = document.getElementById('tab-copy');
    if (tabPlan) tabPlan.classList.toggle('active', tab === 'plan');
    if (tabCurrency) tabCurrency.classList.toggle('active', tab === 'currency');
    if (tabCopy) tabCopy.classList.toggle('active', tab === 'copy');
    document.getElementById('panel-plan').style.display = tab === 'plan' ? 'block' : 'none';
    document.getElementById('panel-currency').style.display = tab === 'currency' ? 'block' : 'none';
    document.getElementById('panel-copy').style.display = tab === 'copy' ? 'block' : 'none';
    if (tab === 'currency') {
        loadCurrencyCenter();
    }
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
    document.getElementById('contentArea').style.display = 'flex';

    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'copy') {
        switchTab('copy');
        return;
    }
    if (tab === 'currency') {
        switchTab('currency');
        await loadCurrencyCenter();
        return;
    }

    const [plans, localeMeta] = await Promise.all([
        api(`${apiPrefix}/plan/fetch`),
        api(`${apiPrefix}/ops/i18n/plan/locales`)
    ]);
    allLocales = localeMeta.all || [];
    recommendedLocales = localeMeta.recommended || [];
    document.getElementById('plan').innerHTML = plans.map(p => `<option value="${p.id}">${p.id} - ${escapeHtml(p.name)}</option>`).join('');
    renderLocalePicker();
    setLocalePreset('recommended');
    switchTab('plan');
    if (plans.length && allLocales.length) await loadTranslation();
}



function renderLocalePicker() {
    const node = document.getElementById('localePicker');
    node.innerHTML = (allLocales || []).map((l) => `
        <label class="locale-tag">
            <input type="checkbox" class="locale-checkbox" value="${escapeHtml(l)}" />
            <span>${escapeHtml(l)}</span>
        </label>
    `).join('');

    node.querySelectorAll('.locale-checkbox').forEach((checkbox) => {
        checkbox.addEventListener('change', refreshLocaleSelectFromPicker);
    });
}

function refreshLocaleSelectFromPicker(preferredLocale = '') {
    const checked = Array.from(document.querySelectorAll('.locale-checkbox:checked')).map((n) => n.value);
    const localeSelect = document.getElementById('locale');
    localeSelect.innerHTML = checked.map((l) => `<option value="${l}">${l}</option>`).join('');
    if (!checked.length) {
        setStatus('请至少勾选一种语言', 'err');
        return;
    }
    if (preferredLocale && checked.includes(preferredLocale)) {
        localeSelect.value = preferredLocale;
    }
}

function setLocalePreset(mode) {
    const checkedSet = new Set(mode === 'all' ? allLocales : (mode === 'recommended' ? recommendedLocales : []));
    document.querySelectorAll('.locale-checkbox').forEach((checkbox) => {
        checkbox.checked = checkedSet.has(checkbox.value);
    });
    refreshLocaleSelectFromPicker();
}

function prevLocale() {
    const localeSelect = document.getElementById('locale');
    if (!localeSelect.options.length) return;
    const idx = Math.max(0, localeSelect.selectedIndex - 1);
    localeSelect.selectedIndex = idx;
    loadTranslation();
}

function nextLocale() {
    const localeSelect = document.getElementById('locale');
    if (!localeSelect.options.length) return;
    const idx = Math.min(localeSelect.options.length - 1, localeSelect.selectedIndex + 1);
    localeSelect.selectedIndex = idx;
    loadTranslation();
}

function copyDefaultName() {
    document.getElementById('name').value = document.getElementById('defaultName').textContent || '';
}

function copyDefaultContent() {
    document.getElementById('content_text').value = document.getElementById('defaultContent').textContent || '';
}

function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

async function loadTranslation() {
    try {
        const planId = parseInt(document.getElementById('plan').value, 10);
        const locale = document.getElementById('locale').value;
        if (!locale) {
            setStatus('请先勾选语言', 'err');
            return;
        }
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
        if (!locale) {
            setStatus('请先勾选语言', 'err');
            return;
        }
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

function setCurrencyStatus(text, cls) {
    const node = document.getElementById('currency_status');
    node.textContent = text;
    node.className = `muted ${cls}`;
}

function formatTimestamp(ts) {
    if (!ts) return '-';
    try {
        return new Date(ts * 1000).toLocaleString();
    } catch (e) {
        return String(ts);
    }
}

async function loadCurrencyCenter() {
    try {
        const data = await api(`${apiPrefix}/ops/i18n/currency/fetch`);
        document.getElementById('business_base_currency').value = data.business_base_currency || 'CNY';
        document.getElementById('currency_rate_api').value = data.currency_rate_api || '';
        document.getElementById('latest_fetched_at').textContent = `最后同步时间：${formatTimestamp(data.latest_fetched_at)}`;

        const paymentTbody = document.querySelector('#payment_table tbody');
        paymentTbody.innerHTML = (data.payments || []).map((p) => `
            <tr>
                <td>${p.id}</td>
                <td>${escapeHtml(p.name || '')}</td>
                <td>${escapeHtml(p.payment || '')}</td>
                <td>
                    <input id="pay_currency_${p.id}" value="${escapeHtml((p.currency || 'CNY').toUpperCase())}" style="width:90px;text-transform:uppercase;" />
                </td>
                <td><button onclick="savePaymentCurrency(${p.id})">保存</button></td>
            </tr>
        `).join('');

        const rateTbody = document.querySelector('#rate_table tbody');
        rateTbody.innerHTML = (data.rates || []).map((r) => `
            <tr>
                <td>${escapeHtml(r.quote_currency || '')}</td>
                <td>${r.rate_to_base ?? '-'}</td>
                <td>${formatTimestamp(r.fetched_at)}</td>
            </tr>
        `).join('');
        setCurrencyStatus('已加载汇率与币种设置', 'ok');
    } catch (e) {
        setCurrencyStatus('汇率与支付币种设置里显示遇到一些问题，我们正在处理', 'err');
    }
}

async function saveCurrencySettings() {
    try {
        const business_base_currency = (document.getElementById('business_base_currency').value || '').trim().toUpperCase();
        const currency_rate_api = (document.getElementById('currency_rate_api').value || '').trim();
        await api(`${apiPrefix}/ops/i18n/currency/settings/save`, 'POST', { business_base_currency, currency_rate_api });
        setCurrencyStatus('设置保存成功', 'ok');
        await loadCurrencyCenter();
    } catch (e) {
        setCurrencyStatus('汇率与支付币种设置里显示遇到一些问题，我们正在处理', 'err');
    }
}

async function syncCurrencyRates() {
    try {
        const data = await api(`${apiPrefix}/ops/i18n/currency/sync`, 'POST', {});
        if (data === false) {
            setCurrencyStatus('拉取失败，已使用上次有效汇率', 'err');
        } else {
            setCurrencyStatus('汇率同步成功', 'ok');
        }
        await loadCurrencyCenter();
    } catch (e) {
        setCurrencyStatus('汇率与支付币种设置里显示遇到一些问题，我们正在处理', 'err');
    }
}

async function savePaymentCurrency(id) {
    try {
        const currency = (document.getElementById(`pay_currency_${id}`).value || '').trim().toUpperCase();
        await api(`${apiPrefix}/ops/i18n/currency/payment/set`, 'POST', { id, currency });
        setCurrencyStatus(`支付网关 #${id} 币种保存成功`, 'ok');
    } catch (e) {
        setCurrencyStatus('汇率与支付币种设置里显示遇到一些问题，我们正在处理', 'err');
    }
}

init().catch((e) => setStatus(e.message, 'err'));
</script>
</body>
</html>
