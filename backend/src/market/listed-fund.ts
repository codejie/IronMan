import type { Instrument } from "./types";

export function listedFundExchange(instrument: Instrument): "sh" | "sz" | undefined {
  if (instrument.assetType !== "fund" || instrument.exchange !== "fund") return undefined;
  if (instrument.code.startsWith("5")) return "sh";
  if (instrument.code.startsWith("1")) return "sz";
  return undefined;
}
