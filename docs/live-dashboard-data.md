# Live dashboard data

The public dashboard is at \`/dashboard\`. It reads confirmed records from \`reputation_events\` through \`/api/dashboard/evidence\`.

## Required server variables

- \`COMMANDLAYER_DASHBOARD_DATABASE_URL\`: pooled Neon connection string for runtime queries.
- \`COMMANDLAYER_DASHBOARD_INGEST_TOKEN\`: secret used by the settlement/receipt writer to post confirmed evidence.
- \`COMMANDLAYER_DASHBOARD_OPERATOR_TOKEN\`: secret used by the private operator view at \`/dashboard-operator.html\`.

Use separate Preview and Production values. Never use a public browser variable for these secrets.

## Recording an event

The writer should call \`POST /api/dashboard/ingest\` only after settlement and receipt verification succeed. The endpoint accepts one event and is idempotent on \`execution_id\`.

Required fields:

- \`service_id\`, \`service_version\`, \`manifest_hash\`, \`execution_id\`
- \`outcome\`: \`passed\`, \`partial\`, or \`failed\`
- \`settlement_status\`: \`CONFIRMED\`
- \`amount_atomic\`, \`currency\`, \`payer_key_hash\`
- \`evidence_reference_count\`

Optional fields include \`event_id\`, \`related_party_status\`, \`network\`, and \`transaction_hash\`. Raw payer addresses are not accepted or stored in this table.

## Public data contract

\`GET /api/dashboard/evidence?window=24h|7d|30d\` returns service aggregates, totals, a daily trend, and a small recent-activity list. It never returns payer hashes, transaction hashes, execution IDs, or other operator fields.
