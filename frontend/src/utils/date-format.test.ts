import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./date-format";

describe("date format", () => {
  it("formats dates as yyyy/mm/dd", () => {
    expect(formatDate("2026-07-22T09:08:07")).toBe("2026/07/22");
  });

  it("omits seconds when the source has no seconds", () => {
    expect(formatDateTime("2026-07-22T09:08")).toBe("2026/07/22 09:08");
  });

  it("keeps seconds when the source explicitly includes them", () => {
    expect(formatDateTime("2026-07-22T09:08:00")).toBe("2026/07/22 09:08:00");
  });

  it("renders an invalid date as a placeholder", () => {
    expect(formatDateTime("not-a-date")).toBe("-");
  });
});
