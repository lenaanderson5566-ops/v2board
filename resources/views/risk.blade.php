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
        input { padding: 6px; margin-right: 8px; }
        button { padding: 6px 10px; margin-right: 6px; }
    </style>
</head>
<body>
<h2>Risk Control Console</h2>
<div class="row">Authorization: <input id="token" placeholder="粘贴 auth_data" style="width: 420px"></div>
<div class="row">
    <button onclick="fetchLoginLogs()">查询登录日志</button>
    <button onclick="fetchSubscribeLogs()">查询订阅日志</button>
</div>
<div id="filters" class="row"></div>
<div id="result"></div>
<script>
const apiBase = '/api/v1/{{ $api_path }}';

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
  const token = document.getElementById('token').value.trim();
  if (!token) return alert('请先输入 auth_data');
  const res = await fetch(apiBase + path, { headers: { 'Authorization': token } });
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
