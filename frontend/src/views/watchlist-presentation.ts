import type { Instrument } from "@/api/client";
import { instrumentTypeLabel } from "./instrument-kline-presentation";

export const DEFAULT_REALTIME_ENABLED = false;

export function watchlistInstrumentType(instrument: Pick<Instrument, "assetType" | "code">): string {
  return instrumentTypeLabel(instrument);
}

export function watchlistCodeLabel(instrument: Pick<Instrument, "assetType" | "code">): string {
  return `[${watchlistInstrumentType(instrument)}] ${instrument.code}`;
}
