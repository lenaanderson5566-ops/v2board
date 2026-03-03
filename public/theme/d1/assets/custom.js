(function () {
  const API_PATH = '/api/v1/user/getSubscribe';
  const PANEL_ID = 'quota-dashboard-panel';

  function findToken() {
    const keys = ['token', 'TOKEN', 'user_token', 'v2board_token', 'auth_data'];
    for (const key of keys) {
      const value = localStorage.getItem(key);
      if (!value) continue;
      if (key === 'auth_data') {
        try {
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed.token === 'string' && parsed.token) return parsed.token;
        } catch (e) {}
      }
      if (typeof value === 'string' && value.length > 10) return value;
    }
    return null;
  }

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
      <section style="margin:16px 0;padding:16px;border-radius:10px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.06);">
        <h3 style="margin:0 0 12px 0;font-size:16px;color:#111827;">流量看板（订阅 + 流量包）</h3>
        <div style="display:grid;gap:12px;">
          <div>
            <div style="display:flex;justify-content:space-between;font-size:13px;color:#374151;">
              <span>套餐月流量使用</span><span>${formatBytes(subUsed)} / ${formatBytes(subTotal)} (${subPercent.toFixed(1)}%)</span>
            </div>
            ${progressBar(subPercent)}
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:13px;color:#374151;">
              <span>流量额度包状态</span><span>${hasPackage ? '已购买' : '未购买'}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:13px;color:#6b7280;margin-top:6px;">
              <span>剩余流量包</span><span>${formatBytes(pkgRemain)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:13px;color:#6b7280;">
              <span>累计使用 / 累计购买</span><span>${formatBytes(pkgUsed)} / ${formatBytes(pkgTotal)} (${pkgPercent.toFixed(1)}%)</span>
            </div>
            ${progressBar(pkgPercent)}
          </div>
        </div>
      </section>
    `;
  }

  function mountPanel(html) {
    const root = document.querySelector('#root');
    if (!root) return;

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.style.maxWidth = '1200px';
      panel.style.margin = '0 auto';
      root.prepend(panel);
    }
    panel.innerHTML = html;
  }

  async function load() {
    const token = findToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const resp = await fetch(API_PATH, { credentials: 'include', headers });
    if (!resp.ok) return;
    const result = await resp.json();
    if (!result || !result.data) return;
    mountPanel(buildPanel(result.data));
  }

  let retries = 0;
  const timer = setInterval(async function () {
    retries += 1;
    try {
      await load();
      clearInterval(timer);
    } catch (e) {
      if (retries > 10) clearInterval(timer);
    }
  }, 1200);
})();
