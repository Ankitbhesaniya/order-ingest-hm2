-- This exact schema is applied to EVERY shard database.
-- Each shard is a fully independent Postgres database with the same
-- table structure - only the *rows* it holds differ, based on the
-- shard routing logic (hash of customer_id).

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

CREATE TABLE IF NOT EXISTS orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        VARCHAR(100) NOT NULL,
    customer_id     VARCHAR(100) NOT NULL,
    order_date      TIMESTAMPTZ NOT NULL,
    order_amount    NUMERIC(12, 2) NOT NULL,
    status          VARCHAR(50) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- order_id should be unique within a shard, and since customer_id
-- decides the shard, this is also effectively unique system-wide
-- for well-formed data.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_id ON orders (order_id);

-- Speeds up "get all orders for a customer" - the most common query.
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders (customer_id);

-- Speeds up date-range queries / reporting.
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders (order_date);


-- Rows that failed validation are recorded here instead of being
-- silently dropped, so nothing about a bad upload is lost.
CREATE TABLE IF NOT EXISTS failed_order_rows (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id       UUID NOT NULL,
    raw_row         JSONB NOT NULL,
    error_reason    TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
