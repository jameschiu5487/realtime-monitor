-- 2026-08-10 刪除一筆啟動失敗的 realtime run（策略 Newton）
--
-- run_id 9698fbc5-db40-4770-8073-94c97705a06b
-- strategy_id 44ca6e7c-479e-44ef-aaaa-f784a9f1e47c（Newton，非 Newtonz）
-- mode=realtime、status=completed，僅存活約 2 分鐘
-- （2026-08-09 18:14:21 → 18:16:28），無任何 trade。
-- 宣告 initial_capital 4436，但 equity 只有 2217（binance leg 僅 0.37），
-- 顯然是啟動未完成的殘局，會污染 Overview 的 Realtime 淨值曲線。
-- 應使用者要求刪除。
--
-- 資料分布：strategy_runs 1 筆、equity_curve 3 筆、pnl_series 1 筆。
-- 其餘表（trades / combined_trades / positions / polymarket_*）無資料。
-- 註：params 內僅為環境變數「名稱」引用（如 BINANCE_API_KEY_3），非明文密鑰。
--
-- ================= 實際執行的刪除 =================
-- DELETE FROM pnl_series    WHERE run_id = '9698fbc5-db40-4770-8073-94c97705a06b';
-- DELETE FROM equity_curve  WHERE run_id = '9698fbc5-db40-4770-8073-94c97705a06b';
-- DELETE FROM strategy_runs WHERE run_id = '9698fbc5-db40-4770-8073-94c97705a06b';
--
-- ================= 還原用（如需回填，依序執行以下三段） =================

INSERT INTO strategy_runs
SELECT * FROM json_populate_recordset(null::strategy_runs,
'[{"run_id":"9698fbc5-db40-4770-8073-94c97705a06b","strategy_id":"44ca6e7c-479e-44ef-aaaa-f784a9f1e47c","mode":"realtime","status":"completed","start_time":"2026-08-09T18:14:21.819569+00:00","end_time":"2026-08-09T18:16:28.082452+00:00","initial_capital":4436,"notes":null,"created_at":"2026-08-09T18:14:21.924804+00:00","params":{"api":{"bybit_secret_env":"BYBIT_SECRET_KEY","bybit_api_key_env":"BYBIT_API_KEY","execution_mapping":{"bybit":"zoomex","binance":"binance"},"zoomex_secret_env":"ZOOMEX_SECRET_KEY","binance_secret_env":"BINANCE_SECRET_KEY_3","zoomex_api_key_env":"ZOOMEX_API_KEY","binance_api_key_env":"BINANCE_API_KEY_3","bybit_spot_secret_env":"BYBIT_SECRET_KEY","bybit_spot_api_key_env":"BYBIT_API_KEY","zoomex_spot_secret_env":"ZOOMEX_SECRET_KEY","binance_spot_secret_env":"BINANCE_SECRET_KEY","zoomex_spot_api_key_env":"ZOOMEX_API_KEY","binance_spot_api_key_env":"BINANCE_API_KEY"},"mode":"realtime","engine":{"strategy_interval_secs":30},"capital":4436,"strategy":{"coin_cap":0.3,"exit_mode":"v1_style","spot_perp":{"enabled":false,"perp_exchange":"bybit","spot_exchange":"binance_spot","close_funding_bps":0,"max_book_age_secs":10,"min_open_funding_bps":5},"entry_mode":"v1_style","venue_pair":["binance","bybit"],"default_mmr":0.005,"enable_hedge":true,"min_rate_bps":20,"risk_control":{"safety_ratio":2,"max_margin_ratio":0.7,"max_safety_ratio":2.5,"min_safety_ratio":1.8,"warn_margin_ratio":0.8,"rebalance_threshold":0.45,"max_drawdown_percent":10,"critical_margin_ratio":0.9,"volatility_window_hours":24,"api_latency_threshold_ms":2000,"enable_dynamic_safety_ratio":false},"exchange_rank":["bybit","binance"],"max_positions":10,"total_capital":8000,"min_order_size":200,"bias_mean_window":60,"default_leverage":3,"order_interval_ms":700,"quote_cushion_bps":1,"exit_window_minutes":0,"max_entry_basis_bps":200,"max_holding_minutes":120,"min_entry_basis_bps":-100000,"entry_window_minutes":30,"force_taker_exchanges":[],"min_recent_volume_usd":166666,"volume_window_minutes":240,"entry_end_buffer_minutes":29,"require_interval_mismatch":false,"enable_funding_reversal_exit":true,"order_placing_window_minutes":5,"taker_slippage_tolerance_bps":2,"enable_spread_maker_selection":false,"max_cross_exchange_price_bias_bps":1000},"supabase":{"enabled":true,"url_env":"SUPABASE_URL","code_ref":"fb458634ce80e8d74466c4f32928bd8bd1094eae","api_key_env":"SUPABASE_KEY","strategy_id":"44ca6e7c-479e-44ef-aaaa-f784a9f1e47c"},"telegram":{"enabled":true,"min_level":"info","chat_id_env":"TELEGRAM_CHAT_ID_3","bot_token_env":"TELEGRAM_BOT_TOKEN_3"},"fee_config":null,"output_dir":"./output_live","market_data":{"hyperliquid_dex":"","orderbook_depth":5,"enable_hyperliquid":false,"enable_binance_spot":false,"subscribe_orderbook":true,"dynamic_subscription":{"enabled":true,"subscribe_klines":true,"kline_history_count":300,"refresh_interval_secs":60,"rate_spread_threshold_bps":12},"subscribe_funding_rates":true,"symbol_refresh_interval_hours":24},"snapshot_builder":{"min_symbols":5,"orderbook_ttl_secs":30,"funding_rate_ttl_secs":86400}},"code_ref":"fb458634ce80e8d74466c4f32928bd8bd1094eae","leg1_account":"binance_3","leg2_account":"zoomex_1"}]');

INSERT INTO equity_curve
SELECT * FROM json_populate_recordset(null::equity_curve,
'[{"run_id":"9698fbc5-db40-4770-8073-94c97705a06b","ts":"2026-08-09T18:14:25.790134+00:00","binance_equity":0.37373654,"bybit_equity":2217.01692533,"total_equity":2217.39066187,"binance_pnl":0,"bybit_pnl":0,"total_pnl":0,"drawdown_pct":null,"bybit_position_value":null,"binance_position_value":null,"total_position_value":null},{"run_id":"9698fbc5-db40-4770-8073-94c97705a06b","ts":"2026-08-09T18:15:26.183013+00:00","binance_equity":0.37373654,"bybit_equity":2217.09014385,"total_equity":2217.46388039,"binance_pnl":0,"bybit_pnl":0.07321852,"total_pnl":0.07321852,"drawdown_pct":-0.0033020126430158394,"bybit_position_value":0,"binance_position_value":0,"total_position_value":0},{"run_id":"9698fbc5-db40-4770-8073-94c97705a06b","ts":"2026-08-09T18:16:26.11555+00:00","binance_equity":0.37373654,"bybit_equity":2217.07017516,"total_equity":2217.4439117,"binance_pnl":0,"bybit_pnl":0.05324983,"total_pnl":0.05324983,"drawdown_pct":-0.002401463617380468,"bybit_position_value":0,"binance_position_value":0,"total_position_value":0}]');

INSERT INTO pnl_series
SELECT * FROM json_populate_recordset(null::pnl_series,
'[{"run_id":"9698fbc5-db40-4770-8073-94c97705a06b","ts":"2026-08-09T18:15:24.336238+00:00","binance_price_pnl":0,"bybit_price_pnl":0,"total_price_pnl":0,"binance_funding_pnl":0,"bybit_funding_pnl":0,"total_funding_pnl":0,"binance_fee":0,"bybit_fee":0,"total_fee":0,"total_pnl":0}]');
