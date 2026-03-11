(function () {
  const PANEL_ID = 'quota-dashboard-panel-inline';
  const TOGGLE_ID = 'quota-dashboard-toggle-btn';
  const BODY_ID = 'quota-dashboard-body';
  const COLLAPSE_KEY = 'quota_dashboard_collapsed';
  const MAX_TRIES = 180;
  const INTERVAL_MS = 1000;
  let timer = null;
  let tries = 0;
  let collapsed = false;

  function formatBytes(bytes) {
    const num = Number(bytes || 0);
    if (!Number.isFinite(num) || num <= 0) return '0.00 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let value = num;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx++;
    }
    return `${value.toFixed(2)} ${units[idx]}`;
  }


  function formatDate(ts) {
    const t = Number(ts || 0);
    if (!t) return '-';
    const d = new Date(t * 1000);
    if (Number.isNaN(d.getTime())) return '-';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
  }

  function ratio(used, total) {
    const t = Number(total || 0);
    const u = Number(used || 0);
    if (t <= 0) return 0;
    return Math.max(0, Math.min(100, (u / t) * 100));
  }

  function bar(percent, color) {
    return `<div style="height:8px;background:#eef2f7;border-radius:999px;overflow:hidden;"><div style="height:100%;width:${percent.toFixed(2)}%;background:${color};"></div></div>`;
  }

  function getSubscribeFromStore() {
    try {
      const app = window.g_app;
      const store = app && app._store;
      const state = store && store.getState && store.getState();
      const data = state && state.user && state.user.subscribe;
      if (data && typeof data === 'object' && Object.keys(data).length) {
        return data;
      }
    } catch (e) {}
    return null;
  }

  function getRoot() {
    return document.getElementById('root') || document.body;
  }





  function getSupportedLocaleList() {
    const i18n = (window.settings && window.settings.i18n) || {};
    if (Array.isArray(i18n)) return i18n.map((x) => String(x));
    if (i18n && typeof i18n === 'object') return Object.keys(i18n);
    return [];
  }

  function normalizeLocale(locale) {
    const raw = String(locale || '').trim().replace('_', '-');
    if (!raw) return '';
    return raw;
  }

  function matchSupportedLocale(locale) {
    const normalized = normalizeLocale(locale);
    if (!normalized) return '';

    const supported = getSupportedLocaleList();
    if (!supported.length) return normalized;

    const lowerMap = new Map(supported.map((x) => [String(x).toLowerCase(), x]));
    const direct = lowerMap.get(normalized.toLowerCase());
    if (direct) return direct;

    const langOnly = normalized.split('-')[0].toLowerCase();
    const fallback = supported.find((x) => String(x).toLowerCase().startsWith(langOnly + '-'));
    return fallback || '';
  }

  let persistingLanguage = false;
  function bindLanguagePersistence() {
    window.addEventListener('languagechange', function () {
      if (persistingLanguage) return;

      const locale = matchSupportedLocale(localStorage.getItem('umi_locale') || '');
      if (!locale) return;

      try {
        const app = window.g_app;
        const store = app && app._store;
        const state = store && store.getState && store.getState();
        const profileLocale = matchSupportedLocale(state && state.user && state.user.userInfo ? state.user.userInfo.language : '');
        if (profileLocale && profileLocale === locale) return;
        if (!store || typeof store.dispatch !== 'function') return;

        persistingLanguage = true;
        const dispatchResult = store.dispatch({
          type: 'user/update',
          key: 'language',
          value: locale
        });

        if (dispatchResult && typeof dispatchResult.finally === 'function') {
          dispatchResult.finally(function () {
            persistingLanguage = false;
          });
        } else {
          setTimeout(function () { persistingLanguage = false; }, 500);
        }
      } catch (e) {
        persistingLanguage = false;
      }
    });
  }

  function loadCollapsedState() {
    try {
      collapsed = localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch (e) {
      collapsed = false;
    }
  }

  function saveCollapsedState() {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch (e) {}
  }

  function toggleCollapsed() {
    collapsed = !collapsed;
    saveCollapsedState();
  }

  function buildHtml(data) {
    const totalUsed = Number(data.total_used_bytes || (Number(data.u || 0) + Number(data.d || 0)) || 0);
    const totalQuota = Number(data.transfer_enable || 0);
    const totalRemaining = Number(data.total_remaining_bytes || Math.max(totalQuota - totalUsed, 0));

    const subscriptionTotal = Number(data.subscription_quota_total_bytes || 0);
    const subscriptionUsed = Number(data.subscription_quota_used_bytes || 0);
    const subscriptionRemaining = Number(data.subscription_quota_remaining_bytes || Math.max(subscriptionTotal - subscriptionUsed, 0));

    const expiredAtText = formatDate(data.expired_at);
    const resetDay = data.reset_day === null || data.reset_day === undefined ? '-' : `${data.reset_day} 天后`;

    const packageTotal = Number(data.quota_package_total_bytes || 0);
    const packageUsed = Number(data.quota_package_used_bytes || 0);
    const packageRemain = Number(data.quota_package_remaining_bytes || Math.max(packageTotal - packageUsed, 0));
    const hasPackage = Number(data.has_quota_package || 0) === 1;

    const totalPercent = ratio(totalUsed, totalQuota);
    const subPercent = ratio(subscriptionUsed, subscriptionTotal);
    const packagePercent = ratio(packageUsed, packageTotal);

    return `
      <div style="padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#f8fafc;box-shadow:0 10px 20px rgba(15,23,42,.16);pointer-events:auto;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px;">
          <strong style="font-size:13px;color:#111827;">流量看板</strong>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:12px;color:${hasPackage ? '#059669' : '#6b7280'};">${hasPackage ? '已购买流量额度包' : '未购买流量额度包'}</span>
            <button id="${TOGGLE_ID}" style="border:1px solid #d1d5db;background:#fff;border-radius:6px;font-size:12px;padding:2px 8px;cursor:pointer;">${collapsed ? '展开' : '折叠'}</button>
          </div>
        </div>

        <div id="${BODY_ID}" style="display:${collapsed ? 'none' : 'block'};">
        <div style="margin-bottom:10px;padding:8px 10px;background:#fff;border:1px solid #edf2f7;border-radius:8px;font-size:12px;color:#4b5563;line-height:1.6;">
          <div>到期时间：${expiredAtText}</div>
          <div>重置时间：${resetDay}</div>
        </div>

        <div style="display:grid;gap:10px;">
          <div style="padding:10px;background:#fff;border:1px solid #edf2f7;border-radius:8px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#374151;margin-bottom:6px;">
              <span>总流量（套餐 + 流量包）</span>
              <span>${formatBytes(totalUsed)} / ${formatBytes(totalQuota)}（${totalPercent.toFixed(1)}%）</span>
            </div>
            ${bar(totalPercent, '#2563eb')}
            <div style="margin-top:6px;font-size:12px;color:#6b7280;">剩余 ${formatBytes(totalRemaining)}</div>
          </div>

          <div style="padding:10px;background:#fff;border:1px solid #edf2f7;border-radius:8px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#374151;margin-bottom:6px;">
              <span>套餐月流量</span>
              <span>${formatBytes(subscriptionUsed)} / ${formatBytes(subscriptionTotal)}（${subPercent.toFixed(1)}%）</span>
            </div>
            ${bar(subPercent, '#7c3aed')}
            <div style="margin-top:6px;font-size:12px;color:#6b7280;">剩余 ${formatBytes(subscriptionRemaining)}</div>
          </div>

          <div style="padding:10px;background:#fff;border:1px solid #edf2f7;border-radius:8px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#374151;margin-bottom:6px;">
              <span>流量额度包</span>
              <span>${formatBytes(packageUsed)} / ${formatBytes(packageTotal)}（${packagePercent.toFixed(1)}%）</span>
            </div>
            ${bar(packagePercent, '#f59e0b')}
            <div style="margin-top:6px;font-size:12px;color:#6b7280;">剩余 ${formatBytes(packageRemain)}</div>
          </div>
        </div>
        </div>
      </div>
    `;
  }

  function renderIntoSubscriptionCard(data) {
    const root = getRoot();

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.style.position = 'fixed';
      panel.style.right = '16px';
      panel.style.bottom = '16px';
      panel.style.zIndex = '99';
      panel.style.width = '360px';
      panel.style.maxWidth = 'calc(100vw - 32px)';
      panel.style.pointerEvents = 'none';
      document.body.appendChild(panel);
    }

    if (!panel.parentElement) {
      (document.body || root).appendChild(panel);
    }

    panel.innerHTML = buildHtml(data);

    const btn = panel.querySelector(`#${TOGGLE_ID}`);
    if (btn) {
      btn.onclick = function () {
        toggleCollapsed();
        panel.innerHTML = buildHtml(data);
      };
    }
    return true;
  }

  function tick() {
    tries += 1;

    const path = window.location && window.location.pathname ? window.location.pathname : '';
    if (path && path !== '/' && path !== '/dashboard') {
      return;
    }
    const data = getSubscribeFromStore();
    if (data) {
      renderIntoSubscriptionCard(data);
    }
    if (tries >= MAX_TRIES && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  // 基于现有 store 数据渲染右下角看板。
  loadCollapsedState();
  bindLanguagePersistence();
  timer = setInterval(tick, INTERVAL_MS);
  tick();
})();
