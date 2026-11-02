-- 2026-11-03  shareholder_shares.effective_from: date -> timestamptz (user-requested)
--
-- A ratio should change at the minute money moved, not at the start of the day:
-- the shareholders' 0.5708 starts at the 33,000 U deposit into binance_spot_4,
-- 2026-11-03 02:32 Taipei. Existing dates become Taipei midnight (same instants
-- lib/share.ts used before), then the two deposit rows move to 02:32.
-- In the table editor, enter effective_from with its zone, e.g. 2026-11-03 02:32+08.
-- The email view depends on the column, so it is dropped and recreated.
-- Applied 2026-11-03 via apply_migration (shareholder_shares_effective_timestamp).

drop view public.shareholder_shares_named;

alter table public.shareholder_shares
  alter column effective_from type timestamptz
  using (effective_from::timestamp at time zone 'Asia/Taipei');

comment on table public.shareholder_shares is
  'Per-user share of every strategy''s amounts, from effective_from (timestamptz; enter Taipei time as ...+08) until the user''s next row. Add a row to change it; never edit old rows. Visibility stays in user_strategy_access.';

create view public.shareholder_shares_named as
  select u.email, s.effective_from, s.share_ratio, s.note, s.created_at, s.user_id
  from public.shareholder_shares s
  join auth.users u on u.id = s.user_id;
revoke all on public.shareholder_shares_named from anon, authenticated;

update public.shareholder_shares
set effective_from = timestamptz '2026-11-03 02:32:00+08'
where effective_from = timestamptz '2026-11-03 00:00:00+08'
  and user_id in ('da11819c-3bbf-44b2-ae12-a92f0e665b25', '015490b0-e8b1-466f-a5f4-a409bf126e8d')
  and share_ratio = 0.5708;
