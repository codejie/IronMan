import type { Instrument, MarketDataProvider, PriceBar, Timeframe } from "./types";

function seedFor(instrument: Instrument): number {
  return [...`${instrument.exchange}${instrument.code}`].reduce((total, char) => total + char.charCodeAt(0), 0);
}

function dateAt(offset: number, endDate?: string): string {
  const end = endDate === undefined ? new Date(Date.UTC(2026, 6, 20)) : new Date(`${endDate}T00:00:00.000Z`);
  const day = new Date(end.getTime() - offset * 24 * 60 * 60 * 1000);
  return day.toISOString().slice(0, 10);
}

export class MockMarketProvider implements MarketDataProvider {
  readonly source = "mock" as const;

  async history(instrument: Instrument, _timeframe: Timeframe, limit: number, endDate?: string): Promise<PriceBar[]> {
    const seed = seedFor(instrument);
    const bars: PriceBar[] = [];
    let previousClose = 8 + (seed % 320) / 10;
    for (let index = limit - 1; index >= 0; index -= 1) {
      const wave = Math.sin((index + seed) / 11) * 0.012;
      const trend = ((seed % 7) - 3) * 0.0008;
      const open = previousClose * (1 + wave / 2);
      const close = Math.max(0.01, open * (1 + wave + trend));
      const high = Math.max(open, close) * (1.008 + (seed % 3) * 0.002);
      const low = Math.min(open, close) * (0.992 - (seed % 2) * 0.001);
      bars.push({
        date: dateAt(index, endDate),
        open: Number(open.toFixed(3)),
        close: Number(close.toFixed(3)),
        high: Number(high.toFixed(3)),
        low: Number(low.toFixed(3)),
        volume: Math.round(400_000 + ((seed * 7919 + index * 10_007) % 5_000_000))
      });
      previousClose = close;
    }
    return bars;
  }
}
