import { describe, expect, test } from "vitest";
import { menuFor } from "./menu";

describe("navigation visibility", () => {
  test("shows only shipped personal routes to a regular user", () => {
    const items = menuFor("user", ["P0"]);

    expect(items.flatMap((group) => group.items).map((item) => item.to)).toEqual(["/settings/profile"]);
  });

  test("shows administrator routes only to an administrator", () => {
    const items = menuFor("admin", ["P0"]);
    const paths = items.flatMap((group) => group.items).map((item) => item.to);

    expect(paths).toContain("/admin/users");
    expect(paths).toContain("/admin/audit-logs");
    expect(paths).toContain("/admin/system");
  });

  test("adds the P1 investment workspace without exposing future automation", () => {
    const paths = menuFor("user", ["P0", "P1"]).flatMap((group) => group.items).map((item) => item.to);

    expect(paths).toContain("/dashboard");
    expect(paths).toContain("/assets/watchlist");
    expect(paths).toContain("/assets/holdings");
    expect(paths).toContain("/analysis/charts");
    expect(paths).not.toContain("/automation/schedules");
  });

  test("releases analysis and automation as P2 user workflows", () => {
    const paths = menuFor("user", ["P0", "P1", "P2"]).flatMap((group) => group.items).map((item) => item.to);

    expect(paths).toContain("/analysis/strategies");
    expect(paths).toContain("/analysis/tasks");
    expect(paths).toContain("/automation/schedules");
    expect(paths).toContain("/automation/alerts");
  });

  test("keeps personal notes and data portability in the P3 release", () => {
    const paths = menuFor("user", ["P0", "P1", "P2", "P3"]).flatMap((group) => group.items).map((item) => item.to);

    expect(paths).toContain("/notes");
    expect(paths).toContain("/settings/data");
    expect(paths).toContain("/assistant/chat");
  });
});
