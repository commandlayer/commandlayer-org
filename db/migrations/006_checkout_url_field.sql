alter table claim_payments
  add column if not exists checkout_url text,
  add column if not exists provider_payment_id text,
  add column if not exists updated_at timestamptz;
