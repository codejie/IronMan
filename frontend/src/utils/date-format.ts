export type DateValue = Date | string | null | undefined;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_WITH_SECONDS_PATTERN = /(?:T|\s)\d{2}:\d{2}:\d{2}(?:[.,]\d+)?/;

function toDate(value: DateValue): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (DATE_ONLY_PATTERN.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year!, month! - 1, day!);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDatePart(date: Date): string {
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

export function formatDate(value: DateValue): string {
  const date = toDate(value);
  return date === null ? "-" : formatDatePart(date);
}

export function formatDateTime(value: DateValue): string {
  const date = toDate(value);
  if (date === null) return "-";

  const formatted = `${formatDatePart(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const includesSeconds = value instanceof Date || typeof value === "string" && TIME_WITH_SECONDS_PATTERN.test(value);
  return includesSeconds ? `${formatted}:${pad(date.getSeconds())}` : formatted;
}
