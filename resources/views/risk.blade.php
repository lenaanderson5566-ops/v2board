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
        body { font-family: Arial, sans-serif; margin: 0; background: var(--bg); color: var(--text); }

        .layout { display: flex; min-height: 100vh; }
        .sidebar {
            width: 240px;
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
            cursor: pointer;
        }
        .menu-btn:hover { background: #2563eb; border-color: #2563eb; }

        .content { flex: 1; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
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

        .result-panel { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 14px; min-height: 220px; }
        .cards { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 12px; margin-top: 12px; }
        .card { border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: #fafafa; }
        .card .label { color: var(--muted); font-size: 12px; }
        .card .value { font-size: 18px; font-weight: bold; margin-top: 6px; }

        table { width: 100%; border-collapse: collapse; margin-top: 12px; background: #fff; }
        th, td { border: 1px solid var(--border); padding: 8px; text-align: left; font-size: 12px; vertical-align: top; }
        th { background: #f9fafb; position: sticky; top: 0; }
        .table-wrap { max-height: 620px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; }

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
<div class="layout">
    <aside class="sidebar">
        <h3>Risk Console</h3>
        <p>风控后台导航</p>

        <div class="menu-section">
            <div class="menu-title">总览</div>
            <div class="menu-list">
                <button class="menu-btn" onclick="fetchOverview()">查看总览</button>
            </div>
        </div>

        <div class="menu-section">
            <div class="menu-title">日志</div>
            <div class="menu-list">
                <button class="menu-btn" onclick="fetchLoginLogs()">登录日志</button>
                <button class="menu-btn" onclick="fetchSubscribeLogs()">订阅日志</button>
            </div>
        </div>

        <div class="menu-section">
            <div class="menu-title">风控</div>
            <div class="menu-list">
                <button class="menu-btn" onclick="fetchRules()">规则配置</button>
                <button class="menu-btn" onclick="fetchRuleHits()">规则触发记录</button>
                <button class="menu-btn" onclick="fetchClientStrategies()">客户端策略</button>
            </div>
        </div>
    </aside>

    <main class="content">
        <div class="container">
            <div class="header">
                <div>
                    <h2 class="title">Risk Control Console</h2>
                    <p class="subtitle">风控总览、日志检索、规则管理</p>
                </div>
            </div>

            <div id="authState" class="status"></div>
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
const authStateEl = document.getElementById('authState');
if (authorization) {
  authStateEl.className = 'status ok';
  authStateEl.textContent = '已自动读取后台登录态（authorization），可直接查询风控信息。';
} else {
  authStateEl.className = 'status warn';
  authStateEl.innerHTML = `未检测到后台登录态，请先前往 <a href="${adminPath}">管理员后台登录</a> 后再访问风控页面。`;
}

function buildTable(rows) {
  if (!rows || !rows.length) {
    return '<p>暂无数据</p>';
  }
  const keys = Object.keys(rows[0]);
  const thead = '<tr>' + keys.map(k => `<th>${k}</th>`).join('') + '</tr>';
  const body = rows.map(r => '<tr>' + keys.map(k => `<td>${typeof r[k] === 'object' ? JSON.stringify(r[k]) : (r[k] ?? '')}</td>`).join('') + '</tr>').join('');
  return `<div class="table-wrap"><table><thead>${thead}</thead><tbody>${body}</tbody></table></div>`;
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
  const latestTitle = '<h4 style="margin-top: 18px; margin-bottom: 6px;">最近规则触发</h4>';
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

  document.getElementById('result').innerHTML = `<div class="table-wrap"><table><thead>${thead}</thead><tbody>${body}</tbody></table></div>`;
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


function renderClientStrategyEditor(rows) {
  if (!rows || !rows.length) {
    document.getElementById('result').innerHTML = '<p>暂无客户端策略</p>';
    return;
  }

  const thead = `
    <tr>
      <th>client_type</th>
      <th>client_name</th>
      <th>is_enabled</th>
      <th>sort</th>
      <th>min_version</th>
      <th>action</th>
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
        <td style="display:flex;gap:6px;">
          <button onclick="saveClientStrategy(${idx}, '${safe(item.client_type)}')">保存</button>
          <button style="border-color:#fecaca;color:#dc2626;" onclick="deleteClientStrategy('${safe(item.client_type)}')">删除</button>
        </td>
      </tr>`;
  }).join('');

  document.getElementById('result').innerHTML = `<div class="table-wrap"><table><thead>${thead}</thead><tbody>${body}</tbody></table></div>`;
}

async function fetchClientStrategies() {
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
