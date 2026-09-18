-- SOCIALBID ONLY — permit an explicitly proven provider Auth user to leave an
-- empty bootstrap self-account and join the intended canonical SocialBid
-- account. This does not move Supabase Auth identities and is not a general
-- account-merge mechanism.

create or replace function public.complete_social_bid_account_link(
  p_token_hash text,
  p_authenticated_user_id uuid,
  p_session_id uuid,
  p_provider text,
  p_email_hash text default null
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_intent public.social_bid_account_link_intents%rowtype;
  v_existing_canonical uuid;
  v_empty_bootstrap boolean;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$'
     or p_authenticated_user_id is null
     or p_session_id is null
     or p_provider not in ('google', 'email')
     or not exists (select 1 from auth.users where id = p_authenticated_user_id) then
    return 'invalid';
  end if;

  select * into v_intent
  from public.social_bid_account_link_intents
  where token_hash = p_token_hash
  for update;

  if not found
     or v_intent.used_at is not null
     or v_intent.expires_at <= now()
     or v_intent.session_id <> p_session_id
     or v_intent.provider <> p_provider
     or (v_intent.provider = 'email' and v_intent.email_hash is distinct from p_email_hash)
     or not exists (
       select 1 from public.social_bid_user_sessions s
       where s.id = p_session_id
         and s.user_id = v_intent.canonical_user_id
         and s.revoked_at is null
         and s.expires_at > now()
     ) then
    return 'invalid';
  end if;

  -- Explicit links are rare. These short transaction-scoped locks make the
  -- emptiness proof, mapping change and intent consumption atomic with respect
  -- to every SocialBid write that can establish ownership for the provider
  -- principal. Post-owned tables are deliberately not included.
  lock table
    public.social_bid_account_auth_users,
    public.user_roles,
    public.creators,
    public.buyers,
    public.payments,
    public.social_bid_buyer_recovery_requests,
    public.social_bid_email_identity_links,
    public.social_bid_guest_buyer_claims,
    public.social_bid_user_sessions
  in share row exclusive mode;

  select canonical_user_id into v_existing_canonical
  from public.social_bid_account_auth_users
  where auth_user_id = p_authenticated_user_id
  for update;

  if v_existing_canonical is not null
     and v_existing_canonical <> v_intent.canonical_user_id then
    if v_existing_canonical <> p_authenticated_user_id then
      return 'conflict';
    end if;

    select not (
      exists (
        select 1 from public.user_roles r
        where r.user_id = p_authenticated_user_id
      )
      or exists (
        select 1 from public.creators c
        where c.user_id = p_authenticated_user_id
      )
      or exists (
        select 1 from public.buyers b
        where b.user_id = p_authenticated_user_id
      )
      or exists (
        select 1 from public.payments p
        where p.initiated_by_user_id = p_authenticated_user_id
      )
      or exists (
        select 1
        from public.listings l
        join public.creators c on c.id = l.creator_id
        where c.user_id = p_authenticated_user_id
      )
      or exists (
        select 1
        from public.ownerships o
        left join public.buyers b on b.id = o.buyer_id
        join public.listings l on l.id = o.listing_id
        join public.creators c on c.id = l.creator_id
        where b.user_id = p_authenticated_user_id
           or c.user_id = p_authenticated_user_id
      )
      or exists (
        select 1
        from public.social_bid_conversations conversation
        join public.creators c on c.id = conversation.creator_id
        join public.buyers b on b.id = conversation.buyer_id
        where c.user_id = p_authenticated_user_id
           or b.user_id = p_authenticated_user_id
      )
      or exists (
        select 1
        from public.social_bid_messages message
        join public.social_bid_conversations conversation
          on conversation.id = message.conversation_id
        join public.creators c on c.id = conversation.creator_id
        join public.buyers b on b.id = conversation.buyer_id
        where c.user_id = p_authenticated_user_id
           or b.user_id = p_authenticated_user_id
      )
      or exists (
        select 1
        from public.social_bid_notifications notification
        left join public.creators c on c.id = notification.creator_id
        left join public.buyers b on b.id = notification.buyer_id
        where c.user_id = p_authenticated_user_id
           or b.user_id = p_authenticated_user_id
      )
      or exists (
        select 1 from public.social_bid_buyer_recovery_requests r
        where r.user_id = p_authenticated_user_id
           or r.previous_user_id = p_authenticated_user_id
      )
      or exists (
        select 1 from public.social_bid_email_identity_links e
        where e.user_id = p_authenticated_user_id
      )
      or exists (
        select 1 from public.social_bid_guest_buyer_claims g
        where g.claimed_by_user_id = p_authenticated_user_id
      )
      or exists (
        select 1 from public.social_bid_user_sessions s
        where s.user_id = p_authenticated_user_id
          and s.revoked_at is null
          and s.expires_at > now()
      )
      or exists (
        select 1 from public.social_bid_account_auth_users m
        where m.canonical_user_id = p_authenticated_user_id
          and m.auth_user_id <> p_authenticated_user_id
      )
    ) into v_empty_bootstrap;

    if not v_empty_bootstrap then
      return 'conflict';
    end if;

    update public.social_bid_account_auth_users
    set canonical_user_id = v_intent.canonical_user_id,
        linked_provider = p_provider,
        updated_at = now()
    where auth_user_id = p_authenticated_user_id
      and canonical_user_id = p_authenticated_user_id;

    if not found then
      return 'conflict';
    end if;
  elsif v_existing_canonical is null then
    insert into public.social_bid_account_auth_users (
      auth_user_id, canonical_user_id, linked_provider
    ) values (
      p_authenticated_user_id, v_intent.canonical_user_id, p_provider
    );
  else
    update public.social_bid_account_auth_users
    set linked_provider = coalesce(linked_provider, p_provider),
        updated_at = now()
    where auth_user_id = p_authenticated_user_id
      and canonical_user_id = v_intent.canonical_user_id;
  end if;

  select canonical_user_id into v_existing_canonical
  from public.social_bid_account_auth_users
  where auth_user_id = p_authenticated_user_id;
  if v_existing_canonical is distinct from v_intent.canonical_user_id then
    raise exception using
      errcode = 'P0001',
      message = 'social_bid_account_link_mapping_failed';
  end if;

  -- Defensive cleanup for the new/no-existing-map case. The empty-bootstrap
  -- exception above requires zero active first-party sessions for B.
  if p_authenticated_user_id <> v_intent.canonical_user_id then
    update public.social_bid_user_sessions
    set revoked_at = coalesce(revoked_at, now())
    where user_id = p_authenticated_user_id
      and id <> p_session_id
      and revoked_at is null;
  end if;

  update public.social_bid_account_link_intents
  set used_at = now(), linked_auth_user_id = p_authenticated_user_id
  where id = v_intent.id and used_at is null;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'social_bid_account_link_intent_consume_failed';
  end if;

  return 'linked';
end;
$$;

revoke all on function public.complete_social_bid_account_link(text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_social_bid_account_link(text, uuid, uuid, text, text)
  to service_role;
