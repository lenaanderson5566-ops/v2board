<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $title }} - Risk Control</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; vertical-align: top; }
        th { background: #f3f3f3; }
        .row { margin: 8px 0; }
        button { padding: 6px 10px; margin-right: 6px; margin-bottom: 6px; }
        .ok { color: #389e0d; }
        .warn { color: #cf1322; }
        .cards { display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 12px; margin-top: 12px; }
        .card { border: 1px solid #ddd; border-radius: 6px; padding: 10px; background: #fafafa; }
        .card .label { color: #666; font-size: 12px; }
        .card .value { font-size: 20px; font-weight: bold; margin-top: 6px; }
        .rule-input, .rule-select, .rule-textarea { width: 100%; box-sizing: border-box; font-size: 12px; }
        .rule-textarea { min-height: 72px; }
    </style>
</head>
<body>
<h2>Risk Control Console</h2>
<div id="authState" class="row"></div>
<div class="row">
    <button onclick="fetchOverview()">总览</button>
    <button onclick="fetchRules()">风控规则（可编辑）</button>
    <button onclick="fetchRuleHits()">规则触发记录</button>
    <button onclick="fetchLoginLogs()">登录日志</button>
    <button onclick="fetchSubscribeLogs()">订阅日志</button>
</div>
<div id="result"></div>
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
const authStateEl = document.getElementById('authState');
if (authorization) {
  authStateEl.className = 'row ok';
  authStateEl.textContent = '已自动读取后台登录态（authorization），可直接查询风控信息。';
} else {
  authStateEl.className = 'row warn';
  authStateEl.innerHTML = `未检测到后台登录态，请先前往 <a href="${adminPath}">管理员后台登录</a> 后再访问风控页面。`;
}

function buildTable(rows) {
  if (!rows || !rows.length) {
    return '<p>暂无数据</p>';
  }
  const keys = Object.keys(rows[0]);
  const thead = '<tr>' + keys.map(k => `<th>${k}</th>`).join('') + '</tr>';
  const body = rows.map(r => '<tr>' + keys.map(k => `<td>${typeof r[k] === 'object' ? JSON.stringify(r[k]) : (r[k] ?? '')}</td>`).join('') + '</tr>').join('');
  return `<table><thead>${thead}</thead><tbody>${body}</tbody></table>`;
}

function renderTable(rows) {
  document.getElementById('result').innerHTML = buildTable(rows);
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
  const latestTitle = '<h4 style="margin-top: 18px;">最近规则触发</h4>';
  const latestTable = buildTable(data.latest_rule_hits || []);

  document.getElementById('result').innerHTML = `<div class="cards">${cardHtml}</div>${latestTitle}${latestTable}`;
}

function renderRuleEditor(rows) {
  if (!rows || !rows.length) {
    document.getElementById('result').innerHTML = '<p>暂无规则</p>';
    return;
  }

  const thead = `
    <tr>
      <th>rule_key</th>
      <th>scene</th>
      <th>name</th>
      <th>description</th>
      <th>risk_level</th>
      <th>enabled</th>
      <th>sort</th>
      <th>thresholds(JSON)</th>
      <th>action</th>
    </tr>`;

  const body = rows.map((rule, idx) => {
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
            ${['low','medium','high'].map(level => `<option value="${level}" ${rule.risk_level === level ? 'selected' : ''}>${level}</option>`).join('')}
          </select>
        </td>
        <td>
          <select id="enabled_${idx}" class="rule-select">
            <option value="1" ${Number(rule.enabled) === 1 ? 'selected' : ''}>1</option>
            <option value="0" ${Number(rule.enabled) === 0 ? 'selected' : ''}>0</option>
          </select>
        </td>
        <td><input id="sort_${idx}" class="rule-input" type="number" value="${safe(rule.sort ?? 0)}"></td>
        <td><textarea id="thresholds_${idx}" class="rule-textarea">${thresholds}</textarea></td>
        <td><button onclick="saveRule(${idx}, '${safe(rule.rule_key)}')">保存</button></td>
      </tr>`;
  }).join('');

  document.getElementById('result').innerHTML = `<table><thead>${thead}</thead><tbody>${body}</tbody></table>`;
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

async function fetchOverview() {
  const data = await request('/overview');
  if (data) {
    renderOverview(data);
  }
}

async function fetchRules() {
  const rows = await request('/rule/fetch');
  if (rows) renderRuleEditor(rows);
}

async function saveRule(idx, ruleKey) {
  let thresholds;
  try {
    thresholds = JSON.parse(document.getElementById(`thresholds_${idx}`).value || '{}');
  } catch (e) {
    alert('thresholds JSON 格式错误');
    return;
  }

  const payload = {
    rule_key: ruleKey,
    name: document.getElementById(`name_${idx}`).value,
    description: document.getElementById(`desc_${idx}`).value,
    risk_level: document.getElementById(`risk_${idx}`).value,
    enabled: Number(document.getElementById(`enabled_${idx}`).value),
    sort: Number(document.getElementById(`sort_${idx}`).value || 0),
    thresholds,
  };

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

async function fetchRuleHits() {
  const rows = await request('/rule-hit/fetch?page_size=50');
  if (rows) renderTable(rows);
}

async function fetchLoginLogs() {
  const rows = await request('/login-log/fetch?page_size=50');
  if (rows) renderTable(rows);
}

async function fetchSubscribeLogs() {
  const rows = await request('/subscribe-log/fetch?page_size=50');
  if (rows) renderTable(rows);
}

fetchOverview();
</script>
</body>
</html>
