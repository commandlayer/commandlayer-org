-- Public dashboard evidence storage.
-- Store payer_key_hash, never a raw payer address, in this public aggregate source.
CREATE TABLE IF NOT EXISTS reputation_events (
  event_id text PRIMARY KEY,
  service_id text NOT NULL,
  service_version text NOT NULL,
  manifest_hash text NOT NULL,
  execution_id text NOT NULL UNIQUE,
  outcome text NOT NULL CHECK (outcome IN ('passed', 'partial', 'failed')),
  settlement_status text NOT NULL CHECK (settlement_status IN ('CONFIRMED', 'UNCONFIRMED')),
  amount_atomic numeric(78, 0) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USDC',
  payer_key_hash text NOT NULL,
  evidence_reference_count integer NOT NULL DEFAULT 0 CHECK (evidence_reference_count >= 0),
  related_party_status text NOT NULL DEFAULT 'NOT_ASSERTED'
    CHECK (related_party_status IN ('NOT_ASSERTED', 'NOT_RELATED', 'RELATED')),
  network text,
  transaction_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reputation_events_service_status_created_idx
  ON reputation_events (service_id, settlement_status, created_at DESC);

CREATE INDEX IF NOT EXISTS reputation_events_payer_key_hash_idx
  ON reputation_events (payer_key_hash);
