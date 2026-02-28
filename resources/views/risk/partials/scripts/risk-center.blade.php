let currentRuleRows = [];
const riskFilters = { onlineUsers: { email: '', ip: '' }, userUsage: { email: '' } };


function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}


function metricCell(label, values) {
  const t = values.today || {};
  const d7 = values['7d'] || {};
  const d30 = values['30d'] || {};
  return `<div class="card"><div class="label">${label}</div><div style="font-size:12px;color:#374151;line-height:1.8;">当日：${t}<br>近7天：${d7}<br>近30天：${d30}</div></div>`;
}


function renderFlagClientRanking(rows) {
  if (!rows || !rows.length) {
    return '<h4 style="margin:8px 0;">Top Flag 排名（仅显示有数据客户端）</h4><p style="color:#6b7280;">暂无数据</p>';
  }
  const body = rows.map((r) => `<tr><td>${r.client_type || '-'}</td><td>${r.client_name || '-'}</td><td>${r.hits_24h || 0}</td><td>${r.hits_30d || 0}</td></tr>`).join('');
  return `<h4 style="margin:8px 0;">Top Flag 排名（仅显示有数据客户端）</h4><div class="table-wrap"><table><thead><tr><th>客户端标识</th><th>客户端名称</th><th>Flag触发(24h)</th><th>Flag触发(30天)</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderUaRawDetails(rows) {
  if (!rows || !rows.length) {
    return '<h4 style="margin:8px 0;">原始UA明细（30天，不做归类）</h4><p style="color:#6b7280;">暂无数据</p>';
  }
  const body = rows.map((group) => {
    const uaRows = (group.ua_rows || []).map((ua) => `<div style="padding:2px 0;border-bottom:1px dashed #e5e7eb;">${ua.user_agent || '-'}</div>`).join('');
    const hit24Rows = (group.ua_rows || []).map((ua) => `<div style="padding:2px 0;border-bottom:1px dashed #e5e7eb;">${ua.hits_24h || 0}</div>`).join('');
    const hit30Rows = (group.ua_rows || []).map((ua) => `<div style="padding:2px 0;border-bottom:1px dashed #e5e7eb;">${ua.hits_30d || 0}</div>`).join('');
    return `<tr><td>${group.client_type || '-'}</td><td>${uaRows || '-'}</td><td>${hit24Rows || '-'}</td><td>${hit30Rows || '-'}</td></tr>`;
  }).join('');
  return `<h4 style="margin:8px 0;">原始UA明细（30天，不做归类）</h4><div class="table-wrap"><table><thead><tr><th>客户端标识</th><th>原始UA</th><th>UA订阅次数(24h)</th><th>UA订阅次数(30天)</th></tr></thead><tbody>${body}</tbody></table></div>`;
}


function renderRiskOverview(data) {
  const metrics = data.metrics || {};
  const active = metrics.active_users || {};
  const traffic = metrics.traffic || {};
  const risk = metrics.risk_result || {};

  const cards = [
    metricCell('活跃用户（去重用户 / hits）', {
      today: `${active.today?.users || 0} / ${active.today?.hits || 0}`,
      '7d': `${active['7d']?.users || 0} / ${active['7d']?.hits || 0}`,
      '30d': `${active['30d']?.users || 0} / ${active['30d']?.hits || 0}`,
    }),
    metricCell('上下行流量（上行 / 下行 / 总计）', {
      today: `${formatBytes(traffic.today?.up_bytes || 0)} / ${formatBytes(traffic.today?.down_bytes || 0)} / ${formatBytes(traffic.today?.total_bytes || 0)}`,
      '7d': `${formatBytes(traffic['7d']?.up_bytes || 0)} / ${formatBytes(traffic['7d']?.down_bytes || 0)} / ${formatBytes(traffic['7d']?.total_bytes || 0)}`,
      '30d': `${formatBytes(traffic['30d']?.up_bytes || 0)} / ${formatBytes(traffic['30d']?.down_bytes || 0)} / ${formatBytes(traffic['30d']?.total_bytes || 0)}`,
    }),
    metricCell('拦截结果（拦截hits / 拦截率）', {
      today: `${risk.today?.blocked_hits || 0} / ${risk.today?.blocked_rate || '0%'}`,
      '7d': `${risk['7d']?.blocked_hits || 0} / ${risk['7d']?.blocked_rate || '0%'}`,
      '30d': `${risk['30d']?.blocked_hits || 0} / ${risk['30d']?.blocked_rate || '0%'}`,
    }),
  ].join('');

  document.getElementById('result').innerHTML = `<div class="cards">${cards}</div>`
    + renderFlagClientRanking(data.flag_client_ranking || [])
    + renderUaRawDetails(data.ua_raw_details_30d || []);
}

async function fetchRiskOverview(btn) { setView(btn, '运维概览'); const data = await request('/risk/overview/fetch'); if (data) renderRiskOverview(data); }

function renderRiskSettings(data) {
  const interval = Number(data.connection_log_interval || 3600);
  const retentionDays = Number(data.connection_log_retention_days || 30);
  document.getElementById('result').innerHTML = `<div style="max-width:680px;display:flex;flex-direction:column;gap:10px;"><h4 style="margin:0;">连接日志配置</h4><label style="font-size:12px;color:#374151;">记录间隔（秒）</label><input id="risk_connection_log_interval" class="rule-input" type="number" min="60" max="86400" value="${interval}"><label style="font-size:12px;color:#374151;">连接日志保留时长（天）</label><input id="risk_connection_log_retention_days" class="rule-input" type="number" min="1" max="365" value="${retentionDays}"><div style="display:flex;gap:8px;align-items:center;"><button onclick="saveRiskSettings()">保存配置</button></div></div>`;
}
async function fetchRiskSettings(btn) { setView(btn, '风控参数配置'); const data = await request('/risk/settings/fetch'); if (data) renderRiskSettings(data); }
async function saveRiskSettings() {
  const data = await request('/risk/settings/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connection_log_interval: Number(document.getElementById('risk_connection_log_interval').value || 3600), connection_log_retention_days: Number(document.getElementById('risk_connection_log_retention_days').value || 30) }) });
  if (data) { alert('保存成功'); renderRiskSettings(data); }
}

function renderRuleEditor(rows) {
  currentRuleRows = rows || [];
  if (!currentRuleRows.length) return document.getElementById('result').innerHTML = '<p>暂无规则</p>';
  const body = currentRuleRows.map((rule, idx) => `<tr><td>${rule.rule_key || ''}</td><td>${rule.scene || ''}</td><td><input id="name_${idx}" class="rule-input" value="${String(rule.name || '').replace(/"/g, '&quot;')}"></td><td><input id="desc_${idx}" class="rule-input" value="${String(rule.description || '').replace(/"/g, '&quot;')}"></td><td><select id="risk_${idx}" class="rule-select"><option value="low" ${rule.risk_level==='low'?'selected':''}>低</option><option value="medium" ${rule.risk_level==='medium'?'selected':''}>中</option><option value="high" ${rule.risk_level==='high'?'selected':''}>高</option></select></td><td><select id="enabled_${idx}" class="rule-select"><option value="1" ${Number(rule.enabled)===1?'selected':''}>启用</option><option value="0" ${Number(rule.enabled)===0?'selected':''}>停用</option></select></td><td><input id="sort_${idx}" class="rule-input" type="number" value="${Number(rule.sort||0)}"></td><td><textarea id="thresholds_${idx}" class="rule-textarea">${JSON.stringify(rule.thresholds || {}, null, 2)}</textarea></td><td><button onclick="saveRule(${idx}, '${rule.rule_key || ''}')">保存</button></td></tr>`).join('');
  document.getElementById('result').innerHTML = `<div style="margin-bottom:8px;"><button onclick="saveAllRules()">批量保存全部规则</button><button onclick="resetRule('')">恢复全部默认规则</button></div><div class="table-wrap"><table><thead><tr><th>规则键</th><th>场景</th><th>名称</th><th>说明</th><th>等级</th><th>启用</th><th>排序</th><th>阈值</th><th>操作</th></tr></thead><tbody>${body}</tbody></table></div>`;
}
async function fetchRules(btn) { setView(btn, '风控规则配置'); const rows = await request('/risk/rule/fetch'); if (rows) renderRuleEditor(rows); }
function buildRulePayload(idx, ruleKey) {
  return { rule_key: ruleKey, name: document.getElementById(`name_${idx}`).value, description: document.getElementById(`desc_${idx}`).value, risk_level: document.getElementById(`risk_${idx}`).value, enabled: Number(document.getElementById(`enabled_${idx}`).value), sort: Number(document.getElementById(`sort_${idx}`).value || 0), thresholds: JSON.parse(document.getElementById(`thresholds_${idx}`).value || '{}') };
}
async function saveRule(idx, ruleKey) { const rows = await request('/risk/rule/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildRulePayload(idx, ruleKey)) }); if (rows) renderRuleEditor(rows); }
async function saveAllRules() { for (let i = 0; i < currentRuleRows.length; i++) { const rows = await request('/risk/rule/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildRulePayload(i, currentRuleRows[i].rule_key)) }); if (rows) currentRuleRows = rows; } renderRuleEditor(currentRuleRows); }
async function resetRule(ruleKey) { const rows = await request('/risk/rule/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ruleKey ? { rule_key: ruleKey } : {}) }); if (rows) renderRuleEditor(rows); }

function buildBlacklistRow(item = {}) {
  const rowId = item.id || '';
  const type = String(item.type || 'ip').toLowerCase();
  return `<tr><td>${rowId || '-'}</td><td><select id="blacklist_type_${rowId}" class="rule-select"><option value="ip" ${type==='ip'?'selected':''}>IP</option><option value="ua_hash" ${type==='ua_hash'?'selected':''}>UA</option></select></td><td><input id="blacklist_value_${rowId}" class="rule-input" value="${String(item.value || '').replace(/"/g, '&quot;')}"></td><td><input id="blacklist_ua_${rowId}" class="rule-input" value="${String(item.ua_raw || '').replace(/"/g, '&quot;')}"></td><td><input id="blacklist_remark_${rowId}" class="rule-input" value="${String(item.remark || '').replace(/"/g, '&quot;')}"></td><td><input id="blacklist_enabled_${rowId}" type="checkbox" ${Number(item.is_enabled) === 0 ? '' : 'checked'}></td><td><button onclick="saveBlacklist('${rowId}')">保存</button><button style="background:#dc2626;margin-left:6px;" onclick="deleteBlacklist('${rowId}')">删除</button></td></tr>`;
}

function renderBlacklistEditor(rows) {
  const body = (rows || []).map((item) => buildBlacklistRow(item)).join('');
  document.getElementById('result').innerHTML = `<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;"><button onclick="appendBlacklistForm()">新增黑名单</button></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>类型</th><th>值(IP/UA Hash)</th><th>UA原文(自动转Hash)</th><th>备注</th><th>启用</th><th>操作</th></tr></thead><tbody id="blacklist_table_body">${body}</tbody></table></div>`;
}

function appendBlacklistForm() {
  const tableBody = document.getElementById('blacklist_table_body');
  if (!tableBody) return;
  const tempId = `new_${Date.now()}`;
  const row = document.createElement('tr');
  row.id = `row_${tempId}`;
  row.innerHTML = `<td>新</td><td><select id="blacklist_type_${tempId}" class="rule-select"><option value="ip">IP</option><option value="ua_hash">UA</option></select></td><td><input id="blacklist_value_${tempId}" class="rule-input" placeholder="IP或UA Hash(可留空由UA原文自动计算)"></td><td><input id="blacklist_ua_${tempId}" class="rule-input" placeholder="可选：UA原文"></td><td><input id="blacklist_remark_${tempId}" class="rule-input" placeholder="备注"></td><td><input id="blacklist_enabled_${tempId}" type="checkbox" checked></td><td><button onclick="saveBlacklist('${tempId}')">保存</button><button style="background:#6b7280;margin-left:6px;" onclick="removeTempBlacklist('${tempId}')">取消</button></td>`;
  tableBody.prepend(row);
}

function removeTempBlacklist(tempId) {
  const row = document.getElementById(`row_${tempId}`);
  if (row) row.remove();
}

async function saveBlacklist(rowId) {
  const payload = {
    type: (document.getElementById(`blacklist_type_${rowId}`)?.value || 'ip').trim(),
    value: (document.getElementById(`blacklist_value_${rowId}`)?.value || '').trim(),
    ua_raw: (document.getElementById(`blacklist_ua_${rowId}`)?.value || '').trim(),
    remark: (document.getElementById(`blacklist_remark_${rowId}`)?.value || '').trim(),
    is_enabled: !!document.getElementById(`blacklist_enabled_${rowId}`)?.checked,
  };
  if (payload.type === 'ua_hash' && payload.ua_raw) {
    payload.value = '';
  }
  if (payload.type === 'ip' && !payload.value) {
    alert('IP黑名单值不能为空');
    return;
  }
  if (payload.type === 'ua_hash' && !payload.value && !payload.ua_raw) {
    alert('UA黑名单请填写UA原文或Hash');
    return;
  }
  const rows = await request('/risk/blacklist/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (rows) renderBlacklistEditor(rows);
}

async function deleteBlacklist(id) {
  if (!id || String(id).startsWith('new_')) {
    removeTempBlacklist(id);
    return;
  }
  if (!confirm('确定删除该黑名单记录吗？')) return;
  const rows = await request('/risk/blacklist/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (rows) renderBlacklistEditor(rows);
}

async function fetchBlacklists(btn) { setView(btn, '风控黑名单'); const rows = await request('/risk/blacklist/fetch'); if (rows) renderBlacklistEditor(rows); }

function applyOnlineUsersFilter(){ riskFilters.onlineUsers.email = document.getElementById('f_online_email').value.trim(); riskFilters.onlineUsers.ip = document.getElementById('f_online_ip').value.trim(); fetchOnlineUsers(null, 1); }
function resetOnlineUsersFilter(){ riskFilters.onlineUsers = { email:'', ip:'' }; fetchOnlineUsers(null, 1); }
async function fetchOnlineUsers(btn, current = 1, pageSize = 200) {
  setView(btn, '实时在线IP');
  const bar = buildFilterBar([{ id:'f_online_email', placeholder:'邮箱(前端过滤)', value:riskFilters.onlineUsers.email },{ id:'f_online_ip', placeholder:'在线IP(前端过滤)', value:riskFilters.onlineUsers.ip }], 'applyOnlineUsersFilter', 'resetOnlineUsersFilter');
  const { rows, total } = await requestWithMeta(`/risk/online-user/fetch?page_size=${pageSize}&current=${current}`);
  const filtered = rows.filter(r => (!riskFilters.onlineUsers.email || String(r.email || '').includes(riskFilters.onlineUsers.email)) && (!riskFilters.onlineUsers.ip || String(r.online_ip || '').includes(riskFilters.onlineUsers.ip)));
  renderTable(filtered, buildPager(current, pageSize, total, 'fetchOnlineUsersPage'), { hiddenKeys: ['created_at', 'updated_at'], topHtml: bar });
}
function fetchOnlineUsersPage(current, pageSize){ fetchOnlineUsers(null, current, pageSize); }

function applyUserUsageFilter(){ riskFilters.userUsage.email = document.getElementById('f_usage_email').value.trim(); fetchUserUsage(null, 1); }
function resetUserUsageFilter(){ riskFilters.userUsage = { email:'' }; fetchUserUsage(null, 1); }
async function fetchUserUsage(btn, current = 1, pageSize = 200) {
  setView(btn, '用户画像总览');
  const bar = buildFilterBar([{ id:'f_usage_email', placeholder:'邮箱', value:riskFilters.userUsage.email }], 'applyUserUsageFilter', 'resetUserUsageFilter');
  const { rows, total } = await requestWithMeta(`/risk/user-usage/fetch?page_size=${pageSize}&current=${current}${toQuery(riskFilters.userUsage)}`);
  renderTable(rows, buildPager(current, pageSize, total, 'fetchUserUsagePage'), { hiddenKeys: ['created_at', 'updated_at'], topHtml: bar });
}
function fetchUserUsagePage(current, pageSize){ fetchUserUsage(null, current, pageSize); }

Object.assign(window.CenterActions, {
  overview: () => fetchRiskOverview(null),
  settings: () => fetchRiskSettings(null),
  rules: () => fetchRules(null),
  blacklist: () => fetchBlacklists(null),
  online: () => fetchOnlineUsers(null),
  profile: () => fetchUserUsage(null),
});
