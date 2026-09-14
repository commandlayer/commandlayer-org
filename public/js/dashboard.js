(() => {
  const endpoint = '/api/dashboard/evidence';
  const serviceIds = ['compareagent', 'documentagent', 'parseagent', 'monitoragent', 'trackagent'];
  let selectedWindow = '30d';
  const number = (value) => new Intl.NumberFormat().format(Number(value || 0));
  const usdc = (atomic, currency) => currency === 'USDC' ? '$' + (Number(atomic || 0) / 1000000).toFixed(2) : number(atomic) + ' atomic';
  const setText = (selector, value) => { const node = document.querySelector(selector); if (node) node.textContent = value; };

  function renderTrend(items) {
    const target = document.querySelector('[data-trend]');
    if (!target) return;
    target.textContent = '';
    if (!items || items.length === 0) {
      target.textContent = 'No confirmed activity in this period.';
      return;
    }
    const max = Math.max(...items.map((item) => Number(item.paid_executions || 0)), 1);
    for (const item of items) {
      const bar = document.createElement('div');
      bar.className = 'trend-bar';
      bar.title = item.day + ': ' + number(item.paid_executions) + ' paid';
      bar.style.height = Math.max(8, Math.round(Number(item.paid_executions || 0) / max * 100)) + '%';
      target.appendChild(bar);
    }
  }

  function renderRecent(items) {
    const body = document.querySelector('[data-recent-body]');
    const empty = document.querySelector('[data-empty-state]');
    if (!body) return;
    body.textContent = '';
    if (!items || items.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    for (const item of items) {
      const row = document.createElement('tr');
      row.innerHTML = '<td>' + item.service_id + '</td><td>' + item.outcome + '</td><td>' + usdc(item.amount_atomic, item.currency) + '</td><td>' + (item.evidence_covered ? 'covered' : 'not covered') + '</td><td>' + new Date(item.created_at).toLocaleString() + '</td>';
      body.appendChild(row);
    }
  }

  async function refresh() {
    try {
      const response = await fetch(endpoint + '?window=' + encodeURIComponent(selectedWindow), { headers: { Accept: 'application/json' } });
      const data = await response.json();
      const live = data.status === 'LIVE';
      setText('[data-dashboard-status]', live ? 'LIVE DATA' : (data.status || 'DATA SOURCE UNAVAILABLE'));
      setText('[data-dashboard-status-copy]', live ? 'Aggregates refreshed from confirmed evidence events.' : 'No confirmed activity is available yet. The dashboard will update automatically.');
      setText('[data-total-paid]', live ? number(data.totals.paid_executions) : '—');
      setText('[data-total-settled]', live ? usdc(data.totals.settled_amount_atomic, data.totals.currency) : '—');
      setText('[data-total-payers]', live ? number(data.totals.distinct_payers) : '—');
      setText('[data-total-related]', live ? number(data.totals.self_related_executions) : '—');
      setText('[data-total-evidence]', live ? number(data.totals.evidence_covered_executions) : '—');
      setText('[data-window-label]', selectedWindow);
      const services = new Map((data.services || []).map((item) => [item.service_id, item]));
      for (const id of serviceIds) {
        const item = services.get(id) || {};
        const row = document.querySelector('[data-service="' + id + '"]');
        if (!row) continue;
        const state = live && Number(item.paid_executions || 0) > 0 ? 'observed' : (live ? 'no confirmed events' : 'awaiting data');
        const badge = row.querySelector('[data-service-state]');
        if (badge) badge.textContent = state;
        const metric = row.querySelector('[data-service-metric]');
        if (metric) metric.textContent = live ? number(item.paid_executions) + ' paid · ' + number(item.passed) + ' passed' : 'No confirmed activity';
      }
      renderTrend(data.trend);
      renderRecent(data.recent);
      const empty = document.querySelector('[data-empty-state]');
      if (empty && live && (!data.recent || data.recent.length === 0)) empty.hidden = false;
    } catch (error) {
      setText('[data-dashboard-status]', 'DATA SOURCE UNAVAILABLE');
      setText('[data-dashboard-status-copy]', 'The dashboard could not reach its evidence data source.');
      renderTrend([]);
      renderRecent([]);
    }
  }

  document.querySelectorAll('[data-window]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedWindow = button.getAttribute('data-window');
      document.querySelectorAll('[data-window]').forEach((item) => item.classList.toggle('active', item === button));
      refresh();
    });
  });
  refresh();
  window.setInterval(refresh, 60000);
})();
