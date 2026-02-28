if (authorization) {
  const centerTitleMap = { all: '风控中心', risk: '风控中心', client: '客户端中心', logs: '日志中心', overview: '运维概览' };
  const centerTitleEl = document.getElementById('centerTitle');
  if (centerTitleEl) centerTitleEl.textContent = centerTitleMap[bootMode] || '风控中心';

  if (bootMode !== 'all') {
    document.querySelectorAll('.menu-section').forEach((sectionEl) => {
      const group = sectionEl.getAttribute('data-group');
      sectionEl.style.display = group === bootMode ? '' : 'none';
    });
    document.querySelectorAll('.menu-btn').forEach((btn) => {
      const section = btn.getAttribute('data-section') || 'risk';
      btn.style.display = (bootMode === 'overview') ? 'none' : (section === bootMode ? '' : 'none');
    });
  }

  document.querySelectorAll('.menu-section').forEach((sectionEl) => {
    const hasVisibleButton = Array.from(sectionEl.querySelectorAll('.menu-btn')).some((btn) => btn.style.display !== 'none');
    sectionEl.style.display = hasVisibleButton ? '' : 'none';
  });

  const section = new URLSearchParams(window.location.search).get('section');
  const defaultActions = {
    risk: 'settings',
    client: 'client_manage',
    logs: 'log_connection',
    overview: 'overview',
    all: 'settings',
  };
  const target = (section && window.CenterActions[section]) ? section : defaultActions[bootMode] || 'settings';
  if (window.CenterActions[target]) {
    window.CenterActions[target]();
  }
}
