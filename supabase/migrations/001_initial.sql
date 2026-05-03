-- Respondfall initial schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  business_name TEXT NOT NULL,
  business_phone TEXT NOT NULL,
  twilio_number TEXT,
  owner_email TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'starter' CHECK (tier IN ('starter','pro','agency')),
  booking_link TEXT,
  google_review_link TEXT,
  sms_template TEXT NOT NULL DEFAULT 'Hi! This is {business_name} — you just tried to reach us but we missed your call. Reply here or book at {booking_link}. Reply STOP to opt out.',
  sms_blackout_start TEXT NOT NULL DEFAULT '22:00',
  sms_blackout_end TEXT NOT NULL DEFAULT '07:00',
  job_value INTEGER NOT NULL DEFAULT 300,
  system_active BOOLEAN NOT NULL DEFAULT true,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '15 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS missed_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  caller_phone TEXT NOT NULL,
  twilio_number TEXT,
  called_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sequence_started BOOLEAN NOT NULL DEFAULT false,
  sequence_started_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  from_phone TEXT NOT NULL,
  to_phone TEXT NOT NULL,
  body TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  ai_generated BOOLEAN NOT NULL DEFAULT false,
  opted_out BOOLEAN NOT NULL DEFAULT false,
  twilio_sid TEXT,
  sequence_step INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  referrer_phone TEXT NOT NULL,
  referrer_name TEXT,
  ref_code TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'sms_sent' CHECK (status IN ('sms_sent','name_captured','code_issued','converted')),
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  to_phone TEXT NOT NULL,
  body TEXT NOT NULL,
  send_at TIMESTAMPTZ NOT NULL,
  sent BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMPTZ,
  sequence_step INTEGER,
  missed_call_id UUID REFERENCES missed_calls(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  actor TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_owner_id ON customers(owner_id);
CREATE INDEX IF NOT EXISTS idx_customers_twilio_number ON customers(twilio_number);
CREATE INDEX IF NOT EXISTS idx_missed_calls_customer_id ON missed_calls(customer_id);
CREATE INDEX IF NOT EXISTS idx_missed_calls_called_at ON missed_calls(called_at);
CREATE INDEX IF NOT EXISTS idx_sms_messages_customer_id ON sms_messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_created_at ON sms_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_send_at ON scheduled_messages(send_at) WHERE NOT sent;

CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE missed_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY customers_select ON customers FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY customers_insert ON customers FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY customers_update ON customers FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY customers_delete ON customers FOR DELETE USING (owner_id = auth.uid());

CREATE POLICY missed_calls_owner ON missed_calls FOR ALL
  USING (customer_id IN (SELECT id FROM customers WHERE owner_id = auth.uid()));
CREATE POLICY sms_messages_owner ON sms_messages FOR ALL
  USING (customer_id IN (SELECT id FROM customers WHERE owner_id = auth.uid()));
CREATE POLICY referrals_owner ON referrals FOR ALL
  USING (customer_id IN (SELECT id FROM customers WHERE owner_id = auth.uid()));
CREATE POLICY scheduled_messages_owner ON scheduled_messages FOR ALL
  USING (customer_id IN (SELECT id FROM customers WHERE owner_id = auth.uid()));
CREATE POLICY analytics_events_owner ON analytics_events FOR ALL
  USING (customer_id IN (SELECT id FROM customers WHERE owner_id = auth.uid()));
CREATE POLICY audit_log_owner ON audit_log FOR ALL
  USING (customer_id IN (SELECT id FROM customers WHERE owner_id = auth.uid()));
