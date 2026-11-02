-- 2026-11-03  Grant the Kepler family to the two shareholders (user-approved: "所有人")
--
-- da11819c (willyhsu4999) and 015490b0 (jameschiu.mg10) get exactly the Kepler rows the
-- admins hold: the parent c0b9c6bb + 11 children. Kepler · Equity Reversal is left out,
-- as for the admins (revoked 2026-10-05). Kepler DX is not included.
-- Visibility only: amounts come from shareholder_shares (lib/share.ts); the legacy
-- share_ratio column here takes its default and is not read.
-- Executed via execute_sql; 24 rows inserted.

insert into public.user_strategy_access (user_id, strategy_id)
select u.user_id, a.strategy_id
from (values ('da11819c-3bbf-44b2-ae12-a92f0e665b25'::uuid),
             ('015490b0-e8b1-466f-a5f4-a409bf126e8d'::uuid)) u(user_id)
cross join public.user_strategy_access a
join public.strategies s on s.strategy_id = a.strategy_id
where a.user_id = 'ab796983-39b7-49de-a043-1eb222bec31c'
  and (s.strategy_id = 'c0b9c6bb-29e9-55cf-8d7f-1c337697d61c'
       or s.parent_strategy_id = 'c0b9c6bb-29e9-55cf-8d7f-1c337697d61c')
on conflict do nothing;
