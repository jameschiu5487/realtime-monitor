-- 2026-11-03  shareholder_shares.equity_at_change (user-requested)
--
-- The shareholder's net asset value (USDT) at effective_from, recorded alongside
-- the ratio for the books. Stored only: the app neither reads nor shows it.
-- Nullable; filled by hand in the table editor. The email view is recreated to
-- include it.
-- Applied 2026-11-03 via apply_migration (shareholder_shares_equity_at_change).

alter table public.shareholder_shares
  add column equity_at_change numeric check (equity_at_change is null or equity_at_change >= 0);

comment on column public.shareholder_shares.equity_at_change is
  'Shareholder''s net asset value (USDT) at effective_from. Record only; the app does not read or display it.';

create or replace view public.shareholder_shares_named as
  select u.email, s.effective_from, s.share_ratio, s.note, s.created_at, s.user_id, s.equity_at_change
  from public.shareholder_shares s
  join auth.users u on u.id = s.user_id;
revoke all on public.shareholder_shares_named from anon, authenticated;
