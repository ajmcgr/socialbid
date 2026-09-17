-- SOCIALBID ONLY — click writes are server-only and every supplied identifier
-- must resolve to the same current public sponsorship relationship.

create or replace function public.record_click(
  _listing_id uuid,
  _ownership_id uuid,
  _creator_id uuid,
  _referrer text,
  _visitor_hash text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_creator_id uuid;
begin
  select l.creator_id
  into v_creator_id
  from public.listings l
  join public.creators c on c.id = l.creator_id
  where l.id = _listing_id
    and l.status = 'active'
    and c.banned = false;

  if v_creator_id is null or v_creator_id is distinct from _creator_id then
    raise exception 'invalid click target' using errcode = '22023';
  end if;

  if _ownership_id is not null and not exists (
    select 1
    from public.ownerships o
    where o.id = _ownership_id
      and o.listing_id = _listing_id
      and o.status = 'active'
      and o.ended_at is null
  ) then
    raise exception 'invalid current sponsorship' using errcode = '22023';
  end if;

  insert into public.clicks (
    listing_id, ownership_id, creator_id, referrer, visitor_hash, is_unique
  ) values (
    _listing_id,
    _ownership_id,
    v_creator_id,
    _referrer,
    _visitor_hash,
    _ownership_id is not null
      and _visitor_hash is not null
      and not exists (
        select 1
        from public.clicks
        where ownership_id = _ownership_id and visitor_hash = _visitor_hash
      )
  );

  if _ownership_id is not null then
    update public.ownerships
    set click_count = click_count + 1
    where id = _ownership_id
      and listing_id = _listing_id
      and status = 'active'
      and ended_at is null;
  end if;
end;
$$;

revoke all on function public.record_click(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.record_click(uuid, uuid, uuid, text, text)
  to service_role;
