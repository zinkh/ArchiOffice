-- PV d'OPR en marché public (EXE4, EXE5) : mentions propres au public (portée de la
-- réception, prestations concernées, maître d'œuvre soussigné, référence du marché).
-- Additive : une ligne existante garde NULL.

ALTER TABLE receptions ADD COLUMN IF NOT EXISTS public_info JSONB;
