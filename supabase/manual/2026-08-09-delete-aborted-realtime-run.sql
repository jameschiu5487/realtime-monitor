-- 2026-08-09 刪除一筆啟動失敗的 realtime run
--
-- run_id 7acafab2-eb82-4d25-9de1-c79d7e701856（策略 Newtonz）
-- mode=realtime、status=completed，但只存活 32 秒
-- （2026-08-08 18:18:50 → 18:19:22），無任何 trade，只有 1 筆 equity_curve。
-- 該筆 equity（total_equity 7277.34，宣告 initial_capital 10000）會污染
-- Overview 的 Realtime 淨值曲線，應使用者要求刪除。
--
-- 其餘表（trades / combined_trades / pnl_series / positions / polymarket_*）無資料。
-- 註：params 內僅為環境變數「名稱」引用（如 BINANCE_API_KEY），非明文密鑰。
--
-- ================= 實際執行的刪除 =================
-- DELETE FROM equity_curve  WHERE run_id = '7acafab2-eb82-4d25-9de1-c79d7e701856';
-- DELETE FROM strategy_runs WHERE run_id = '7acafab2-eb82-4d25-9de1-c79d7e701856';
--
-- ================= 還原用（如需回填，執行以下兩段） =================

INSERT INTO strategy_runs
SELECT * FROM json_populate_recordset(null::strategy_runs,
'[{"run_id":"7acafab2-eb82-4d25-9de1-c79d7e701856","strategy_id":"b2c3d4e5-f6a7-8901-bcde-f12345678901","mode":"realtime","status":"completed","start_time":"2026-08-08T18:18:50.2187+00:00","end_time":"2026-08-08T18:19:22.962515+00:00","initial_capital":10000,"notes":null,"created_at":"2026-08-08T18:18:50.335637+00:00","params":{"api":{"bybit_secret_env":"BYBIT_SECRET_KEY","bybit_api_key_env":"BYBIT_API_KEY","execution_mapping":{"bybit":"zoomex","binance":"binance"},"zoomex_secret_env":"ZOOMEX_SECRET_KEY","binance_secret_env":"BINANCE_SECRET_KEY","zoomex_api_key_env":"ZOOMEX_API_KEY","binance_api_key_env":"BINANCE_API_KEY","bybit_spot_secret_env":"BYBIT_SECRET_KEY","bybit_spot_api_key_env":"BYBIT_API_KEY","zoomex_spot_secret_env":"ZOOMEX_SECRET_KEY","binance_spot_secret_env":"BINANCE_SECRET_KEY","zoomex_spot_api_key_env":"ZOOMEX_API_KEY","binance_spot_api_key_env":"BINANCE_API_KEY"},"mode":"realtime","engine":{"strategy_interval_secs":30},"capital":10000,"strategy":{"coin_cap":0.3,"exit_mode":"v1_style","spot_perp":{"enabled":false,"perp_exchange":"bybit","spot_exchange":"binance_spot","close_funding_bps":0,"max_book_age_secs":10,"min_open_funding_bps":5},"entry_mode":"v1_style","venue_pair":["binance","bybit"],"default_mmr":0.005,"enable_hedge":true,"min_rate_bps":30,"risk_control":{"safety_ratio":2,"max_margin_ratio":0.7,"max_safety_ratio":2.5,"min_safety_ratio":1.8,"warn_margin_ratio":0.8,"rebalance_threshold":0.45,"max_drawdown_percent":10,"critical_margin_ratio":0.9,"volatility_window_hours":24,"api_latency_threshold_ms":2000,"enable_dynamic_safety_ratio":false},"exchange_rank":["bybit","binance"],"max_positions":10,"total_capital":20000,"min_order_size":200,"bias_mean_window":60,"default_leverage":3,"order_interval_ms":700,"quote_cushion_bps":1,"exit_window_minutes":0,"max_entry_basis_bps":200,"max_holding_minutes":120,"min_entry_basis_bps":-100000,"entry_window_minutes":30,"force_taker_exchanges":[],"min_recent_volume_usd":166666,"volume_window_minutes":240,"max_notional_per_symbol":100,"entry_end_buffer_minutes":29,"require_interval_mismatch":false,"enable_funding_reversal_exit":true,"order_placing_window_minutes":5,"taker_slippage_tolerance_bps":2,"enable_spread_maker_selection":false,"max_cross_exchange_price_bias_bps":1000},"supabase":{"enabled":true,"url_env":"SUPABASE_URL","code_ref":"fb458634ce80e8d74466c4f32928bd8bd1094eae","api_key_env":"SUPABASE_KEY","strategy_id":"b2c3d4e5-f6a7-8901-bcde-f12345678901"},"telegram":{"enabled":true,"min_level":"info","chat_id_env":"TELEGRAM_CHAT_ID","bot_token_env":"TELEGRAM_BOT_TOKEN"},"fee_config":null,"output_dir":"./output_live","market_data":{"hyperliquid_dex":"","orderbook_depth":5,"enable_hyperliquid":false,"enable_binance_spot":false,"subscribe_orderbook":true,"dynamic_subscription":{"enabled":true,"subscribe_klines":true,"kline_history_count":300,"refresh_interval_secs":60,"rate_spread_threshold_bps":12},"subscribe_funding_rates":true,"symbol_refresh_interval_hours":24},"snapshot_builder":{"min_symbols":5,"orderbook_ttl_secs":30,"funding_rate_ttl_secs":86400}},"code_ref":"fb458634ce80e8d74466c4f32928bd8bd1094eae","leg1_account":"binance_1","leg2_account":"zoomex_1"}]');

INSERT INTO equity_curve
SELECT * FROM json_populate_recordset(null::equity_curve,
'[{"run_id":"7acafab2-eb82-4d25-9de1-c79d7e701856","ts":"2026-08-08T18:18:53.326926+00:00","binance_equity":5060,"bybit_equity":2217.34308056,"total_equity":7277.34308056,"binance_pnl":0,"bybit_pnl":0,"total_pnl":0,"drawdown_pct":null,"bybit_position_value":null,"binance_position_value":null,"total_position_value":null}]');
