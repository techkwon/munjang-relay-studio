-- Sites D1 already received these additive columns during the pre-release schema provision.
-- Fresh databases receive them from 0000; this marker keeps the deployed migration id stable.
SELECT 1;
