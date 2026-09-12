-- SOCIAL BID — periodic "connect your payout account" reminders.
-- Service-role only: the sweep runs from the payout cron, never from the client.

create table if not exists public.payout_setup_reminders (
  creator_id uuid primary key references public.creators(id) on delete cascade,
  last_sent_at timestamptz not null default now(),
  sent_count integer not null default 0
);

revoke all on public.payout_setup_reminders from public, anon, authenticated;
grant all on public.payout_setup_reminders to service_role;
alter table public.payout_setup_reminders enable row level security;
