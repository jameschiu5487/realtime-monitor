-- 2026-11-03  Shareholder ratios that change over time (user-approved design)
--
-- user_strategy_access keeps deciding WHO SEES WHICH strategy. How much of each
-- amount a user sees moves here: one ratio per user for every strategy, with a
-- history. A ratio applies from effective_from (a Taipei calendar day, 00:00
-- UTC+8) until the user's next row. No end column, so periods can't overlap or
-- leave gaps. To change a ratio, ADD a row in the Supabase table editor; don't
-- edit old rows, or the history they carry is lost.
-- Admins (james, neokuo) simply hold 1.0. Ratios don't have to sum to 1.
-- Applied 2026-11-03 via apply_migration (shareholder_shares).

create table public.shareholder_shares (
  user_id        uuid not null references auth.users (id) on delete cascade,
  effective_from date not null,
  share_ratio    numeric not null check (share_ratio >= 0 and share_ratio <= 1),
  note           text,
  created_at     timestamptz not null default now(),
  primary key (user_id, effective_from)
);

comment on table public.shareholder_shares is
  'Per-user share of every strategy''s amounts, from effective_from (Taipei day) until the user''s next row. Add a row to change it; never edit old rows. Visibility stays in user_strategy_access.';

alter table public.shareholder_shares enable row level security;

-- A shareholder sees only their own ratios. Server routes that act for other
-- users (push notifications) use the service role, which bypasses RLS.
create policy "users read own shares"
  on public.shareholder_shares for select to authenticated
  using (user_id = auth.uid());

-- For the table editor: who each row is, by email. Not exposed to the app.
create view public.shareholder_shares_named as
  select u.email, s.effective_from, s.share_ratio, s.note, s.created_at, s.user_id
  from public.shareholder_shares s
  join auth.users u on u.id = s.user_id;
revoke all on public.shareholder_shares_named from anon, authenticated;

-- Backfill: each user's current ratio (one value per user today), from long ago,
-- so every amount stays exactly what it is now.
insert into public.shareholder_shares (user_id, effective_from, share_ratio, note)
select user_id, date '2000-01-01', max(share_ratio), 'backfill from user_strategy_access'
from public.user_strategy_access
group by user_id
having count(distinct share_ratio) = 1;
