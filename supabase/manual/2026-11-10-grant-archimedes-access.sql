-- 2026-11-10  Grant Archimedes (parent) and Archimedes · Zoomex to the shareholders (user-requested)
--
-- zoomex_4 (ZOOMEX_API_KEY_4) is used only by Archimedes · Zoomex, which only
-- neokuo could see, so the fund panel hid the account from everyone else
-- (hiddenAccountIds: an account linked only to hidden strategies is hidden).
-- Same four users as Lagrange. Applied 2026-11-10 via execute_sql.

insert into user_strategy_access (user_id, strategy_id)
select a.user_id, s.strategy_id
from user_strategy_access a
cross join strategies s
where a.strategy_id = '6f5dba28-003d-4737-94a7-7b1e219f53b1'  -- Lagrange
  and s.strategy_id in ('c6be05ee-3227-5a62-a661-715a47282478',  -- Archimedes
                        'ab037d3c-97f4-5dbb-b8b4-08e543c5bd45')  -- Archimedes · Zoomex
  and not exists (select 1 from user_strategy_access x where x.user_id = a.user_id and x.strategy_id = s.strategy_id);
