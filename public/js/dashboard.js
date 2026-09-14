(() => {
  const endpoint = '/api/dashboard/evidence';
  const serviceIds = ['compareagent', 'documentagent', 'parseagent', 'monitoragent', 'trackagent'];

  const number = (value) => new Intl.NumberFormat().format(Number(value || 0));
  const usdc = (atomic, currency) => {
    if (currency !== 'USDC') return number(atomic) + ' atomic';
    return '$' + (Number(atomic || 0) / 1000000).toFixed(2);
  };
  const setText = (selector, value) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = value;
  };

  async function refresh() {
    try {
      const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
      const data = await response.json();
      const live = data.status === 'LIVE';
      setText('[data-dashboard-status]', live ? 'LIVE DATA' : 'DATA SOURCE NOT CONNECTED');
      setText('[data-dashboard-status-copy]', live ? 'Aggregates refreshed from confirmed evidence events.' : 'The dashboard is ready; connect the evidence database to show live activity.');
      setText('[data-total-paid]', number(data.totals && data.totals.paid_executions));
      setText('[data-total-settled]', usdc(data.totals && data.totals.settled_amount_atomic, data.totals && data.totals.currency));
      setText('[data-total-payers]', number(data.totals && data.totals.distinct_payers));
      setText('[data-total-related]', number(data.totals && data.totals.self_related_executions));
      setText('[data-total-evidence]', number(data.totals && data.totals.evidence_covered_executions));

      const services = new Map((data.services || []).map((item) => [item.service_id, item]));
      for (const id of serviceIds) {
        const item = services.get(id) || {};
        const row = document.querySelector('[data-service="' + id + '"]');
        if (!row) continue;
        const state = live && Number(item.paid_executions || 0) > 0 ? 'observed' : (live ? 'no confirmed events' : 'awaiting data');
        const badge = row.querySelector('[data-service-state]');
        if (badge) badge.textContent = state;
        const metric = row.querySelector('[data-service-metric]');
        if (metric) metric.textContent = live ? number(item.paid_executions) + ' paid · ' + number(item.passed) + ' passed' : 'No live events loaded';
      }
    } catch (error) {
      setText('[data-dashboard-status]', 'DATA SOURCE UNAVAILABLE');
      setText('[data-dashboard-status-copy]', 'The dashboard could not reach its evidence data source.');
    }
  }

  refresh();
  window.setInterval(refresh, 60000);
})();
