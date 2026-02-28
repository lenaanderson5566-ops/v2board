const apiBase = '/api/v1/{{ $api_path }}';
const adminPath = '/{{ config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key')))) }}';
const bootMode = '{{ $mode ?? 'all' }}';

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
  if (!rows || !rows.length) return '<p style="color:#6b7280;">暂无数据</p>';
  const hiddenKeys = new Set(options.hiddenKeys || []);
  const keys = Object.keys(rows[0]).filter(k => !hiddenKeys.has(k));
  const formatTs = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1000000000 || n > 4102444800) return v ?? '';
    const d = new Date(n * 1000); const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const formatCell = (k, v) => {
    if (v === null || typeof v === 'undefined') return '';
    if (typeof v === 'object') return JSON.stringify(v);
    if (/_at$/.test(k) || ['created_at', 'updated_at', 'connected_at'].includes(k)) return formatTs(v);
    return String(v);
  };
  const thead = '<tr>' + keys.map(k => `<th title="${k}">${k}</th>`).join('') + '</tr>';
  const body = rows.map((r, i) => `<tr style="background:${i % 2 ? '#fcfcfd' : '#fff'}">` + keys.map(k => `<td>${formatCell(k, r[k])}</td>`).join('') + '</tr>').join('');
  return `<div class="table-wrap"><table><thead>${thead}</thead><tbody>${body}</tbody></table></div>`;
}

function renderTable(rows, pagerHtml = '', options = {}) {
  document.getElementById('result').innerHTML = `${options.topHtml || ''}${pagerHtml}${buildTable(rows, options)}${pagerHtml}${options.bottomHtml || ''}`;
}

function buildPager(current, pageSize, total, fetcherName) {
  if (!total || total <= pageSize) return '';
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safeCurrent = Math.min(Math.max(1, current), pages);
  return `<div class="pager"><button ${safeCurrent <= 1 ? 'disabled' : ''} onclick="${fetcherName}(${safeCurrent - 1}, ${pageSize})">上一页</button><button ${safeCurrent >= pages ? 'disabled' : ''} onclick="${fetcherName}(${safeCurrent + 1}, ${pageSize})">下一页</button><span class="muted">第 ${safeCurrent}/${pages} 页，共 ${total} 条</span></div>`;
}

function setView(btn, title) {
  const titleEl = document.getElementById('viewTitle');
  if (titleEl) titleEl.textContent = `当前模块：${title}`;
  document.querySelectorAll('.menu-btn').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function toQuery(params) {
  const usp = new URLSearchParams();
  Object.keys(params || {}).forEach((k) => {
    const v = params[k];
    if (v !== null && v !== undefined && String(v) !== '') usp.set(k, String(v));
  });
  const q = usp.toString();
  return q ? `&${q}` : '';
}

function buildFilterBar(items, applyFn, resetFn) {
  return `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px;">`
    + items.map(i => `<input id="${i.id}" class="rule-input" style="width:180px;" placeholder="${i.placeholder}" value="${String(i.value || '').replace(/"/g, '&quot;')}">`).join('')
    + `<button onclick="${applyFn}()">筛选</button><button onclick="${resetFn}()">重置</button></div>`;
}

async function request(path, options = {}) {
  if (!authorization) { alert('未检测到登录态，请先登录管理员后台'); return null; }
  const headers = Object.assign({ 'Authorization': authorization }, options.headers || {});
  const res = await fetch(apiBase + path, Object.assign({}, options, { headers }));
  const data = await res.json();
  if (!res.ok) { alert(data.message || '请求失败'); return null; }
  return data.data || [];
}

async function requestWithMeta(path, options = {}) {
  if (!authorization) return { rows: [], total: 0 };
  const headers = Object.assign({ 'Authorization': authorization }, options.headers || {});
  const res = await fetch(apiBase + path, Object.assign({}, options, { headers }));
  const payload = await res.json();
  if (!res.ok) { alert(payload.message || '请求失败'); return { rows: [], total: 0 }; }
  return { rows: payload.data || [], total: payload.total || 0 };
}
window.CenterActions = window.CenterActions || {};
