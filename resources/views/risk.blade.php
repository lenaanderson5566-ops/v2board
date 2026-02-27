<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $title }} - Risk Control</title>
    <style>
        :root {
            --bg: #f6f8fb;
            --card: #ffffff;
            --text: #1f2937;
            --muted: #6b7280;
            --border: #e5e7eb;
            --primary: #2563eb;
            --primary-soft: #eff6ff;
            --success: #16a34a;
            --danger: #dc2626;
        }
        * { box-sizing: border-box; }
        html { height: 100%; overflow-y: scroll; }
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
        .sidebar h3 { margin: 0 0 8px; font-size: 18px; color: #fff; }
        .sidebar p { margin: 0 0 16px; color: #9ca3af; font-size: 12px; }
        .menu-section { margin-bottom: 18px; }
        .menu-title { font-size: 11px; color: #9ca3af; margin-bottom: 8px; text-transform: uppercase; letter-spacing: .4px; }
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
            min-height: 36px;
            max-height: 36px;
            display: flex;
            align-items: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-weight: 400;
            cursor: pointer;
        }
        .menu-btn:hover { background: #2563eb; border-color: #2563eb; }
        .menu-btn.active { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 400; }

        .content { flex: 1; padding: 16px; }
        .container { max-width: 1680px; margin: 0 auto; }
        .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
        .title { margin: 0; font-size: 24px; }
        .subtitle { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
        .status { padding: 10px 12px; border-radius: 8px; font-size: 13px; border: 1px solid var(--border); background: var(--card); margin-bottom: 14px; }
        .status.ok { color: var(--success); border-color: #bbf7d0; background: #f0fdf4; }
        .status.warn { color: var(--danger); border-color: #fecaca; background: #fef2f2; }

        button {
            padding: 7px 12px;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: #fff;
            color: var(--text);
            cursor: pointer;
            font-size: 12px;
        }
        button:hover { border-color: #bfdbfe; background: var(--primary-soft); }

        .result-panel { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 14px; min-height: 360px; }
        .cards { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 12px; margin-top: 12px; }
        .card { border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: #fafafa; }
        .card .label { color: var(--muted); font-size: 12px; }
        .card .value { font-size: 18px; font-weight: bold; margin-top: 6px; }

        table { width: 100%; border-collapse: collapse; margin-top: 12px; background: #fff; }
        th, td { border: 1px solid var(--border); padding: 8px; text-align: left; font-size: 12px; vertical-align: top; }
        th { background: #f9fafb; position: sticky; top: 0; }
        .table-wrap { max-height: 78vh; overflow: auto; border: 1px solid var(--border); border-radius: 8px; }
        .pager { display: flex; gap: 8px; align-items: center; margin: 10px 0 2px; }
        .pager .muted { color: #6b7280; font-size: 12px; }

        .rule-input, .rule-select, .rule-textarea { width: 100%; box-sizing: border-box; font-size: 12px; border: 1px solid var(--border); border-radius: 6px; padding: 6px; }
        .rule-textarea { min-height: 72px; }

        @media (max-width: 1100px) {
            .layout { flex-direction: column; }
            .sidebar { width: 100%; border-right: 0; border-bottom: 1px solid #1f2937; }
            .cards { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
        }
    </style>
</head>
<body>
<div id="guestBlock" style="display:none;max-width:680px;margin:80px auto;padding:24px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;">
    <h3 style="margin-top:0;">请先登录管理员后台</h3>
    <p style="color:#6b7280;line-height:1.7;">当前页面为风控后台，仅管理员可访问。检测到未登录状态，已隐藏全部风控数据界面。</p>
    <a id="guestLoginLink" href="#" style="display:inline-block;margin-top:8px;padding:8px 12px;border:1px solid #2563eb;border-radius:8px;color:#2563eb;text-decoration:none;">前往登录</a>
</div>
<div class="layout">
    <aside class="sidebar">
        <h3>Risk Console</h3>
        <p>风控后台导航</p>

        <div class="menu-section">
            <div class="menu-title">控制台</div>
            <div class="menu-list">
                <button class="menu-btn" onclick="fetchOverview(this)">运营总览</button>
                <button class="menu-btn" onclick="fetchRiskSettings(this)">风控后台配置</button>
            </div>
        </div>

        <div class="menu-section">
            <div class="menu-title">用户行为</div>
            <div class="menu-list">
                <button class="menu-btn" onclick="fetchOnlineUsers(this)">实时在线IP</button>
                <button class="menu-btn" onclick="fetchUserUsage(this)">用户画像总览</button>
                <button class="menu-btn" onclick="fetchUserConnectionLogs(this)">连接历史</button>
                <button class="menu-btn" onclick="fetchLoginLogs(this)">登录记录</button>
                <button class="menu-btn" onclick="fetchSubscribeLogs(this)">订阅记录</button>
            </div>
        </div>

        <div class="menu-section">
            <div class="menu-title">风控规则</div>
            <div class="menu-list">
                <button class="menu-btn" onclick="fetchRules(this)">规则配置</button>
                <button class="menu-btn" onclick="fetchRuleHits(this)">命中记录</button>
                <button class="menu-btn" onclick="fetchBlacklists(this)">黑名单管理</button>
            </div>
        </div>

        <div class="menu-section">
            <div class="menu-title">客户端策略</div>
            <div class="menu-list">
                <button class="menu-btn" onclick="fetchClientStrategyOverview(this)">客户端策略总览</button>
                <button class="menu-btn" onclick="fetchClientStrategies(this)">客户端策略管理</button>
            </div>
        </div>
    </aside>

    <main class="content">
        <div class="container">
            <div class="header">
                <div>
                    <h2 class="title">Risk Control Console</h2>
                    <p class="subtitle">风控总览、日志检索、规则管理与策略中心</p>
                </div>
            </div>

            <div id="authState" class="status"></div>
            <div id="viewTitle" style="font-size:13px;color:#6b7280;margin-bottom:10px;">当前模块：运营总览</div>
            <div id="result" class="result-panel"></div>
        </div>
    </main>
</div>

<script>
const apiBase = '/api/v1/{{ $api_path }}';
const adminPath = '/{{ config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key')))) }}';

function getAuthorization() {
  const fromStorage = window.localStorage.getItem('authorization');
  if (fromStorage) return fromStorage;

  const fromQuery = new URLSearchParams(window.location.search).get('auth_data');
  if (fromQuery) {
    window.localStorage.setItem('authorization', fromQuery);
    return fromQuery;
  }

  return '';
}

const authorization = getAuthorization();
let currentRuleRows = [];
const authStateEl = document.getElementById('authState');
const guestBlockEl = document.getElementById('guestBlock');
const layoutEl = document.querySelector('.layout');
document.getElementById('guestLoginLink').setAttribute('href', adminPath);
if (authorization) {
  authStateEl.className = 'status ok';
  authStateEl.textContent = '已自动读取后台登录态（authorization），可直接查询风控信息。';
  guestBlockEl.style.display = 'none';
  layoutEl.style.display = 'flex';
} else {
  guestBlockEl.style.display = 'block';
  layoutEl.style.display = 'none';
}

function buildTable(rows, options = {}) {
  if (!rows || !rows.length) {
    return '<p style="color:#6b7280;">暂无数据</p>';
  }
  const alias = {
    id: '编号',
    user_id: '用户ID',
    email: '邮箱',
    ip: 'IP地址',
    node: '节点',
    source: '来源',
    status: '状态',
    type: '类型',
    value: '值',
    remark: '备注',
    ua_raw: '原始UA',
    user_agent: '用户代理',
    client_type: '客户端标识',
    is_enabled: '是否启用',
    created_at: '创建时间',
    updated_at: '更新时间',
    hit_at: '触发时间',
    online_at: '在线时间',
    connected_at: '连接时间',
    register_at: '注册时间',
    last_subscribe_at: '上次订阅时间',
    last_subscribe_ip: '上次订阅IP',
    last_subscribe_ua: '上次订阅UA',
    last_online_at: '上次在线时间',
    last_online_ip: '上次在线IP',
    last_online_node: '上次在线节点',
    last_login_at: '上次登录时间',
    last_login_ip: '上次登录IP',
    subscription_plan: '订阅计划',
    group_name: '权限组',
    recharge_total: '累计充值',
    balance: '余额',
    expired_at: '到期时间',
    alive_count: '在线连接数',
    online_ip: '在线IP',
    country: '国家',
    region: '省/州',
    city: '城市',
    asn: 'ASN',
    isp: '运营商',
    rule_key: '规则键',
    scene: '场景',
    name: '名称',
    description: '说明',
    risk_level: '风险等级',
    thresholds: '阈值配置',
    sort: '排序',
    subscribe_flag_count_24h: 'Flag触发次数(24h)',
    subscribe_flag_count_30d: 'Flag触发次数(30天)',
    subscribe_ua_unique_count_24h: '原始UA数(24h)',
    subscribe_ua_unique_count_30d: '原始UA数(30天)',
    top_raw_ua: 'Top原始UA',
    top_raw_ua_count: 'Top原始UA次数',
    raw_ua_list: '原始UA列表',
    raw_ua_stats: '原始UA统计',
    plan_name: '套餐名称',
    subscribe_domain: '订阅域名',
    reason: '原因',
    ua_hash: 'UA哈希',
    traffic_u: '上行流量',
    traffic_d: '下行流量',
    traffic_total: '总流量'
  };
  const formatTs = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1000000000 || n > 4102444800) return v ?? '';
    const d = new Date(n * 1000);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const formatCell = (k, v) => {
    if (v === null || typeof v === 'undefined') return '';
    if (typeof v === 'object') return JSON.stringify(v);
    if (/_at$/.test(k) || ['created_at', 'updated_at', 'connected_at'].includes(k)) return formatTs(v);
    return String(v);
  };
  const hiddenKeys = new Set(options.hiddenKeys || []);
  const keys = Object.keys(rows[0]).filter(k => !hiddenKeys.has(k));
  const thead = '<tr>' + keys.map(k => `<th title="${k}">${alias[k] || k}</th>`).join('') + '</tr>';
  const body = rows.map((r, i) => `<tr style="background:${i % 2 ? '#fcfcfd' : '#fff'}">` + keys.map(k => `<td>${formatCell(k, r[k])}</td>`).join('') + '</tr>').join('');
  return `<div class="table-wrap"><table><thead>${thead}</thead><tbody>${body}</tbody></table></div>`;
}

function renderTable(rows, pagerHtml = '', options = {}) {
  document.getElementById('result').innerHTML = `${pagerHtml}${buildTable(rows, options)}${pagerHtml}`;
}

function buildPager(current, pageSize, total, fetcherName) {
  if (!total || total <= pageSize) return '';
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safeCurrent = Math.min(Math.max(1, current), pages);
  return `<div class="pager">
    <button ${safeCurrent <= 1 ? 'disabled' : ''} onclick="${fetcherName}(${safeCurrent - 1}, ${pageSize})">上一页</button>
    <button ${safeCurrent >= pages ? 'disabled' : ''} onclick="${fetcherName}(${safeCurrent + 1}, ${pageSize})">下一页</button>
    <span class="muted">第 ${safeCurrent}/${pages} 页，共 ${total} 条</span>
  </div>`;
}

function setView(btn, title) {
  const titleEl = document.getElementById('viewTitle');
  if (titleEl) titleEl.textContent = `当前模块：${title}`;
  document.querySelectorAll('.menu-btn').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function renderOverview(data) {
  if (!data) {
    document.getElementById('result').innerHTML = '<p>暂无数据</p>';
    return;
  }

  const cards = [
    { label: '登录总量(24h)', value: data.login_total_24h },
    { label: '登录失败(24h)', value: `${data.login_failed_24h} (${data.login_failed_rate_24h})` },
    { label: '订阅总量(24h)', value: data.subscribe_total_24h },
    { label: '订阅失败(24h)', value: `${data.subscribe_failed_24h} (${data.subscribe_failed_rate_24h})` },
    { label: '规则触发(24h)', value: data.rule_hit_total_24h },
  ];

  const cardHtml = cards.map(item => `<div class="card"><div class="label">${item.label}</div><div class="value">${item.value ?? 0}</div></div>`).join('');
  const latestTitle = '<h4 style="margin-top: 18px; margin-bottom: 6px;">最近规则触发</h4>';
  const latestTable = buildTable(data.latest_rule_hits || []);

  document.getElementById('result').innerHTML = `<div class="cards">${cardHtml}</div>${latestTitle}${latestTable}`;
}

function renderRuleEditor(rows) {
  currentRuleRows = rows || [];
  if (!currentRuleRows.length) {
    document.getElementById('result').innerHTML = '<p>暂无规则</p>';
    return;
  }

  const thead = `
    <tr>
      <th>规则键</th>
      <th>场景</th>
      <th>规则名称</th>
      <th>规则说明</th>
      <th>风险等级</th>
      <th>是否启用</th>
      <th>排序</th>
      <th>阈值配置(JSON)</th>
      <th>操作</th>
    </tr>`;

  const body = currentRuleRows.map((rule, idx) => {
    const safe = (v) => String(v ?? '').replace(/"/g, '&quot;');
    const thresholds = JSON.stringify(rule.thresholds || {}, null, 2);
    return `
      <tr>
        <td>${safe(rule.rule_key)}</td>
        <td>${safe(rule.scene)}</td>
        <td><input id="name_${idx}" class="rule-input" value="${safe(rule.name || '')}"></td>
        <td><input id="desc_${idx}" class="rule-input" value="${safe(rule.description || '')}"></td>
        <td>
          <select id="risk_${idx}" class="rule-select">
            ${['low','medium','high'].map(level => `<option value="${level}" ${rule.risk_level === level ? 'selected' : ''}>${({low:'低',medium:'中',high:'高'}[level] || level)}</option>`).join('')}
          </select>
        </td>
        <td>
          <select id="enabled_${idx}" class="rule-select">
            <option value="1" ${Number(rule.enabled) === 1 ? 'selected' : ''}>启用</option>
            <option value="0" ${Number(rule.enabled) === 0 ? 'selected' : ''}>停用</option>
          </select>
        </td>
        <td><input id="sort_${idx}" class="rule-input" type="number" value="${safe(rule.sort ?? 0)}"></td>
        <td><textarea id="thresholds_${idx}" class="rule-textarea">${thresholds}</textarea></td>
        <td style="display:flex;gap:6px;">
          <button onclick="saveRule(${idx}, '${safe(rule.rule_key)}')">保存</button>
          <button onclick="resetRule('${safe(rule.rule_key)}')">重置</button>
        </td>
      </tr>`;
  }).join('');

  const actionBar = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
      <button onclick="saveAllRules()">批量保存全部规则</button>
      <button onclick="resetRule('')">恢复全部默认规则</button>
      <span class="muted">生产建议：变更后先在低峰期灰度观察 10~30 分钟。</span>
    </div>`;

  document.getElementById('result').innerHTML = `${actionBar}<div class="table-wrap"><table><thead>${thead}</thead><tbody>${body}</tbody></table></div>`;
}

async function request(path, options = {}) {
  if (!authorization) {
    alert('未检测到登录态，请先登录管理员后台');
    return null;
  }

  const headers = Object.assign({ 'Authorization': authorization }, options.headers || {});
  const res = await fetch(apiBase + path, Object.assign({}, options, { headers }));
  const data = await res.json();
  if (!res.ok) {
    alert(data.message || '请求失败');
    return null;
  }
  return data.data || [];
}

async function requestWithMeta(path, options = {}) {
  if (!authorization) return { rows: [], total: 0 };
  const headers = Object.assign({ 'Authorization': authorization }, options.headers || {});
  const res = await fetch(apiBase + path, Object.assign({}, options, { headers }));
  const payload = await res.json();
  if (!res.ok) {
    alert(payload.message || '请求失败');
    return { rows: [], total: 0 };
  }
  return { rows: payload.data || [], total: payload.total || 0 };
}

async function fetchOverview(btn) {
  setView(btn, '运营总览');
  const data = await request('/overview');
  if (data) {
    renderOverview(data);
  }
}

function renderRiskSettings(data) {
  const interval = Number(data.connection_log_interval || 3600);
  const retentionDays = Number(data.connection_log_retention_days || 30);
  document.getElementById('result').innerHTML = `
    <div style="max-width:680px;display:flex;flex-direction:column;gap:10px;">
      <h4 style="margin:0;">连接日志配置</h4>
      <div style="color:#6b7280;font-size:12px;">控制同一用户+IP+节点在连接历史中的最小记录间隔，以及连接日志保留时长。仅影响“连接历史”页面，不影响在线用户、订阅日志、登录日志展示。</div>
      <label style="font-size:12px;color:#374151;">记录间隔（秒）</label>
      <input id="risk_connection_log_interval" class="rule-input" type="number" min="60" max="86400" value="${interval}">
      <label style="font-size:12px;color:#374151;">连接日志保留时长（天）</label>
      <input id="risk_connection_log_retention_days" class="rule-input" type="number" min="1" max="365" value="${retentionDays}">
      <div style="display:flex;gap:8px;align-items:center;">
        <button onclick="saveRiskSettings()">保存配置</button>
        <span style="font-size:12px;color:#6b7280;">间隔范围：60 ~ 86400 秒；保留范围：1 ~ 365 天</span>
      </div>
      <div style="font-size:12px;color:#6b7280;">生产建议：连接历史建议保留 7~30 天；若需长期审计请异步归档，不建议无限保留在在线库。</div>
    </div>`;
}

async function fetchRiskSettings(btn) {
  setView(btn, '风控后台配置');
  const data = await request('/settings/fetch');
  if (data) renderRiskSettings(data);
}

async function saveRiskSettings() {
  const connectionLogInterval = Number(document.getElementById('risk_connection_log_interval').value || 3600);
  const connectionLogRetentionDays = Number(document.getElementById('risk_connection_log_retention_days').value || 30);
  if (connectionLogInterval < 60 || connectionLogInterval > 86400) {
    alert('记录间隔必须在 60~86400 秒');
    return;
  }
  if (connectionLogRetentionDays < 1 || connectionLogRetentionDays > 365) {
    alert('保留时长必须在 1~365 天');
    return;
  }
  const data = await request('/settings/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connection_log_interval: connectionLogInterval,
      connection_log_retention_days: connectionLogRetentionDays,
    }),
  });
  if (data) {
    alert('保存成功');
    renderRiskSettings(data);
  }
}

async function fetchRules(btn) {
  setView(btn, '规则配置');
  const rows = await request('/rule/fetch');
  if (rows) renderRuleEditor(rows);
}

function buildRulePayload(idx, ruleKey) {
  let thresholds;
  try {
    thresholds = JSON.parse(document.getElementById(`thresholds_${idx}`).value || '{}');
  } catch (e) {
    throw new Error(`规则 ${ruleKey} 的阈值 JSON 格式错误`);
  }

  return {
    rule_key: ruleKey,
    name: document.getElementById(`name_${idx}`).value,
    description: document.getElementById(`desc_${idx}`).value,
    risk_level: document.getElementById(`risk_${idx}`).value,
    enabled: Number(document.getElementById(`enabled_${idx}`).value),
    sort: Number(document.getElementById(`sort_${idx}`).value || 0),
    thresholds,
  };
}

async function saveRule(idx, ruleKey) {
  let payload;
  try {
    payload = buildRulePayload(idx, ruleKey);
  } catch (err) {
    alert(err.message);
    return;
  }

  const rows = await request('/rule/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (rows) {
    alert('保存成功');
    renderRuleEditor(rows);
  }
}

async function saveAllRules() {
  if (!currentRuleRows.length) return;
  if (!confirm('确认保存全部规则？')) return;

  for (let i = 0; i < currentRuleRows.length; i++) {
    const rule = currentRuleRows[i];
    let payload;
    try {
      payload = buildRulePayload(i, rule.rule_key);
    } catch (err) {
      alert(err.message);
      return;
    }

    const rows = await request('/rule/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!rows) {
      return;
    }
    currentRuleRows = rows;
  }

  alert('全部规则保存成功');
  renderRuleEditor(currentRuleRows);
}

async function resetRule(ruleKey) {
  const isAll = !ruleKey;
  if (!confirm(isAll ? '确认恢复全部规则到默认？' : `确认将规则 ${ruleKey} 恢复为默认？`)) return;

  const rows = await request('/rule/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ruleKey ? { rule_key: ruleKey } : {}),
  });

  if (rows) {
    alert('重置成功');
    renderRuleEditor(rows);
  }
}



function buildClientStrategySummary(rows) {
  const toNum = (v) => Number(v || 0);
  const metrics = [
    { label: 'Flag触发(24h)', value: rows.reduce((sum, item) => sum + toNum(item.subscribe_flag_count_24h), 0) },
    { label: 'Flag触发(30天)', value: rows.reduce((sum, item) => sum + toNum(item.subscribe_flag_count_30d), 0) },
    { label: '原始UA数(24h)', value: rows.reduce((sum, item) => sum + toNum(item.subscribe_ua_unique_count_24h), 0) },
    { label: '原始UA数(30天)', value: rows.reduce((sum, item) => sum + toNum(item.subscribe_ua_unique_count_30d), 0) },
  ].filter(item => Number(item.value) > 0);

  const cardsHtml = metrics.length
    ? `<div class="cards" style="margin-bottom:12px;">${metrics.map(item => `<div class="card"><div class="label">${item.label}</div><div class="value">${item.value}</div></div>`).join('')}</div>`
    : '<p style="color:#6b7280;margin-bottom:10px;">总览统计均为 0，暂无可展示指标。</p>';

  const topClientBy24h = rows.slice().sort((a, b) => toNum(b.subscribe_flag_count_24h) - toNum(a.subscribe_flag_count_24h))[0] || null;
  const hintHtml = topClientBy24h && toNum(topClientBy24h.subscribe_flag_count_24h) > 0
    ? `<div style="font-size:12px;color:#6b7280;margin-bottom:10px;">24小时最活跃客户端：<b>${String(topClientBy24h.client_type || '-')}</b>（${toNum(topClientBy24h.subscribe_flag_count_24h)} 次）</div>`
    : '';

  return cardsHtml + hintHtml;
}


function renderClientStrategyOverview(rows) {
  if (!rows || !rows.length) {
    document.getElementById('result').innerHTML = '<p>暂无客户端策略数据</p>';
    return;
  }

  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toNum = (v) => Number(v || 0);
  const activeRows = rows.filter(item => {
    return toNum(item.subscribe_flag_count_24h) > 0
      || toNum(item.subscribe_flag_count_30d) > 0
      || toNum(item.subscribe_ua_unique_count_24h) > 0
      || toNum(item.subscribe_ua_unique_count_30d) > 0
      || (Array.isArray(item.raw_ua_list) && item.raw_ua_list.length > 0);
  });

  if (!activeRows.length) {
    document.getElementById('result').innerHTML = '<p>暂无触发数据（全部为0）</p>';
    return;
  }

  const summaryHtml = buildClientStrategySummary(activeRows);
  const topFlagRows = activeRows.slice().sort((a, b) => Number(b.subscribe_flag_count_24h || 0) - Number(a.subscribe_flag_count_24h || 0));
  const flagRankTable = `<div class="table-wrap"><table><thead><tr><th>客户端标识</th><th>客户端名称</th><th>Flag触发(24h)</th><th>Flag触发(30天)</th></tr></thead><tbody>` +
    topFlagRows.map(item => `<tr><td>${esc(item.client_type || '')}</td><td>${esc(item.client_name || '')}</td><td>${toNum(item.subscribe_flag_count_24h)}</td><td>${toNum(item.subscribe_flag_count_30d)}</td></tr>`).join('') +
    `</tbody></table></div>`;

  const uaAllRows = activeRows.filter(item => Array.isArray(item.raw_ua_stats) && item.raw_ua_stats.length > 0);
  const uaTable = uaAllRows.length
    ? `<div class="table-wrap"><table><thead><tr><th>客户端标识</th><th>原始UA</th><th>UA订阅次数(24h)</th><th>UA订阅次数(30天)</th></tr></thead><tbody>`
      + uaAllRows.map(item => {
          const uaCells = item.raw_ua_stats.map(stat => `<div style="margin-bottom:4px;word-break:break-all;">${esc(stat.ua || '')}</div>`).join('');
          const ua24hCells = item.raw_ua_stats.map(stat => `<div style="margin-bottom:4px;">${toNum(stat.count_24h)}</div>`).join('');
          const ua30dCells = item.raw_ua_stats.map(stat => `<div style="margin-bottom:4px;">${toNum(stat.count_30d)}</div>`).join('');
          return `<tr><td>${esc(item.client_type || '')}</td><td>${uaCells}</td><td>${ua24hCells}</td><td>${ua30dCells}</td></tr>`;
        }).join('')
      + `</tbody></table></div>`
    : '<p style="color:#6b7280;">暂无原始UA明细</p>';

  const explain = '<div style="font-size:12px;color:#6b7280;margin:0 0 8px;">分析建议：先看 Top Flag 快速定位热点客户端，再结合全部原始UA明细判断具体客户端版本、分发渠道与自动化特征。</div>';
  document.getElementById('result').innerHTML = summaryHtml
    + explain
    + '<h4 style="margin:4px 0 8px;">Top Flag 排名（仅显示有数据客户端）</h4>' + flagRankTable
    + '<h4 style="margin:12px 0 8px;">原始UA明细（30天，不做归类）</h4>' + uaTable;
}


function renderClientStrategyEditor(rows) {
  if (!rows || !rows.length) {
    document.getElementById('result').innerHTML = '<p>暂无客户端策略</p>';
    return;
  }

  const thead = `
    <tr>
      <th>客户端标识</th>
      <th>客户端名称</th>
      <th>是否启用</th>
      <th>排序</th>
      <th>最低版本</th>
      <th>Flag触发(24h)</th>
      <th>Flag触发(30天)</th>
      <th>操作</th>
    </tr>`;

  const body = rows.map((item, idx) => {
    const safe = (v) => String(v ?? '').replace(/"/g, '&quot;');
    return `
      <tr>
        <td>${safe(item.client_type)}</td>
        <td><input id="client_name_${idx}" class="rule-input" value="${safe(item.client_name || '')}"></td>
        <td><input id="client_enabled_${idx}" type="checkbox" ${item.is_enabled ? 'checked' : ''}></td>
        <td><input id="client_sort_${idx}" class="rule-input" type="number" value="${safe(item.sort ?? 0)}"></td>
        <td><input id="client_min_version_${idx}" class="rule-input" placeholder="例如: 1.8.0" value="${safe(item.min_version || '')}"></td>
        <td>${safe(item.subscribe_flag_count_24h ?? 0)}</td>
        <td>${safe(item.subscribe_flag_count_30d ?? 0)}</td>
        <td style="display:flex;gap:6px;">
          <button onclick="saveClientStrategy(${idx}, '${safe(item.client_type)}')">保存</button>
          <button style="border-color:#fecaca;color:#dc2626;" onclick="deleteClientStrategy('${safe(item.client_type)}')">删除</button>
        </td>
      </tr>`;
  }).join('');

  document.getElementById('result').innerHTML = `<div class="table-wrap"><table><thead>${thead}</thead><tbody>${body}</tbody></table></div>`;
}

async function fetchClientStrategyOverview(btn) {
  setView(btn, '客户端策略总览');
  const rows = await request('/client-strategy/fetch');
  if (rows) renderClientStrategyOverview(rows);
}

async function fetchClientStrategies(btn) {
  setView(btn, '客户端策略管理');
  const rows = await request('/client-strategy/fetch');
  if (rows) renderClientStrategyEditor(rows);
}

async function saveClientStrategy(idx, clientType) {
  const payload = {
    client_type: clientType,
    client_name: document.getElementById(`client_name_${idx}`).value,
    is_enabled: document.getElementById(`client_enabled_${idx}`).checked,
    sort: Number(document.getElementById(`client_sort_${idx}`).value || 0),
    min_version: document.getElementById(`client_min_version_${idx}`).value,
  };

  const rows = await request('/client-strategy/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (rows) {
    alert('保存成功');
    renderClientStrategyEditor(rows);
  }
}


async function deleteClientStrategy(clientType) {
  if (!confirm(`确定删除客户端策略 ${clientType} 吗？`)) {
    return;
  }

  const rows = await request('/client-strategy/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_type: clientType }),
  });

  if (rows) {
    alert('删除成功');
    renderClientStrategyEditor(rows);
  }
}


function renderBlacklistEditor(rows, activeType = 'ip') {
  const safe = (v) => String(v ?? '').replace(/"/g, '&quot;');
  const allRows = rows || [];
  const ipRows = allRows.filter(item => item.type === 'ip');
  const uaRows = allRows.filter(item => item.type === 'ua_hash');

  const renderIpTable = () => {
    const body = ipRows.map((item, idx) => `
      <tr>
        <td>${safe(item.id)}</td>
        <td><input id="bl_ip_value_${idx}" class="rule-input" value="${safe(item.value || '')}"></td>
        <td><input id="bl_ip_remark_${idx}" class="rule-input" value="${safe(item.remark || '')}"></td>
        <td><input id="bl_ip_enabled_${idx}" type="checkbox" ${item.is_enabled ? 'checked' : ''}></td>
        <td style="display:flex;gap:6px;">
          <button onclick="saveBlacklist('ip', ${idx})">保存</button>
          <button style="border-color:#fecaca;color:#dc2626;" onclick="deleteBlacklist('${safe(item.id)}')">删除</button>
        </td>
      </tr>
    `).join('');

    const createRow = `
      <tr>
        <td>new</td>
        <td><input id="bl_ip_new_value" class="rule-input" placeholder="IP"></td>
        <td><input id="bl_ip_new_remark" class="rule-input" placeholder="备注"></td>
        <td><input id="bl_ip_new_enabled" type="checkbox" checked></td>
        <td><button onclick="createBlacklist('ip')">新增</button></td>
      </tr>
    `;

    return `<div class="table-wrap"><table><thead><tr><th>编号</th><th>IP地址</th><th>备注</th><th>是否启用</th><th>操作</th></tr></thead><tbody>${createRow}${body}</tbody></table></div>`;
  };

  const renderUaTable = () => {
    const body = uaRows.map((item, idx) => `
      <tr>
        <td>${safe(item.id)}</td>
        <td><input id="bl_ua_hash_${idx}" class="rule-input" value="${safe(item.value || '')}" placeholder="SHA256"></td>
        <td><div style="display:flex;gap:6px;"><input id="bl_ua_raw_${idx}" class="rule-input" value="${safe(item.ua_raw || '')}" placeholder="原始UA"><button onclick="convertRowUaToHash(${idx})">UA→HASH</button></div></td>
        <td><input id="bl_ua_remark_${idx}" class="rule-input" value="${safe(item.remark || '')}"></td>
        <td><input id="bl_ua_enabled_${idx}" type="checkbox" ${item.is_enabled ? 'checked' : ''}></td>
        <td style="display:flex;gap:6px;"><button onclick="saveBlacklist('ua_hash', ${idx})">保存</button><button style="border-color:#fecaca;color:#dc2626;" onclick="deleteBlacklist('${safe(item.id)}')">删除</button></td>
      </tr>
    `).join('');

    const createRow = `
      <tr>
        <td>new</td>
        <td><input id="bl_ua_new_hash" class="rule-input" placeholder="SHA256（可留空，自动从UA计算）"></td>
        <td><div style="display:flex;gap:6px;"><input id="bl_ua_new_raw" class="rule-input" placeholder="原始UA"><button onclick="convertNewUaToHash()">UA→HASH</button></div></td>
        <td><input id="bl_ua_new_remark" class="rule-input" placeholder="备注"></td>
        <td><input id="bl_ua_new_enabled" type="checkbox" checked></td>
        <td><button onclick="createBlacklist('ua_hash')">新增</button></td>
      </tr>
    `;

    return `<div class="table-wrap"><table><thead><tr><th>编号</th><th>UA哈希</th><th>原始UA</th><th>备注</th><th>是否启用</th><th>操作</th></tr></thead><tbody>${createRow}${body}</tbody></table></div>`;
  };

  const tabs = `
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <button onclick="renderBlacklistEditor(window.__blacklistRows || [], 'ip')" ${activeType === 'ip' ? 'style="background:#eff6ff;border-color:#2563eb;"' : ''}>IP黑名单</button>
      <button onclick="renderBlacklistEditor(window.__blacklistRows || [], 'ua_hash')" ${activeType === 'ua_hash' ? 'style="background:#eff6ff;border-color:#2563eb;"' : ''}>UA黑名单</button>
    </div>`;

  window.__blacklistRows = allRows;
  const panel = activeType === 'ua_hash' ? renderUaTable() : renderIpTable();
  document.getElementById('result').innerHTML = `<h4 style="margin:10px 0 6px;">黑名单管理</h4>${tabs}${panel}`;
}

async function fetchBlacklists(btn) {
  setView(btn, '黑名单管理');
  const rows = await request('/blacklist/fetch');
  if (rows) renderBlacklistEditor(rows, 'ip');
}

async function createBlacklist(type) {
  const payload = type === 'ip' ? {
    type,
    value: document.getElementById('bl_ip_new_value').value,
    remark: document.getElementById('bl_ip_new_remark').value,
    is_enabled: document.getElementById('bl_ip_new_enabled').checked,
  } : {
    type,
    value: document.getElementById('bl_ua_new_hash').value,
    ua_raw: document.getElementById('bl_ua_new_raw').value,
    remark: document.getElementById('bl_ua_new_remark').value,
    is_enabled: document.getElementById('bl_ua_new_enabled').checked,
  };

  const rows = await request('/blacklist/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (rows) {
    alert('新增成功');
    renderBlacklistEditor(rows, type);
  }
}

async function saveBlacklist(type, idx) {
  const payload = type === 'ip' ? {
    type,
    value: document.getElementById(`bl_ip_value_${idx}`).value,
    remark: document.getElementById(`bl_ip_remark_${idx}`).value,
    is_enabled: document.getElementById(`bl_ip_enabled_${idx}`).checked,
  } : {
    type,
    value: document.getElementById(`bl_ua_hash_${idx}`).value,
    ua_raw: document.getElementById(`bl_ua_raw_${idx}`).value,
    remark: document.getElementById(`bl_ua_remark_${idx}`).value,
    is_enabled: document.getElementById(`bl_ua_enabled_${idx}`).checked,
  };

  const rows = await request('/blacklist/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (rows) {
    alert('保存成功');
    renderBlacklistEditor(rows, type);
  }
}

async function deleteBlacklist(id) {
  if (!confirm(`确定删除黑名单记录 ${id} 吗？`)) return;
  const rows = await request('/blacklist/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (rows) {
    alert('删除成功');
    renderBlacklistEditor(rows, 'ip');
  }
}


async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input || ''));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function convertNewUaToHash() {
  const rawEl = document.getElementById('bl_ua_new_raw');
  const hashEl = document.getElementById('bl_ua_new_hash');
  if (!rawEl || !hashEl) return;
  const ua = rawEl.value.trim();
  if (!ua) {
    alert('请输入原始 UA 字符串');
    return;
  }
  hashEl.value = await sha256Hex(ua);
}

async function convertRowUaToHash(idx) {
  const rawEl = document.getElementById(`bl_ua_raw_${idx}`);
  const hashEl = document.getElementById(`bl_ua_hash_${idx}`);
  if (!rawEl || !hashEl) return;
  const ua = rawEl.value.trim();
  if (!ua) {
    alert('请输入原始 UA 字符串');
    return;
  }
  hashEl.value = await sha256Hex(ua);
}

async function fetchRuleHits(btn, current = 1, pageSize = 50) {
  setView(btn, '规则命中记录');
  const { rows, total } = await requestWithMeta(`/rule-hit/fetch?page_size=${pageSize}&current=${current}`);
  renderTable(rows, buildPager(current, pageSize, total, 'fetchRuleHitsPage'), { hiddenKeys: ['created_at', 'updated_at'] });
}
function fetchRuleHitsPage(current, pageSize){ fetchRuleHits(null, current, pageSize); }

async function fetchOnlineUsers(btn, current = 1, pageSize = 200) {
  setView(btn, '实时在线IP');
  const { rows, total } = await requestWithMeta(`/online-user/fetch?page_size=${pageSize}&current=${current}`);
  renderTable(rows, buildPager(current, pageSize, total, 'fetchOnlineUsersPage'), { hiddenKeys: ['created_at', 'updated_at'] });
}
function fetchOnlineUsersPage(current, pageSize){ fetchOnlineUsers(null, current, pageSize); }

async function fetchUserUsage(btn, current = 1, pageSize = 200) {
  setView(btn, '用户画像总览');
  const { rows, total } = await requestWithMeta(`/user-usage/fetch?page_size=${pageSize}&current=${current}`);
  renderTable(rows, buildPager(current, pageSize, total, 'fetchUserUsagePage'), { hiddenKeys: ['created_at', 'updated_at'] });
}
function fetchUserUsagePage(current, pageSize){ fetchUserUsage(null, current, pageSize); }

async function fetchUserConnectionLogs(btn, current = 1, pageSize = 200) {
  setView(btn, '连接历史');
  const { rows, total } = await requestWithMeta(`/user-connection-log/fetch?page_size=${pageSize}&current=${current}`);
  renderTable(rows, buildPager(current, pageSize, total, 'fetchUserConnectionLogsPage'), { hiddenKeys: ['created_at', 'updated_at'] });
}
function fetchUserConnectionLogsPage(current, pageSize){ fetchUserConnectionLogs(null, current, pageSize); }

async function fetchLoginLogs(btn, current = 1, pageSize = 50) {
  setView(btn, '登录记录');
  const { rows, total } = await requestWithMeta(`/login-log/fetch?page_size=${pageSize}&current=${current}`);
  renderTable(rows, buildPager(current, pageSize, total, 'fetchLoginLogsPage'), { hiddenKeys: ['updated_at'] });
}
function fetchLoginLogsPage(current, pageSize){ fetchLoginLogs(null, current, pageSize); }

async function fetchSubscribeLogs(btn, current = 1, pageSize = 50) {
  setView(btn, '订阅记录');
  const { rows, total } = await requestWithMeta(`/subscribe-log/fetch?page_size=${pageSize}&current=${current}`);
  renderTable(rows, buildPager(current, pageSize, total, 'fetchSubscribeLogsPage'), { hiddenKeys: ['updated_at'] });
}
function fetchSubscribeLogsPage(current, pageSize){ fetchSubscribeLogs(null, current, pageSize); }

if (authorization) fetchOverview(document.querySelector('.menu-btn'));
</script>
</body>
</html>
