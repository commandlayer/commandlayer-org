(() => {
  const root = document.querySelector('[data-agent-profile]');
  if (!root) return;
  const id = root.dataset.agentProfile;
  const money = (atomic) => '$' + (Number(atomic || 0) / 1000000).toFixed(2);
  const integer = (value) => new Intl.NumberFormat().format(Number(value || 0));
  const set = (name, value) => { const node = document.querySelector('[data-agent-' + name + ']'); if (node) node.textContent = value; };
  const render = (data) => {
    const service = (data.services || []).find((item) => item.service_id === id);
    if (!service) return;
    const paid = Number(service.paid_executions || 0);
    const passed = Number(service.passed || 0);
    const covered = Number(service.evidence_covered_executions || 0);
    set('status', paid ? 'OBSERVED' : 'AWAITING CONFIRMED EVENTS');
    set('paid', integer(paid));
    set('passed', integer(passed));
    set('success', paid ? Math.round(passed / paid * 100) + '%' : '—');
    set('evidence', paid ? Math.round(covered / paid * 100) + '%' : '—');
    set('settled', money(service.settled_amount_atomic));
    set('window', data.window || '30d');
    const empty = document.querySelector('[data-agent-empty]');
    if (empty) empty.hidden = paid > 0;
  };
  fetch('/api/dashboard/evidence?window=30d', { headers: { Accept: 'application/json' } })
    .then((response) => response.json()).then(render)
    .catch(() => { set('status', 'DATA SOURCE UNAVAILABLE'); });
})();