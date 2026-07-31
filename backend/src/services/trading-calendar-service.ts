import { errors } from "../errors";
import { SettingsService } from "./settings-service";

interface CalendarOverride {
  tradeDays: string[];
  nonTradingDays: string[];
}

interface TradingCalendarSetting {
  version: 2;
  overrides: Record<string, CalendarOverride>;
}

export interface TradingCalendarUpdate {
  year?: number;
  tradeDays?: string[];
  nonTradingDays?: string[];
}

export interface TradingCalendarYear {
  year: number;
  tradeDays: string[];
  nonTradingDays: string[];
}

export class TradingCalendarService {
  constructor(private readonly settings: SettingsService) {}

  getYear(userId: string, year = currentCalendarYear()): TradingCalendarYear {
    const value = this.settings.get(userId, "market.trading-calendar")?.value;
    return readTradingCalendar(value, year);
  }

  update(userId: string, input: TradingCalendarUpdate): TradingCalendarYear {
    const current = this.settings.get(userId, "market.trading-calendar")?.value;
    const setting = mergeTradingCalendar(current, input);
    this.settings.upsert(userId, "market.trading-calendar", setting);
    return readTradingCalendar(setting, input.year ?? currentCalendarYear());
  }

  getTradeDays(userId: string, startDate: string, endDate: string): string[] {
    if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || startDate > endDate) {
      throw errors.validation("交易日日期范围无效");
    }
    const startYear = Number(startDate.slice(0, 4));
    const endYear = Number(endDate.slice(0, 4));
    const days: string[] = [];
    for (let year = startYear; year <= endYear; year += 1) {
      days.push(...this.getYear(userId, year).tradeDays.filter((day) => day >= startDate && day <= endDate));
    }
    return days.sort();
  }
}

function currentCalendarYear(): number {
  return new Date().getFullYear();
}

function readTradingCalendar(value: unknown, year: number): TradingCalendarYear {
  const override = normalizeTradingCalendar(value).overrides[String(year)];
  const tradeDays = new Set(defaultTradeDays(year));
  if (override !== undefined) {
    override.nonTradingDays.forEach((day) => tradeDays.delete(day));
    override.tradeDays.forEach((day) => tradeDays.add(day));
  }
  return {
    year,
    tradeDays: [...tradeDays].sort(),
    nonTradingDays: override?.nonTradingDays ?? [],
  };
}

function mergeTradingCalendar(value: unknown, input: TradingCalendarUpdate): TradingCalendarSetting {
  const setting = normalizeTradingCalendar(value);
  if (input.tradeDays !== undefined) {
    const year = input.year ?? currentCalendarYear();
    const days = yearDays(year);
    const selected = new Set(input.tradeDays);
    if (input.tradeDays.some((day) => !days.includes(day))) {
      throw errors.validation("交易日必须属于所选年份");
    }
    const defaults = new Set(defaultTradeDays(year));
    setting.overrides[String(year)] = {
      tradeDays: [...selected].filter((day) => !defaults.has(day)).sort(),
      nonTradingDays: [...defaults].filter((day) => !selected.has(day)).sort(),
    };
    return setting;
  }

  const legacyDays = input.nonTradingDays ?? [];
  const grouped = new Map<string, string[]>();
  for (const day of legacyDays) {
    const year = day.slice(0, 4);
    grouped.set(year, [...(grouped.get(year) ?? []), day]);
  }
  for (const [year, days] of grouped) {
    setting.overrides[year] = {
      tradeDays: [],
      nonTradingDays: [...new Set(days)].sort(),
    };
  }
  return setting;
}

function normalizeTradingCalendar(value: unknown): TradingCalendarSetting {
  if (typeof value !== "object" || value === null) return { version: 2, overrides: {} };
  const raw = value as { version?: unknown; overrides?: unknown; nonTradingDays?: unknown };
  if (raw.version === 2 && typeof raw.overrides === "object" && raw.overrides !== null) {
    const overrides: Record<string, CalendarOverride> = {};
    for (const [year, candidate] of Object.entries(raw.overrides)) {
      if (typeof candidate !== "object" || candidate === null) continue;
      const item = candidate as Partial<CalendarOverride>;
      if (!Array.isArray(item.tradeDays) || !Array.isArray(item.nonTradingDays)) continue;
      if (![...item.tradeDays, ...item.nonTradingDays].every(isCalendarDate)) continue;
      overrides[year] = {
        tradeDays: [...new Set(item.tradeDays)].sort(),
        nonTradingDays: [...new Set(item.nonTradingDays)].sort(),
      };
    }
    return { version: 2, overrides };
  }
  if (Array.isArray(raw.nonTradingDays) && raw.nonTradingDays.every(isCalendarDate)) {
    const overrides: Record<string, CalendarOverride> = {};
    for (const day of raw.nonTradingDays) {
      const year = day.slice(0, 4);
      const current = overrides[year] ?? { tradeDays: [], nonTradingDays: [] };
      current.nonTradingDays.push(day);
      overrides[year] = current;
    }
    Object.values(overrides).forEach((override) => {
      override.nonTradingDays = [...new Set(override.nonTradingDays)].sort();
    });
    return { version: 2, overrides };
  }
  return { version: 2, overrides: {} };
}

function defaultTradeDays(year: number): string[] {
  return yearDays(year).filter((day) => {
    const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
    return weekday !== 0 && weekday !== 6;
  });
}

function yearDays(year: number): string[] {
  const days: string[] = [];
  const current = new Date(Date.UTC(year, 0, 1));
  while (current.getUTCFullYear() === year) {
    days.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}
