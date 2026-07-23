import { describe, expect, test } from "vitest";
import { holdingDetailRouteQuery, holdingNavigationTarget } from "./holding-detail-presentation";

describe("holding detail presentation", () => {
  test("preserves the holding-list order in the detail route", () => {
    expect(holdingDetailRouteQuery("second", ["first", "second", "third"])).toEqual({ id: "second", ids: "first,second,third" });
    expect(holdingDetailRouteQuery("outside", ["first", "first"])).toEqual({ id: "outside", ids: "outside,first" });
  });

  test("navigates only within the selected holding list", () => {
    expect(holdingNavigationTarget(["first", "second", "third"], "second", -1)).toBe("first");
    expect(holdingNavigationTarget(["first", "second", "third"], "second", 1)).toBe("third");
    expect(holdingNavigationTarget(["first"], "first", -1)).toBeNull();
  });
});
