import type { Instrument } from "@/api/client";

export type InstrumentKlineLabel = Pick<Instrument, "assetType" | "code" | "name">;
export type InstrumentKlineTarget = InstrumentKlineLabel & Pick<Instrument, "id">;

export function instrumentTypeLabel(instrument: Pick<Instrument, "assetType" | "code">): string {
  if (instrument.assetType === "stock") return "股票";
  if (instrument.assetType === "index") return "指数";
  if (/^(160|161|162|163|164|165|166|167|168|169|501|502)/.test(instrument.code)) return "LOF";
  if (/^(1|5)/.test(instrument.code)) return "ETF";
  return "基金";
}

export function instrumentCodeLabel(instrument: Pick<Instrument, "assetType" | "code">): string {
  return `${instrument.code} [${instrumentTypeLabel(instrument)}]`;
}

export function instrumentKlineTitle(instrument: InstrumentKlineLabel): string {
  return `${instrument.name} ${instrumentCodeLabel(instrument)}`;
}
