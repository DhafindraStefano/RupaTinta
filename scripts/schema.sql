CREATE TABLE IF NOT EXISTS reservations (
  id              bigserial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  artist_slug     text NOT NULL,
  period          text NOT NULL,
  customer_name   text NOT NULL,
  whatsapp        text NOT NULL,
  commission_type text NOT NULL,
  brief           text NOT NULL,
  status          text NOT NULL DEFAULT 'Menunggu'
                  CHECK (status IN ('Menunggu', 'Dikerjakan', 'Selesai', 'Dibatalkan')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reservations_artist_period ON reservations (artist_slug, period, created_at);
