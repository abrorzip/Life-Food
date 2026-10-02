CREATE TABLE IF NOT EXISTS profiles (
  telegram_user_id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  surname TEXT NOT NULL,
  phone TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  telegram_user_id BIGINT,
  name TEXT,
  surname TEXT,
  phone TEXT,
  recipient_phone TEXT,
  for_who TEXT NOT NULL,
  goal TEXT NOT NULL,
  calories TEXT NOT NULL,
  meal TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  table_number TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  payment TEXT NOT NULL DEFAULT 'card',
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_telegram_user_id ON orders(telegram_user_id);
