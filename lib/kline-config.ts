export interface KlineConfig {
  days: number;
  label: string;
  intervalMinutes: number;
  displayKlines: number;
  fetchKlines: number; // extra klines for MA calculation
  maWindow: number; // number of klines representing ~1 day
}

export const KLINE_CONFIGS: KlineConfig[] = [
  { days: 1, label: "1D", intervalMinutes: 1, displayKlines: 1440, fetchKlines: 2880, maWindow: 1440 },
  { days: 3, label: "3D", intervalMinutes: 5, displayKlines: 864, fetchKlines: 1152, maWindow: 288 },
  { days: 7, label: "7D", intervalMinutes: 15, displayKlines: 672, fetchKlines: 768, maWindow: 96 },
  { days: 14, label: "14D", intervalMinutes: 30, displayKlines: 672, fetchKlines: 720, maWindow: 48 },
  { days: 30, label: "30D", intervalMinutes: 60, displayKlines: 720, fetchKlines: 744, maWindow: 24 },
];

export function getKlineConfig(days: number): KlineConfig {
  return KLINE_CONFIGS.find((c) => c.days === days) ?? KLINE_CONFIGS[0];
}
