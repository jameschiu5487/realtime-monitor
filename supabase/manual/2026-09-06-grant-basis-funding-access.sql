-- 2026-09-06  補上 basis-funding 策略的 user_strategy_access（使用者明示同意）
--
-- 症狀：策略頁看不到 basis-funding。原因不是程式問題 ——
-- app/(dashboard)/strategies/page.tsx 只列出 user_strategy_access 有該使用者的策略，
-- 而 basis-funding（2026-09-05 建立）一筆授權都沒有，因此被正確過濾掉。
-- 該策略其實是活的：test-realtime / running，已有 16 筆 trade、1473 個淨值點。
--
-- 授權比照 Newton（44ca6e7c-...）。注意 Newton 的 share_ratio 並非全部 1.0：
-- jameschiu5487 與 neokuo2020 是 1.0，willyhsu4999 與 jameschiu.mg10 是 0.5。
-- share_ratio 會縮放所有對該使用者顯示與推播的金額，所以直接複製來源列的值，
-- 不要寫死 1.0。

insert into public.user_strategy_access (user_id, strategy_id, share_ratio)
select a.user_id, '<BASIS_FUNDING_STRATEGY_ID>'::uuid, a.share_ratio
from public.user_strategy_access a
where a.strategy_id = '<NEWTON_STRATEGY_ID>'
on conflict do nothing;
