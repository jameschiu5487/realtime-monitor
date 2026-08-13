export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      strategies: {
        Row: {
          strategy_id: string;
          user_id: string;
          name: string;
          version: string;
          description: string | null;
          created_at: string;
        };
        Insert: {
          strategy_id?: string;
          user_id: string;
          name: string;
          version: string;
          description?: string | null;
          created_at?: string;
        };
        Update: {
          strategy_id?: string;
          user_id?: string;
          name?: string;
          version?: string;
          description?: string | null;
          created_at?: string;
        };
      };
      strategy_runs: {
        Row: {
          run_id: string;
          strategy_id: string;
          mode: "backtest" | "paper" | "live";
          status: "pending" | "running" | "completed" | "failed" | "cancelled";
          start_time: string;
          end_time: string | null;
          initial_capital: number;
          params: Json | null;
          code_ref: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          run_id?: string;
          strategy_id: string;
          mode: "backtest" | "paper" | "live";
          status?: "pending" | "running" | "completed" | "failed" | "cancelled";
          start_time: string;
          end_time?: string | null;
          initial_capital: number;
          params?: Json | null;
          code_ref?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          run_id?: string;
          strategy_id?: string;
          mode?: "backtest" | "paper" | "live";
          status?: "pending" | "running" | "completed" | "failed" | "cancelled";
          start_time?: string;
          end_time?: string | null;
          initial_capital?: number;
          params?: Json | null;
          code_ref?: string | null;
          notes?: string | null;
          created_at?: string;
        };
      };
      trades: {
        Row: {
          trade_id: number;
          run_id: string;
          ts: string;
          symbol: string;
          exchange: string;
          action: string;
          side: "buy" | "sell";
          quantity_nominal: number;
          quantity_actual: number;
          price: number;
          fee_amount_usdt: number;
          fee_rate_bps: number;
          funding_rate: number;
          interval_hours: string | null;
          status: string;
          /** Execution slippage in basis points. Written by the strategy engine. */
          exec_slippage_bps: number | null;
        };
        Insert: {
          trade_id?: number;
          run_id: string;
          ts: string;
          symbol: string;
          exchange: string;
          action: string;
          side: "buy" | "sell";
          quantity_nominal: number;
          quantity_actual: number;
          price: number;
          fee_amount_usdt?: number;
          fee_rate_bps?: number;
          funding_rate?: number;
          interval_hours?: string | null;
          status?: string;
          exec_slippage_bps?: number | null;
        };
        Update: {
          trade_id?: number;
          run_id?: string;
          ts?: string;
          symbol?: string;
          exchange?: string;
          action?: string;
          side?: "buy" | "sell";
          quantity_nominal?: number;
          quantity_actual?: number;
          price?: number;
          fee_amount_usdt?: number;
          fee_rate_bps?: number;
          funding_rate?: number;
          interval_hours?: string | null;
          status?: string;
          exec_slippage_bps?: number | null;
        };
      };
      combined_trades: {
        Row: {
          combined_trade_id: number;
          run_id: string;
          ts: string;
          symbol: string;
          exchange: string;
          side: "long" | "short";
          quantity: number;
          entry_price: number;
          exit_price: number | null;
          exit_type: string | null;
          entry_time: string | null;
          exit_time: string | null;
          holding_period_hours: number | null;
          price_pnl: number | null;
          funding_fee_realized: number | null;
          commission_fee: number | null;
          total_pnl: number | null;
        };
        Insert: {
          combined_trade_id?: number;
          run_id: string;
          ts: string;
          symbol: string;
          exchange: string;
          side: "long" | "short";
          quantity: number;
          entry_price: number;
          exit_price?: number | null;
          exit_type?: string | null;
          entry_time?: string | null;
          exit_time?: string | null;
          holding_period_hours?: number | null;
          price_pnl?: number | null;
          funding_fee_realized?: number | null;
          commission_fee?: number | null;
          total_pnl?: number | null;
        };
        Update: {
          combined_trade_id?: number;
          run_id?: string;
          ts?: string;
          symbol?: string;
          exchange?: string;
          side?: "long" | "short";
          quantity?: number;
          entry_price?: number;
          exit_price?: number | null;
          exit_type?: string | null;
          entry_time?: string | null;
          exit_time?: string | null;
          holding_period_hours?: number | null;
          price_pnl?: number | null;
          funding_fee_realized?: number | null;
          commission_fee?: number | null;
          total_pnl?: number | null;
        };
      };
      pnl_series: {
        Row: {
          run_id: string;
          ts: string;
          total_pnl: number;
          total_funding_pnl: number;
          total_price_pnl: number;
          total_fee: number;
          binance_funding_pnl: number;
          binance_price_pnl: number;
          binance_fee: number;
          bybit_funding_pnl: number;
          bybit_price_pnl: number;
          bybit_fee: number;
        };
        Insert: {
          run_id: string;
          ts: string;
          total_pnl?: number;
          total_funding_pnl?: number;
          total_price_pnl?: number;
          total_fee?: number;
          binance_funding_pnl?: number;
          binance_price_pnl?: number;
          binance_fee?: number;
          bybit_funding_pnl?: number;
          bybit_price_pnl?: number;
          bybit_fee?: number;
        };
        Update: {
          run_id?: string;
          ts?: string;
          total_pnl?: number;
          total_funding_pnl?: number;
          total_price_pnl?: number;
          total_fee?: number;
          binance_funding_pnl?: number;
          binance_price_pnl?: number;
          binance_fee?: number;
          bybit_funding_pnl?: number;
          bybit_price_pnl?: number;
          bybit_fee?: number;
        };
      };
      equity_curve: {
        Row: {
          run_id: string;
          ts: string;
          total_equity: number;
          total_pnl: number;
          total_position_value: number;
          binance_equity: number;
          binance_pnl: number;
          binance_position_value: number;
          bybit_equity: number;
          bybit_pnl: number;
          bybit_position_value: number;
          drawdown_pct: number;
        };
        Insert: {
          run_id: string;
          ts: string;
          total_equity: number;
          total_pnl?: number;
          total_position_value?: number;
          binance_equity?: number;
          binance_pnl?: number;
          binance_position_value?: number;
          bybit_equity?: number;
          bybit_pnl?: number;
          bybit_position_value?: number;
          drawdown_pct?: number;
        };
        Update: {
          run_id?: string;
          ts?: string;
          total_equity?: number;
          total_pnl?: number;
          total_position_value?: number;
          binance_equity?: number;
          binance_pnl?: number;
          binance_position_value?: number;
          bybit_equity?: number;
          bybit_pnl?: number;
          bybit_position_value?: number;
          drawdown_pct?: number;
        };
      };
      user_strategy_access: {
        Row: {
          user_id: string;
          strategy_id: string;
          share_ratio: number;
          created_at: string;
        };
        Insert: {
          user_id: string;
          strategy_id: string;
          share_ratio?: number;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          strategy_id?: string;
          share_ratio?: number;
          created_at?: string;
        };
      };
      positions: {
        Row: {
          run_id: string;
          ts: string;
          symbol: string;
          exchange: string;
          position: number;
          avg_price: number;
          mark_price: number;
          notional_value: number;
          unrealized_pnl: number;
          leverage: number;
          liq_price: number;
        };
        Insert: {
          run_id: string;
          ts: string;
          symbol: string;
          exchange: string;
          position: number;
          avg_price: number;
          mark_price?: number;
          notional_value?: number;
          unrealized_pnl?: number;
          leverage?: number;
          liq_price?: number;
        };
        Update: {
          run_id?: string;
          ts?: string;
          symbol?: string;
          exchange?: string;
          position?: number;
          avg_price?: number;
          mark_price?: number;
          notional_value?: number;
          unrealized_pnl?: number;
          leverage?: number;
          liq_price?: number;
        };
      };
      polymarket_equity: {
        Row: {
          run_id: string;
          ts: string;
          total_equity: number;
          total_pnl: number;
          total_position_value: number;
          drawdown_pct: number;
        };
        Insert: {
          run_id: string;
          ts: string;
          total_equity: number;
          total_pnl?: number;
          total_position_value?: number;
          drawdown_pct?: number;
        };
        Update: {
          run_id?: string;
          ts?: string;
          total_equity?: number;
          total_pnl?: number;
          total_position_value?: number;
          drawdown_pct?: number;
        };
      };
      polymarket_positions: {
        Row: {
          id: number;
          run_id: string;
          ts: string;
          symbol: string;
          side: string | null;
          entry_price: number | null;
          current_price: number | null;
          shares: number | null;
          cost: number | null;
          current_value: number | null;
          unrealized_pnl: number | null;
          settled: boolean;
          result: string | null;
          entry_time: string | null;
          timeframe: string | null;
        };
        Insert: {
          id?: number;
          run_id: string;
          ts: string;
          symbol: string;
          side?: string | null;
          entry_price?: number | null;
          current_price?: number | null;
          shares?: number | null;
          cost?: number | null;
          current_value?: number | null;
          unrealized_pnl?: number | null;
          settled?: boolean;
          result?: string | null;
          entry_time?: string | null;
          timeframe?: string | null;
        };
        Update: {
          id?: number;
          run_id?: string;
          ts?: string;
          symbol?: string;
          side?: string | null;
          entry_price?: number | null;
          current_price?: number | null;
          shares?: number | null;
          cost?: number | null;
          current_value?: number | null;
          unrealized_pnl?: number | null;
          settled?: boolean;
          result?: string | null;
          entry_time?: string | null;
          timeframe?: string | null;
        };
      };
      polymarket_symbol_pnl: {
        Row: {
          run_id: string;
          ts: string;
          symbol: string;
          cumulative_pnl: number;
          trade_count: number;
          win_count: number;
          win_rate: number;
        };
        Insert: {
          run_id: string;
          ts: string;
          symbol: string;
          cumulative_pnl?: number;
          trade_count?: number;
          win_count?: number;
          win_rate?: number;
        };
        Update: {
          run_id?: string;
          ts?: string;
          symbol?: string;
          cumulative_pnl?: number;
          trade_count?: number;
          win_count?: number;
          win_rate?: number;
        };
      };
      saved_reports: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          start_date: string;
          end_date: string;
          selected_strategy_ids: string[];
          forward_fill_ids: string[];
          max_nav_change: number;
          notes: string;
          storage_user_id: string;
          storage_report_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          start_date: string;
          end_date: string;
          selected_strategy_ids: string[];
          forward_fill_ids?: string[];
          max_nav_change?: number;
          notes?: string;
          storage_user_id?: string;
          storage_report_id?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          start_date?: string;
          end_date?: string;
          selected_strategy_ids?: string[];
          forward_fill_ids?: string[];
          max_nav_change?: number;
          notes?: string;
          storage_user_id?: string;
          storage_report_id?: string;
          created_at?: string;
        };
      };
      basis_pairs: {
        Row: {
          id: string;
          user_id: string;
          leg1_exchange: "Binance" | "Bybit" | "Alpaca" | "OKX" | "Hyperliquid";
          leg1_market: "perp" | "spot";
          leg1_symbol: string;
          leg2_exchange: "Binance" | "Bybit" | "Alpaca" | "OKX" | "Hyperliquid";
          leg2_market: "perp" | "spot";
          leg2_symbol: string;
          alert_enabled: boolean;
          alert_threshold_pct: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          leg1_exchange: "Binance" | "Bybit" | "Alpaca" | "OKX" | "Hyperliquid";
          leg1_market: "perp" | "spot";
          leg1_symbol: string;
          leg2_exchange: "Binance" | "Bybit" | "Alpaca" | "OKX" | "Hyperliquid";
          leg2_market: "perp" | "spot";
          leg2_symbol: string;
          alert_enabled?: boolean;
          alert_threshold_pct?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          leg1_exchange?: "Binance" | "Bybit" | "Alpaca" | "OKX" | "Hyperliquid";
          leg1_market?: "perp" | "spot";
          leg1_symbol?: string;
          leg2_exchange?: "Binance" | "Bybit" | "Alpaca" | "OKX" | "Hyperliquid";
          leg2_market?: "perp" | "spot";
          leg2_symbol?: string;
          alert_enabled?: boolean;
          alert_threshold_pct?: number | null;
          created_at?: string;
        };
      };
      fund_account_equity: {
        Row: {
          account_id: string;
          exchange: string;
          ts: string;
          total_equity: number;
        };
        Insert: {
          account_id: string;
          exchange: string;
          ts: string;
          total_equity: number;
        };
        Update: {
          account_id?: string;
          exchange?: string;
          ts?: string;
          total_equity?: number;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
  };
};

// Convenience type aliases
export type Strategy = Database["public"]["Tables"]["strategies"]["Row"];
export type StrategyInsert = Database["public"]["Tables"]["strategies"]["Insert"];
export type StrategyUpdate = Database["public"]["Tables"]["strategies"]["Update"];

export type StrategyRun = Database["public"]["Tables"]["strategy_runs"]["Row"];
export type StrategyRunInsert = Database["public"]["Tables"]["strategy_runs"]["Insert"];
export type StrategyRunUpdate = Database["public"]["Tables"]["strategy_runs"]["Update"];

export type Trade = Database["public"]["Tables"]["trades"]["Row"];
export type TradeInsert = Database["public"]["Tables"]["trades"]["Insert"];
export type TradeUpdate = Database["public"]["Tables"]["trades"]["Update"];

export type CombinedTrade = Database["public"]["Tables"]["combined_trades"]["Row"];
export type CombinedTradeInsert = Database["public"]["Tables"]["combined_trades"]["Insert"];
export type CombinedTradeUpdate = Database["public"]["Tables"]["combined_trades"]["Update"];

export type PnlSeries = Database["public"]["Tables"]["pnl_series"]["Row"];
export type PnlSeriesInsert = Database["public"]["Tables"]["pnl_series"]["Insert"];
export type PnlSeriesUpdate = Database["public"]["Tables"]["pnl_series"]["Update"];

export type EquityCurve = Database["public"]["Tables"]["equity_curve"]["Row"];
export type EquityCurveInsert = Database["public"]["Tables"]["equity_curve"]["Insert"];
export type EquityCurveUpdate = Database["public"]["Tables"]["equity_curve"]["Update"];

export type Position = Database["public"]["Tables"]["positions"]["Row"];
export type PositionInsert = Database["public"]["Tables"]["positions"]["Insert"];
export type PositionUpdate = Database["public"]["Tables"]["positions"]["Update"];

export type PolymarketEquity = Database["public"]["Tables"]["polymarket_equity"]["Row"];
export type PolymarketPosition = Database["public"]["Tables"]["polymarket_positions"]["Row"];
export type PolymarketSymbolPnl = Database["public"]["Tables"]["polymarket_symbol_pnl"]["Row"];
export type BasisPair = Database["public"]["Tables"]["basis_pairs"]["Row"];
export type FundAccountEquity =
  Database["public"]["Tables"]["fund_account_equity"]["Row"];

// Run mode and status types
export type RunMode = StrategyRun["mode"];
export type RunStatus = StrategyRun["status"];
export type TradeSide = Trade["side"];
export type PositionSide = CombinedTrade["side"];

// Strategy with runs
export type StrategyWithRuns = Strategy & {
  strategy_runs: StrategyRun[];
};

// Run with strategy
export type RunWithStrategy = StrategyRun & {
  strategies: Strategy;
};
