(function () {
  const PANEL_ID = 'quota-dashboard-panel-inline';
  const MAX_TRIES = 180;
  const INTERVAL_MS = 1000;
  let timer = null;
  let tries = 0;

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

  function ratio(used, total) {
    const t = Number(total || 0);
    const u = Number(used || 0);
    if (t <= 0) return 0;
    return Math.max(0, Math.min(100, (u / t) * 100));
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

  function findSubscriptionContainer() {
    const root = document.getElementById('root') || document.body;
    const candidates = root.querySelectorAll('div,section,article');
    for (const node of candidates) {
      const text = (node.innerText || '').replace(/\s+/g, ' ');
      if (!text) continue;
      if (text.indexOf('我的订阅') !== -1 && text.indexOf('已用') !== -1 && text.indexOf('总计') !== -1) {
        return node;
      }
    }
    return null;
  }

  function buildHtml(data) {
    const packageTotal = Number(data.quota_package_total_bytes || 0);
    const packageUsed = Number(data.quota_package_used_bytes || 0);
    const packageRemain = Number(data.quota_package_remaining_bytes || 0);
    const hasPackage = Number(data.has_quota_package || 0) === 1;

    const subscriptionTotal = Number(data.subscription_quota_total_bytes || 0);
    const subscriptionUsed = Number(data.subscription_quota_used_bytes || 0);

    const packagePercent = ratio(packageUsed, packageTotal);
    const subPercent = ratio(subscriptionUsed, subscriptionTotal);

    return `
      <div style="margin-top:10px;padding:10px 12px;border:1px dashed #d1d5db;border-radius:8px;background:#f9fafb;">
        <div style="font-size:12px;color:#374151;line-height:1.7;">
          <div><strong>流量额度包：</strong>${hasPackage ? '已购买' : '未购买'}</div>
          <div>已用 ${formatBytes(packageUsed)} / 总计 ${formatBytes(packageTotal)} / 剩余 ${formatBytes(packageRemain)}（${packagePercent.toFixed(1)}%）</div>
          <div><strong>套餐月流量：</strong>已用 ${formatBytes(subscriptionUsed)} / 总计 ${formatBytes(subscriptionTotal)}（${subPercent.toFixed(1)}%）</div>
        </div>
      </div>
    `;
  }

  function renderIntoSubscriptionCard(data) {
    const container = findSubscriptionContainer();
    if (!container) return false;

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      container.appendChild(panel);
    } else if (panel.parentElement !== container) {
      container.appendChild(panel);
    }

    panel.innerHTML = buildHtml(data);
    return true;
  }

  function tick() {
    tries += 1;
    const data = getSubscribeFromStore();
    if (data) {
      renderIntoSubscriptionCard(data);
    }
    if (tries >= MAX_TRIES && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  // 仅消费前端现有 store 数据，不发起网络请求。
  timer = setInterval(tick, INTERVAL_MS);
  tick();
})();
