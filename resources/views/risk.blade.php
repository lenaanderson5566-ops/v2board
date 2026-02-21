<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $title }} - Risk Control</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
        th { background: #f3f3f3; }
        .row { margin: 8px 0; }
        button { padding: 6px 10px; margin-right: 6px; }
        .ok { color: #389e0d; }
        .warn { color: #cf1322; }
    </style>
</head>
<body>
<h2>Risk Control Console</h2>
<div id="authState" class="row"></div>
<div class="row">
    <button onclick="fetchLoginLogs()">查询登录日志</button>
    <button onclick="fetchSubscribeLogs()">查询订阅日志</button>
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
  authStateEl.textContent = '已自动读取后台登录态（authorization），可直接查询日志。';
} else {
  authStateEl.className = 'row warn';
  authStateEl.innerHTML = `未检测到后台登录态，请先前往 <a href="${adminPath}">管理员后台登录</a> 后再访问风控页面。`;
}

function renderTable(rows) {
  if (!rows || !rows.length) {
    document.getElementById('result').innerHTML = '<p>暂无数据</p>';
    return;
  }
  const keys = Object.keys(rows[0]);
  const thead = '<tr>' + keys.map(k => `<th>${k}</th>`).join('') + '</tr>';
  const body = rows.map(r => '<tr>' + keys.map(k => `<td>${r[k] ?? ''}</td>`).join('') + '</tr>').join('');
  document.getElementById('result').innerHTML = `<table><thead>${thead}</thead><tbody>${body}</tbody></table>`;
}

async function request(path) {
  if (!authorization) {
    alert('未检测到登录态，请先登录管理员后台');
    return null;
  }

  const res = await fetch(apiBase + path, { headers: { 'Authorization': authorization } });
  const data = await res.json();
  if (!res.ok) {
    alert(data.message || '请求失败');
    return null;
  }
  return data.data || [];
}

async function fetchLoginLogs() {
  const rows = await request('/login-log/fetch?page_size=50');
  if (rows) renderTable(rows);
}

async function fetchSubscribeLogs() {
  const rows = await request('/subscribe-log/fetch?page_size=50');
  if (rows) renderTable(rows);
}
</script>
</body>
</html>
