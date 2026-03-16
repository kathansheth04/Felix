-- Plan review now lives under IN_PROGRESS; migrate any PLAN_REVIEW tickets
UPDATE tickets SET status = 'IN_PROGRESS' WHERE status = 'PLAN_REVIEW';
