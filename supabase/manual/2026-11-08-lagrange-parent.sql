-- 2026-11-08  Lagrange: parent strategy of the two jump-fade books (user-requested)
--
-- Jump Fade Maker (Binance, BINANCE_API_KEY) and Jump Fade Taker (Zoomex,
-- ZOOMEX_API_KEY) become children of a new parent, Lagrange, like Kepler's
-- books. Their runs leave the Overview's per-run figures; Lagrange gets the
-- parent card (real account equity of the children's accounts) and the parent
-- page sums their live books. Lagrange and Taker are granted to the same users
-- as Jump Fade Maker (each child still needs its own access to be summed).
-- Applied 2026-11-08 via execute_sql. Lagrange strategy_id: 6f5dba28-003d-4737-94a7-7b1e219f53b1.

insert into strategies (name, version, description, market, exchanges, user_id)
values ('Lagrange', 'v1.0', 'Lagrange: parent of the jump-fade books (Jump Fade Maker on Binance, Jump Fade Taker on Zoomex)', 'crypto-futures', array['binance','zoomex'], 'admin');

update strategies set parent_strategy_id = (select strategy_id from strategies where name = 'Lagrange')
where name in ('Jump Fade Maker', 'Jump Fade Taker');

insert into user_strategy_access (user_id, strategy_id)
select a.user_id, s.strategy_id
from user_strategy_access a
cross join strategies s
where a.strategy_id = '77c46d95-1fb0-438d-aa35-086dfa5704ae'  -- Jump Fade Maker
  and s.name in ('Lagrange', 'Jump Fade Taker')
  and not exists (select 1 from user_strategy_access x where x.user_id = a.user_id and x.strategy_id = s.strategy_id);
