(function () {
  const PANEL_ID = 'quota-dashboard-panel';
  const MAX_TRIES = 120;
  const INTERVAL_MS = 1000;
  let timer = null;
  let tries = 0;

  function formatBytes(bytes) {
    const num = Number(bytes || 0);
    if (!Number.isFinite(num) || num <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let value = num;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx++;
    }
    return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[idx]}`;
  }

  function ratio(used, total) {
    const t = Number(total || 0);
    const u = Number(used || 0);
    if (t <= 0) return 0;
    return Math.max(0, Math.min(100, (u / t) * 100));
  }

  function progressBar(percent) {
    return `<div style="background:#e5e7eb;border-radius:999px;height:8px;overflow:hidden;"><div style="width:${percent.toFixed(2)}%;height:100%;background:#2563eb;"></div></div>`;
  }

  function buildPanel(data) {
    const subUsed = Number(data.subscription_quota_used_bytes || 0);
    const subTotal = Number(data.subscription_quota_total_bytes || 0);
    const pkgUsed = Number(data.quota_package_used_bytes || 0);
    const pkgTotal = Number(data.quota_package_total_bytes || 0);
    const pkgRemain = Number(data.quota_package_remaining_bytes || 0);
    const hasPackage = Number(data.has_quota_package || 0) === 1;

    const subPercent = ratio(subUsed, subTotal);
    const pkgPercent = ratio(pkgUsed, pkgTotal);

    return `
      <section style="padding:14px;border-radius:10px;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.1);border:1px solid #e5e7eb;min-width:320px;max-width:380px;">
        <h3 style="margin:0 0 10px 0;font-size:14px;color:#111827;">流量看板（订阅 + 流量包）</h3>
        <div style="display:grid;gap:10px;">
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#374151;">
              <span>套餐月流量使用</span><span>${formatBytes(subUsed)} / ${formatBytes(subTotal)} (${subPercent.toFixed(1)}%)</span>
            </div>
            ${progressBar(subPercent)}
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#374151;">
              <span>流量额度包状态</span><span>${hasPackage ? '已购买' : '未购买'}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#6b7280;margin-top:4px;">
              <span>剩余流量包</span><span>${formatBytes(pkgRemain)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#6b7280;">
              <span>累计使用 / 累计购买</span><span>${formatBytes(pkgUsed)} / ${formatBytes(pkgTotal)} (${pkgPercent.toFixed(1)}%)</span>
            </div>
            ${progressBar(pkgPercent)}
          </div>
        </div>
      </section>
    `;
  }

  function mountPanel(html) {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.style.position = 'fixed';
      panel.style.right = '16px';
      panel.style.bottom = '16px';
      panel.style.zIndex = '9999';
      document.body.appendChild(panel);
    }
    panel.innerHTML = html;
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

  function tick() {
    tries += 1;
    const data = getSubscribeFromStore();
    if (data) {
      mountPanel(buildPanel(data));
    }
    if (tries >= MAX_TRIES && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  // 仅消费前端现有 store 数据，不拦截/不发起任何网络请求。
  timer = setInterval(tick, INTERVAL_MS);
  tick();
})();
