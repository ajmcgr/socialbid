-- SOCIAL BID — repair: the ownerships.placement_end_reason column from
-- 0007_ownership_transitions.sql is missing in production, which made every
-- payout read fail and report "ownership_missing". Safe to run repeatedly.

alter table public.ownerships
  add column if not exists placement_end_reason text;

update public.ownerships
set placement_end_reason = 'outbid'
where placement_end_reason is null
  and status <> 'active';
