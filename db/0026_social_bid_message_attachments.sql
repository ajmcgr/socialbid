-- SOCIAL BID — private image/PDF attachments for sponsorship conversations.
-- Files live in a private, Social Bid-specific Storage bucket. Application
-- server functions authorize participants before issuing signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'social-bid-message-attachments',
  'social-bid-message-attachments',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[];

alter table public.social_bid_messages
  add column if not exists has_attachments boolean not null default false,
  add column if not exists client_nonce uuid;

create unique index if not exists social_bid_messages_client_nonce_unique
  on public.social_bid_messages (client_nonce)
  where client_nonce is not null;

alter table public.social_bid_messages
  drop constraint if exists social_bid_messages_body_check;

alter table public.social_bid_messages
  add constraint social_bid_messages_body_check
  check (
    char_length(btrim(body)) between 1 and 2000
    or (body = '' and has_attachments)
  );

create table if not exists public.social_bid_message_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.social_bid_conversations(id) on delete cascade,
  message_id uuid references public.social_bid_messages(id) on delete cascade,
  uploader_kind text not null check (uploader_kind in ('creator', 'sponsor')),
  storage_path text not null unique,
  original_filename text not null check (
    char_length(original_filename) between 1 and 180
    and original_filename = btrim(original_filename)
  ),
  mime_type text not null check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  ),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  status text not null default 'pending' check (status in ('pending', 'verified', 'ready')),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (status in ('pending', 'verified') and message_id is null)
    or (status = 'ready' and message_id is not null and verified_at is not null)
  )
);

create index if not exists social_bid_message_attachments_conversation_idx
  on public.social_bid_message_attachments (conversation_id, created_at);
create index if not exists social_bid_message_attachments_message_idx
  on public.social_bid_message_attachments (message_id)
  where message_id is not null;
create index if not exists social_bid_message_attachments_pending_idx
  on public.social_bid_message_attachments (expires_at)
  where status <> 'ready';

revoke all on public.social_bid_message_attachments from public, anon, authenticated;
grant all on public.social_bid_message_attachments to service_role;
alter table public.social_bid_message_attachments enable row level security;

-- Message creation and attachment claiming happen in one database transaction.
-- The function is reachable only by the trusted service role after the app has
-- verified conversation membership, sponsorship entitlement, and file bytes.
create or replace function public.social_bid_send_message_with_attachments(
  p_conversation_id uuid,
  p_sender_kind text,
  p_body text,
  p_attachment_ids uuid[],
  p_client_nonce uuid
)
returns table (
  id uuid,
  sender_kind text,
  body text,
  created_at timestamptz
)
language plpgsql
set search_path = public
as $$
declare
  v_message public.social_bid_messages%rowtype;
  v_attachment_count integer := coalesce(cardinality(p_attachment_ids), 0);
  v_matching_count integer;
begin
  if p_sender_kind not in ('creator', 'sponsor') then
    raise exception 'invalid sender kind';
  end if;
  if p_client_nonce is null then
    raise exception 'client nonce required';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) > 2000 then
    raise exception 'message too long';
  end if;
  if btrim(coalesce(p_body, '')) = '' and v_attachment_count = 0 then
    raise exception 'message or attachment required';
  end if;
  if v_attachment_count > 5 then
    raise exception 'too many attachments';
  end if;

  select * into v_message
  from public.social_bid_messages m
  where m.client_nonce = p_client_nonce;

  if found then
    if v_message.conversation_id <> p_conversation_id
       or v_message.sender_kind <> p_sender_kind then
      raise exception 'client nonce belongs to another message';
    end if;
    return query select v_message.id, v_message.sender_kind, v_message.body, v_message.created_at;
    return;
  end if;

  if v_attachment_count > 0 then
    select count(*) into v_matching_count
    from public.social_bid_message_attachments a
    where a.id = any(p_attachment_ids)
      and a.conversation_id = p_conversation_id
      and a.uploader_kind = p_sender_kind
      and a.message_id is null
      and a.status = 'verified'
      and a.verified_at is not null
      and a.expires_at > now();
    if v_matching_count <> v_attachment_count then
      raise exception 'attachments are unavailable';
    end if;
  end if;

  begin
    insert into public.social_bid_messages (
      conversation_id, sender_kind, body, has_attachments, client_nonce
    ) values (
      p_conversation_id,
      p_sender_kind,
      btrim(coalesce(p_body, '')),
      v_attachment_count > 0,
      p_client_nonce
    ) returning * into v_message;
  exception when unique_violation then
    -- A concurrent retry with the same nonce returns the original message.
    select * into v_message
    from public.social_bid_messages m
    where m.client_nonce = p_client_nonce;
    if not found
       or v_message.conversation_id <> p_conversation_id
       or v_message.sender_kind <> p_sender_kind then
      raise;
    end if;
    return query select v_message.id, v_message.sender_kind, v_message.body, v_message.created_at;
    return;
  end;

  if v_attachment_count > 0 then
    update public.social_bid_message_attachments
    set message_id = v_message.id,
        status = 'ready'
    where id = any(p_attachment_ids)
      and conversation_id = p_conversation_id
      and uploader_kind = p_sender_kind
      and message_id is null
      and status = 'verified';
    get diagnostics v_matching_count = row_count;
    if v_matching_count <> v_attachment_count then
      raise exception 'attachments could not be attached';
    end if;
  end if;

  update public.social_bid_conversations
  set updated_at = v_message.created_at
  where social_bid_conversations.id = p_conversation_id;

  return query select v_message.id, v_message.sender_kind, v_message.body, v_message.created_at;
end;
$$;

revoke execute on function public.social_bid_send_message_with_attachments(uuid, text, text, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.social_bid_send_message_with_attachments(uuid, text, text, uuid[], uuid)
  to service_role;

-- Attachment-only messages still create exactly one ordinary message
-- notification; signed URLs and filenames are never copied into notifications.
create or replace function public.social_bid_notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.social_bid_conversations%rowtype;
  v_sender_name text;
  v_preview text;
begin
  select * into v_conversation
  from public.social_bid_conversations
  where id = new.conversation_id;

  v_preview := case
    when btrim(new.body) <> '' then left(new.body, 160)
    when new.has_attachments then 'Sent an attachment.'
    else 'Sent a message.'
  end;

  if new.sender_kind = 'creator' then
    select c.display_name into v_sender_name
    from public.creators c where c.id = v_conversation.creator_id;
    insert into public.social_bid_notifications (
      recipient_kind, buyer_id, notification_type, conversation_id, message_id,
      title, body, event_key
    ) values (
      'sponsor', v_conversation.buyer_id, 'NEW_MESSAGE', new.conversation_id, new.id,
      coalesce(v_sender_name, 'A creator') || ' sent you a message', v_preview,
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
      coalesce(v_sender_name, 'A sponsor') || ' sent you a message', v_preview,
      'message:' || new.id || ':creator:' || v_conversation.creator_id
    ) on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function public.social_bid_notify_new_message() from public, anon, authenticated;
