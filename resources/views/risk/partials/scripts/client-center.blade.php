function renderClientStrategyEditor(rows) {
  if (!rows || !rows.length) return document.getElementById('result').innerHTML = '<p>暂无客户端策略</p>';
  const body = rows.map((item, idx) => `<tr><td>${item.client_type || ''}</td><td><input id="client_name_${idx}" class="rule-input" value="${String(item.client_name || '').replace(/"/g, '&quot;')}"></td><td><input id="client_enabled_${idx}" type="checkbox" ${item.is_enabled ? 'checked' : ''}></td><td><input id="client_sort_${idx}" class="rule-input" type="number" value="${Number(item.sort || 0)}"></td><td><input id="client_min_version_${idx}" class="rule-input" value="${String(item.min_version || '').replace(/"/g, '&quot;')}"></td><td><button onclick="saveClientStrategy(${idx}, '${item.client_type || ''}')">保存</button></td></tr>`).join('');
  document.getElementById('result').innerHTML = `<div class="table-wrap"><table><thead><tr><th>客户端标识</th><th>名称</th><th>启用</th><th>排序</th><th>最低版本</th><th>操作</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

async function fetchClientStrategies(btn) { setView(btn, '客户端策略管理'); const rows = await request('/client/strategy/fetch'); if (rows) renderClientStrategyEditor(rows); }
async function saveClientStrategy(idx, clientType) {
  const rows = await request('/client/strategy/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_type: clientType, client_name: document.getElementById(`client_name_${idx}`).value, is_enabled: document.getElementById(`client_enabled_${idx}`).checked, sort: Number(document.getElementById(`client_sort_${idx}`).value || 0), min_version: document.getElementById(`client_min_version_${idx}`).value }) });
  if (rows) renderClientStrategyEditor(rows);
}

Object.assign(window.CenterActions, {
  client_manage: () => fetchClientStrategies(null),
});
