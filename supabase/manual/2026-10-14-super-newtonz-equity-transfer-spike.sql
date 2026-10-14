-- Super_Newtonz run 5fc30370: one equity_curve row caught a transfer into the
-- zoomex account (stored in bybit_*, the second-leg columns): bybit_equity
-- jumped +1,936 U for one minute and was back the next. Not trading P&L, so
-- the row takes its previous row's values (fill forward). pnl_series was not
-- affected. Requested by the user 2026-10-14.
--
-- Original row, for restoring:
--   ts             2026-10-14 14:50:24.62285+00
--   total_equity   5865.46553631    total_pnl   1936.92355996
--   binance_equity 1987.22435865    binance_pnl -24.77120317
--   bybit_equity   3878.24117766    bybit_pnl   1961.69476313
--   drawdown_pct   -49.30387842666229

update public.equity_curve cur
set total_equity   = prev.total_equity,
    total_pnl      = prev.total_pnl,
    binance_equity = prev.binance_equity,
    binance_pnl    = prev.binance_pnl,
    bybit_equity   = prev.bybit_equity,
    bybit_pnl      = prev.bybit_pnl,
    drawdown_pct   = prev.drawdown_pct
from public.equity_curve prev
where cur.run_id  = '5fc30370-f843-407d-a4c4-2eab20348dee'
  and cur.ts      = '2026-10-14 14:50:24.62285+00'
  and prev.run_id = cur.run_id
  and prev.ts     = '2026-10-14 14:49:24.556191+00';
