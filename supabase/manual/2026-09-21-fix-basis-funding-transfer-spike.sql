-- 2026-09-21  修正 basis-funding 最新 run 因「轉帳」造成的淨值尖峰（使用者指示）
--
-- run_id = d111b156-76c2-4855-bfa2-d620c63fb5be（realtime / running，2026-09-14 起）
--
-- 症狀：2026-09-20 09:55 與 09:56 兩筆，total_equity 由約 4142 跳到 6217/6231，
-- total_pnl 由 -358 變成 +1716/+1730，兩分鐘後自行回到原水位。
-- 全 run 9619 個點中只有這 2 筆異常。窗口內無成交（最近一筆在 10:00:35）。
-- 原因：資金轉帳造成的資本變動，不是策略損益。
--
-- 注意：equity_curve 的欄位名沿用舊的兩所命名，這個 run 實際交易的是
-- binance + zoomex，**bybit_* 欄位裝的是 zoomex 腿**。污染的只有該腿；
-- 同時間 binance 腿讀數正常（2483.48 / 2497.31，與前後連續），故保留不動。
--
-- 處理：bybit_*（zoomex 腿）前值填補為最後一筆乾淨讀數（09:54:16.908644），
-- total_* 依「兩腿相加」重算以維持不變量，drawdown_pct 用前一列隱含的高水位重算。
--
-- === 原始值（還原用） ===
-- ts                              total_equity     total_pnl      binance_equity   binance_pnl     bybit_equity    bybit_pnl      drawdown_pct
-- 2026-09-20 09:55:16.849412+00   6216.80463779    1716.37040033  2483.47872595    -155.82543592   3733.32591184   1872.19583625  -38.13788425222501
-- 2026-09-20 09:56:16.843976+00   6230.99722974    1730.56299228  2497.30647553    -141.99768634   3733.69075421   1872.56067862  -38.45324475303771
--
-- 還原指令：
--   update public.equity_curve set
--     total_equity = 6216.80463779, total_pnl = 1716.37040033,
--     bybit_equity = 3733.32591184, bybit_pnl = 1872.19583625,
--     drawdown_pct = -38.13788425222501
--   where run_id = 'd111b156-76c2-4855-bfa2-d620c63fb5be'
--     and ts = '2026-09-20 09:55:16.849412+00';
--   update public.equity_curve set
--     total_equity = 6230.99722974, total_pnl = 1730.56299228,
--     bybit_equity = 3733.69075421, bybit_pnl = 1872.56067862,
--     drawdown_pct = -38.45324475303771
--   where run_id = 'd111b156-76c2-4855-bfa2-d620c63fb5be'
--     and ts = '2026-09-20 09:56:16.843976+00';

with clean as (
  select bybit_equity, bybit_pnl, total_equity as prev_eq, drawdown_pct as prev_dd
  from public.equity_curve
  where run_id = 'd111b156-76c2-4855-bfa2-d620c63fb5be'
    and ts = '2026-09-20 09:54:16.908644+00'
)
update public.equity_curve e
set bybit_equity = c.bybit_equity,
    bybit_pnl    = c.bybit_pnl,
    total_equity = e.binance_equity + c.bybit_equity,
    total_pnl    = e.binance_pnl    + c.bybit_pnl,
    -- 高水位由前一列反推（peak = E / (1 - dd/100)），避免猜測引擎的公式
    drawdown_pct = (
      (c.prev_eq / (1 - c.prev_dd / 100.0)) - (e.binance_equity + c.bybit_equity)
    ) / (c.prev_eq / (1 - c.prev_dd / 100.0)) * 100.0
from clean c
where e.run_id = 'd111b156-76c2-4855-bfa2-d620c63fb5be'
  and e.ts in ('2026-09-20 09:55:16.849412+00', '2026-09-20 09:56:16.843976+00');
