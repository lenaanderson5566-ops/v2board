const logFilters = {
  ruleHits: { scene: '', rule_key: '', risk_level: '', email: '', ip: '' },
  connectionLogs: { user_id: '', ip: '' },
  loginLogs: { email: '', ip: '', is_success: '' },
  subscribeLogs: { email: '', ip: '', client_type: '', status: '' },
};

function applyRuleHitsFilter(){ logFilters.ruleHits.scene = document.getElementById('f_rule_scene').value.trim(); logFilters.ruleHits.rule_key = document.getElementById('f_rule_key').value.trim(); logFilters.ruleHits.risk_level = document.getElementById('f_rule_risk_level').value.trim(); logFilters.ruleHits.email = document.getElementById('f_rule_email').value.trim(); logFilters.ruleHits.ip = document.getElementById('f_rule_ip').value.trim(); fetchRuleHits(null, 1); }
function resetRuleHitsFilter(){ logFilters.ruleHits = { scene:'', rule_key:'', risk_level:'', email:'', ip:'' }; fetchRuleHits(null, 1); }
function applyConnectionLogsFilter(){ logFilters.connectionLogs.user_id = document.getElementById('f_conn_user_id').value.trim(); logFilters.connectionLogs.ip = document.getElementById('f_conn_ip').value.trim(); fetchUserConnectionLogs(null, 1); }
function resetConnectionLogsFilter(){ logFilters.connectionLogs = { user_id:'', ip:'' }; fetchUserConnectionLogs(null, 1); }
function applyLoginLogsFilter(){ logFilters.loginLogs.email = document.getElementById('f_login_email').value.trim(); logFilters.loginLogs.ip = document.getElementById('f_login_ip').value.trim(); logFilters.loginLogs.is_success = document.getElementById('f_login_success').value.trim(); fetchLoginLogs(null, 1); }
function resetLoginLogsFilter(){ logFilters.loginLogs = { email:'', ip:'', is_success:'' }; fetchLoginLogs(null, 1); }
function applySubscribeLogsFilter(){ logFilters.subscribeLogs.email = document.getElementById('f_sub_email').value.trim(); logFilters.subscribeLogs.ip = document.getElementById('f_sub_ip').value.trim(); logFilters.subscribeLogs.client_type = document.getElementById('f_sub_client').value.trim(); logFilters.subscribeLogs.status = document.getElementById('f_sub_status').value.trim(); fetchSubscribeLogs(null, 1); }
function resetSubscribeLogsFilter(){ logFilters.subscribeLogs = { email:'', ip:'', client_type:'', status:'' }; fetchSubscribeLogs(null, 1); }

function buildRuleHitFilterBar() {
  return `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px;"><select id="f_rule_scene" class="rule-select" style="width:180px;"><option value="" ${!logFilters.ruleHits.scene ? 'selected' : ''}>场景(全部)</option><option value="login" ${logFilters.ruleHits.scene === 'login' ? 'selected' : ''}>login</option><option value="subscribe" ${logFilters.ruleHits.scene === 'subscribe' ? 'selected' : ''}>subscribe</option></select><input id="f_rule_key" class="rule-input" style="width:220px;" placeholder="规则键(rule_key)" value="${String(logFilters.ruleHits.rule_key || '').replace(/"/g, '&quot;')}"><select id="f_rule_risk_level" class="rule-select" style="width:180px;"><option value="" ${!logFilters.ruleHits.risk_level ? 'selected' : ''}>风险等级(全部)</option><option value="high" ${logFilters.ruleHits.risk_level === 'high' ? 'selected' : ''}>high</option><option value="medium" ${logFilters.ruleHits.risk_level === 'medium' ? 'selected' : ''}>medium</option><option value="low" ${logFilters.ruleHits.risk_level === 'low' ? 'selected' : ''}>low</option></select><input id="f_rule_email" class="rule-input" style="width:220px;" placeholder="邮箱" value="${String(logFilters.ruleHits.email || '').replace(/"/g, '&quot;')}"><input id="f_rule_ip" class="rule-input" style="width:180px;" placeholder="IP" value="${String(logFilters.ruleHits.ip || '').replace(/"/g, '&quot;')}"><button onclick="applyRuleHitsFilter()">筛选</button><button onclick="resetRuleHitsFilter()">重置</button></div>`;
}

function renderRuleHitsTable(rows, pagerHtml, topHtml = '') { renderTable(rows, pagerHtml, { topHtml }); }
async function fetchRuleHits(btn, current = 1, pageSize = 50) { setView(btn, '命中日志'); const bar = buildRuleHitFilterBar(); const { rows, total } = await requestWithMeta(`/log/rule-hit/fetch?page_size=${pageSize}&current=${current}${toQuery(logFilters.ruleHits)}`); renderRuleHitsTable(rows, buildPager(current, pageSize, total, 'fetchRuleHitsPage'), bar); }
function fetchRuleHitsPage(current, pageSize){ fetchRuleHits(null, current, pageSize); }

async function fetchUserConnectionLogs(btn, current = 1, pageSize = 200) {
  setView(btn, '连接日志');
  const bar = buildFilterBar([{ id:'f_conn_user_id', placeholder:'用户ID', value:logFilters.connectionLogs.user_id }, { id:'f_conn_ip', placeholder:'IP', value:logFilters.connectionLogs.ip }], 'applyConnectionLogsFilter', 'resetConnectionLogsFilter');
  const { rows, total } = await requestWithMeta(`/log/user-connection/fetch?page_size=${pageSize}&current=${current}${toQuery(logFilters.connectionLogs)}`);
  renderTable(rows, buildPager(current, pageSize, total, 'fetchUserConnectionLogsPage'), { topHtml: bar });
}
function fetchUserConnectionLogsPage(current, pageSize){ fetchUserConnectionLogs(null, current, pageSize); }

async function fetchLoginLogs(btn, current = 1, pageSize = 50) {
  setView(btn, '登录日志');
  const bar = `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px;"><input id="f_login_email" class="rule-input" style="width:180px;" placeholder="邮箱" value="${String(logFilters.loginLogs.email || '').replace(/"/g, '&quot;')}"><input id="f_login_ip" class="rule-input" style="width:180px;" placeholder="IP" value="${String(logFilters.loginLogs.ip || '').replace(/"/g, '&quot;')}"><input id="f_login_success" class="rule-input" style="width:180px;" placeholder="成功状态(0/1)" value="${String(logFilters.loginLogs.is_success || '').replace(/"/g, '&quot;')}"><button onclick="applyLoginLogsFilter()">筛选</button><button onclick="resetLoginLogsFilter()">重置</button></div>`;
  const { rows, total } = await requestWithMeta(`/log/login/fetch?page_size=${pageSize}&current=${current}${toQuery(logFilters.loginLogs)}`);
  renderTable(rows, buildPager(current, pageSize, total, 'fetchLoginLogsPage'), { topHtml: bar });
}
function fetchLoginLogsPage(current, pageSize){ fetchLoginLogs(null, current, pageSize); }

async function fetchSubscribeLogs(btn, current = 1, pageSize = 50) {
  setView(btn, '订阅日志');
  const bar = buildFilterBar([{ id:'f_sub_email', placeholder:'邮箱', value:logFilters.subscribeLogs.email }, { id:'f_sub_ip', placeholder:'IP', value:logFilters.subscribeLogs.ip }, { id:'f_sub_client', placeholder:'客户端标识', value:logFilters.subscribeLogs.client_type }, { id:'f_sub_status', placeholder:'状态(success/failed)', value:logFilters.subscribeLogs.status }], 'applySubscribeLogsFilter', 'resetSubscribeLogsFilter');
  const { rows, total } = await requestWithMeta(`/log/subscribe/fetch?page_size=${pageSize}&current=${current}${toQuery(logFilters.subscribeLogs)}`);
  renderTable(rows, buildPager(current, pageSize, total, 'fetchSubscribeLogsPage'), { topHtml: bar });
}
function fetchSubscribeLogsPage(current, pageSize){ fetchSubscribeLogs(null, current, pageSize); }

Object.assign(window.CenterActions, {
  log_connection: () => fetchUserConnectionLogs(null),
  log_login: () => fetchLoginLogs(null),
  log_subscribe: () => fetchSubscribeLogs(null),
  log_hit: () => fetchRuleHits(null),
});
