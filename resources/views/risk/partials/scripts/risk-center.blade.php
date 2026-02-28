let currentRuleRows = [];
const riskFilters = { onlineUsers: { email: '', ip: '' }, userUsage: { email: '' } };


function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function renderTopTable(title, rows, keyName = 'name') {
  if (!rows || !rows.length) return `<h4 style="margin:8px 0;">${title}</h4><p style="color:#6b7280;">暂无数据</p>`;
  const body = rows.map((r) => `<tr><td>${r[keyName] || r.flag || r.user_agent || '-'}</td><td>${r.hits || 0}</td><td>${r.users || 0}</td><td>${r.ips || 0}</td></tr>`).join('');
  return `<h4 style="margin:8px 0;">${title}</h4><div class="table-wrap"><table><thead><tr><th>项</th><th>次数(hits)</th><th>去重用户</th><th>去重IP</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderRiskOverview(data) {
  const windows = data.windows || {};
  const order = ['today', '7d', '30d'];
  const blocks = order.map((k) => {
    const w = windows[k] || {};
    const active = w.active_users || {};
    const traffic = w.traffic || {};
    const risk = w.risk_result || {};
    return `<div class="card"><div class="label">${w.label || k}</div><div class="value">活跃用户 ${active.users || 0}</div><div style="font-size:12px;color:#6b7280;">请求 ${active.hits || 0} · 总流量 ${formatBytes(traffic.total_bytes || 0)} · 拦截率 ${risk.blocked_rate || '0%'}</div></div>`;
  }).join('');

  const today = windows['today'] || {};
  document.getElementById('result').innerHTML = `<div class="cards">${blocks}</div>`
    + renderTopTable('Top 原始 UA（当日）', today.ua_top || [], 'user_agent')
    + renderTopTable('Top Flag（当日）', today.flag_top || [], 'flag');
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

function renderBlacklistEditor(rows) {
  const body = (rows || []).map((item) => `<tr><td>${item.id || ''}</td><td>${item.type || ''}</td><td>${item.value || ''}</td><td>${item.remark || ''}</td></tr>`).join('');
  document.getElementById('result').innerHTML = `<div class="table-wrap"><table><thead><tr><th>ID</th><th>类型</th><th>值</th><th>备注</th></tr></thead><tbody>${body}</tbody></table></div>`;
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
