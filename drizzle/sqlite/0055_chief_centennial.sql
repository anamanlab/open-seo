-- Fork compatibility: retain the legacy audit detail columns during upgrades.
-- The current app ignores them; preserving them keeps historical data and
-- allows the previous app version to read its audit records on rollback.
SELECT 1;
