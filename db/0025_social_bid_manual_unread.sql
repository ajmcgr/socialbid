-- SOCIAL BID — participant-specific manual unread state.
-- The conversation table remains service-role only; these timestamps are
-- mutated through server functions after actor and entitlement verification.

alter table public.social_bid_conversations
  add column if not exists creator_marked_unread_at timestamptz,
  add column if not exists sponsor_marked_unread_at timestamptz;
