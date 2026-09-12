-- SOCIAL BID — make the legacy pre-website-only payouts eligible for release.
--
-- These rows were created before the website-only switch, so they never got a
-- `first_verified_at` timestamp and the release sweep skips them with
-- "never_activated". Their sponsorships were fulfilled on the site, so we mark
-- them verified as of their creation time and let the normal hold rules pass.
-- Safe to run repeatedly: it only touches rows still missing first_verified_at.

update public.payouts p
set
  first_verified_at = coalesce(p.first_verified_at, p.created_at),
  hold_until = least(coalesce(p.hold_until, now()), now()),
  release_at = least(coalesce(p.release_at, now()), now()),
  payout_status = 'eligible',
  status = 'pending',
  last_error = null
from public.payments pay
where pay.id = p.payment_id
  and p.first_verified_at is null
  and p.status in ('pending', 'blocked')
  and pay.status = 'applied'
  and coalesce(pay.refund_status, 'none') = 'none';

-- Also clear the stale "ownership_missing" error left by the old payout query
-- so those rows retry cleanly on the next sweep.
update public.payouts
set status = 'pending', payout_status = 'eligible', last_error = null
where status = 'blocked'
  and last_error like 'ownership_missing%';
