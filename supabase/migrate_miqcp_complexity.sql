-- Migration: Guide MIQCP complexity/fee calculator (Proposals + Tenders)
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS miqcp_assessment TEXT;

ALTER TABLE tenders ADD COLUMN IF NOT EXISTS complexity_rate NUMERIC;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS base_fee_percent NUMERIC;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS miqcp_assessment TEXT;
