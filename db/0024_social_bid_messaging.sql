-- SOCIAL BID — permanent sponsorship-unlocked messaging and in-app notifications.
-- All data access is service-role only. Application server functions separately
-- verify an applied payment/ownership before returning or mutating a conversation.

alter table public.buyers
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create unique index if not exists social_bid_buyers_user_id_unique
  on public.buyers (user_id) where user_id is not null;

create table if not exists public.social_bid_conversations (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  buyer_id uuid not null references public.buyers(id) on delete cascade,
  unlocked_by_payment_id uuid not null references public.payments(id) on delete restrict,
  latest_sponsorship_payment_id uuid not null references public.payments(id) on delete restrict,
  creator_last_read_at timestamptz,
  sponsor_last_read_at timestamptz,
  blocked_by_creator_at timestamptz,
  blocked_by_sponsor_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (creator_id, buyer_id)
);

create index if not exists social_bid_conversations_buyer_idx
  on public.social_bid_conversations (buyer_id, updated_at desc);
create index if not exists social_bid_conversations_unlock_payment_idx
  on public.social_bid_conversations (unlocked_by_payment_id);
create index if not exists social_bid_conversations_latest_payment_idx
  on public.social_bid_conversations (latest_sponsorship_payment_id);

create table if not exists public.social_bid_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.social_bid_conversations(id) on delete cascade,
  sender_kind text not null check (sender_kind in ('creator', 'sponsor')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists social_bid_messages_conversation_created_idx
  on public.social_bid_messages (conversation_id, created_at desc);

create table if not exists public.social_bid_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_kind text not null check (recipient_kind in ('creator', 'sponsor')),
  creator_id uuid references public.creators(id) on delete cascade,
  buyer_id uuid references public.buyers(id) on delete cascade,
  notification_type text not null check (
    notification_type in ('NEW_SPONSOR', 'SPONSORSHIP_UNLOCKED', 'NEW_MESSAGE', 'OUTBID')
  ),
  conversation_id uuid references public.social_bid_conversations(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete cascade,
  message_id uuid references public.social_bid_messages(id) on delete cascade,
  title text not null,
  body text not null,
  event_key text not null unique,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (recipient_kind = 'creator' and creator_id is not null and buyer_id is null)
    or (recipient_kind = 'sponsor' and buyer_id is not null and creator_id is null)
  )
);

create index if not exists social_bid_notifications_creator_idx
  on public.social_bid_notifications (creator_id, created_at desc)
  where creator_id is not null;
create index if not exists social_bid_notifications_buyer_idx
  on public.social_bid_notifications (buyer_id, created_at desc)
  where buyer_id is not null;
create index if not exists social_bid_notifications_conversation_idx
  on public.social_bid_notifications (conversation_id);
create index if not exists social_bid_notifications_payment_idx
  on public.social_bid_notifications (payment_id);
create index if not exists social_bid_notifications_message_idx
  on public.social_bid_notifications (message_id);

create table if not exists public.social_bid_conversation_reports (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.social_bid_conversations(id) on delete cascade,
  reporter_kind text not null check (reporter_kind in ('creator', 'sponsor')),
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists social_bid_conversation_reports_conversation_idx
  on public.social_bid_conversation_reports (conversation_id, created_at desc);

revoke all on public.social_bid_conversations from public, anon, authenticated;
revoke all on public.social_bid_messages from public, anon, authenticated;
revoke all on public.social_bid_notifications from public, anon, authenticated;
revoke all on public.social_bid_conversation_reports from public, anon, authenticated;
grant all on public.social_bid_conversations to service_role;
grant all on public.social_bid_messages to service_role;
grant all on public.social_bid_notifications to service_role;
grant all on public.social_bid_conversation_reports to service_role;
alter table public.social_bid_conversations enable row level security;
alter table public.social_bid_messages enable row level security;
alter table public.social_bid_notifications enable row level security;
alter table public.social_bid_conversation_reports enable row level security;

-- A sponsorship is authoritative only when both the payment and its matching
-- ownership say it was applied. This trigger runs after that status transition,
-- so failed/created/paid-only checkouts can never unlock messaging.
create or replace function public.social_bid_unlock_sponsorship_connection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator_id uuid;
  v_ownership_id uuid;
  v_conversation_id uuid;
  v_previous_buyer_id uuid;
  v_creator_name text;
begin
  if new.status <> 'applied'
     or (tg_op = 'UPDATE' and old.status is not distinct from new.status) then
    return new;
  end if;

  begin
    if new.buyer_id is null then
      return new;
    end if;

  select l.creator_id, o.id, c.display_name
    into v_creator_id, v_ownership_id, v_creator_name
  from public.listings l
  join public.creators c on c.id = l.creator_id
  join public.ownerships o
    on o.payment_id = new.id
   and o.listing_id = new.listing_id
  where l.id = new.listing_id;

  if v_creator_id is null or v_ownership_id is null then
    raise exception 'applied Social Bid payment % has no matching ownership', new.id;
  end if;

  insert into public.social_bid_conversations (
    creator_id, buyer_id, unlocked_by_payment_id, latest_sponsorship_payment_id
  ) values (
    v_creator_id, new.buyer_id, new.id, new.id
  )
  on conflict (creator_id, buyer_id) do update
    set latest_sponsorship_payment_id = excluded.latest_sponsorship_payment_id,
        updated_at = now()
  returning id into v_conversation_id;

  insert into public.social_bid_notifications (
    recipient_kind, creator_id, notification_type, conversation_id, payment_id,
    title, body, event_key
  ) values (
    'creator', v_creator_id, 'NEW_SPONSOR', v_conversation_id, new.id,
    'New sponsor',
    new.company_name || ' sponsored your profile for $' ||
      trim(to_char(new.amount_cents / 100.0, 'FM999999990.00')) ||
      '. You can now message each other.',
    'payment:' || new.id || ':new-sponsor:creator:' || v_creator_id
  ) on conflict (event_key) do nothing;

  insert into public.social_bid_notifications (
    recipient_kind, buyer_id, notification_type, conversation_id, payment_id,
    title, body, event_key
  ) values (
    'sponsor', new.buyer_id, 'SPONSORSHIP_UNLOCKED', v_conversation_id, new.id,
    'Sponsorship unlocked',
    'You sponsored ' || v_creator_name || '. Direct messaging is now unlocked.',
    'payment:' || new.id || ':unlocked:sponsor:' || new.buyer_id
  ) on conflict (event_key) do nothing;

  select o.buyer_id into v_previous_buyer_id
  from public.ownerships o
  where o.listing_id = new.listing_id
    and o.status = 'ended'
    and o.buyer_id is not null
    and o.buyer_id <> new.buyer_id
    and o.ended_at is not null
    and o.ended_at >= new.updated_at - interval '1 second'
  order by o.ended_at desc
  limit 1;

    if v_previous_buyer_id is not null then
    insert into public.social_bid_notifications (
      recipient_kind, buyer_id, notification_type, conversation_id, payment_id,
      title, body, event_key
    )
    select
      'sponsor', v_previous_buyer_id, 'OUTBID', c.id, new.id,
      'Your sponsorship was outbid',
      'The public sponsor spot changed, but your conversation with ' || v_creator_name || ' remains open.',
      'payment:' || new.id || ':outbid:sponsor:' || v_previous_buyer_id
    from public.social_bid_conversations c
    where c.creator_id = v_creator_id and c.buyer_id = v_previous_buyer_id
    on conflict (event_key) do nothing;
    end if;
  exception when others then
    -- Messaging is non-financial. Never roll back a valid paid takeover if a
    -- notification/connection side effect fails; Inbox loading repairs the
    -- relationship from authoritative payment + ownership history.
    raise warning 'Social Bid messaging unlock failed for payment % (SQLSTATE %)', new.id, sqlstate;
  end;

  return new;
end;
$$;

revoke execute on function public.social_bid_unlock_sponsorship_connection() from public, anon, authenticated;

drop trigger if exists social_bid_payment_unlock_connection on public.payments;
create trigger social_bid_payment_unlock_connection
after insert or update of status on public.payments
for each row
when (new.status = 'applied')
execute function public.social_bid_unlock_sponsorship_connection();

-- Messages produce their recipient notification in the same transaction.
create or replace function public.social_bid_notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.social_bid_conversations%rowtype;
  v_sender_name text;
begin
  select * into v_conversation
  from public.social_bid_conversations
  where id = new.conversation_id;

  if new.sender_kind = 'creator' then
    select c.display_name into v_sender_name
    from public.creators c where c.id = v_conversation.creator_id;
    insert into public.social_bid_notifications (
      recipient_kind, buyer_id, notification_type, conversation_id, message_id,
      title, body, event_key
    ) values (
      'sponsor', v_conversation.buyer_id, 'NEW_MESSAGE', new.conversation_id, new.id,
      coalesce(v_sender_name, 'A creator') || ' sent you a message', left(new.body, 160),
      'message:' || new.id || ':sponsor:' || v_conversation.buyer_id
    ) on conflict (event_key) do nothing;
  else
    select b.company_name into v_sender_name
    from public.buyers b where b.id = v_conversation.buyer_id;
    insert into public.social_bid_notifications (
      recipient_kind, creator_id, notification_type, conversation_id, message_id,
      title, body, event_key
    ) values (
      'creator', v_conversation.creator_id, 'NEW_MESSAGE', new.conversation_id, new.id,
      coalesce(v_sender_name, 'A sponsor') || ' sent you a message', left(new.body, 160),
      'message:' || new.id || ':creator:' || v_conversation.creator_id
    ) on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function public.social_bid_notify_new_message() from public, anon, authenticated;

drop trigger if exists social_bid_message_notification on public.social_bid_messages;
create trigger social_bid_message_notification
after insert on public.social_bid_messages
for each row execute function public.social_bid_notify_new_message();

-- Existing valid sponsorships become permanent relationships without sending a
-- backlog of historical notifications.
insert into public.social_bid_conversations (
  creator_id, buyer_id, unlocked_by_payment_id, latest_sponsorship_payment_id,
  created_at, updated_at
)
select distinct on (l.creator_id, p.buyer_id)
  l.creator_id,
  p.buyer_id,
  first_value(p.id) over (
    partition by l.creator_id, p.buyer_id order by p.created_at asc, p.id asc
  ),
  first_value(p.id) over (
    partition by l.creator_id, p.buyer_id order by p.created_at desc, p.id desc
  ),
  min(p.created_at) over (partition by l.creator_id, p.buyer_id),
  max(p.updated_at) over (partition by l.creator_id, p.buyer_id)
from public.payments p
join public.listings l on l.id = p.listing_id
join public.ownerships o on o.payment_id = p.id and o.listing_id = p.listing_id
where p.status = 'applied'
  and p.buyer_id is not null
order by l.creator_id, p.buyer_id, p.created_at desc, p.id desc
on conflict (creator_id, buyer_id) do update
  set latest_sponsorship_payment_id = excluded.latest_sponsorship_payment_id,
      updated_at = greatest(public.social_bid_conversations.updated_at, excluded.updated_at);
