import { describe, expect, it } from "vitest";
import { effectivePage, isStale, nextQuery, rpcErrorMessage } from "./api.js";

describe("nextQuery", () => {
  it("resets page after a filter change", () => {
    const current = {
      page: 3,
      pageSize: 50,
      q: "old",
      kind: undefined as "fact" | undefined,
    };
    expect(nextQuery(current, { q: "new" })).toEqual({
      page: 1,
      pageSize: 50,
      q: "new",
      kind: undefined,
    });
    expect(nextQuery(current, { kind: "fact" })).toEqual({
      page: 1,
      pageSize: 50,
      q: "old",
      kind: "fact",
    });
  });

  it("keeps pageSize literal when changing a filter", () => {
    const current = { page: 2, pageSize: 20 as const };
    const next = nextQuery(current, { kind: "fact" });
    expect(next.page).toBe(1);
    expect(next.pageSize).toBe(20);
  });
});

describe("effectivePage", () => {
  it("keeps total-zero pagination on page one", () => {
    expect(effectivePage(5, 0, 20)).toBe(1);
  });

  it("falls back to the last page when requested page is out of range", () => {
    expect(effectivePage(5, 45, 20)).toBe(3);
  });

  it("keeps a valid page", () => {
    expect(effectivePage(2, 45, 20)).toBe(2);
  });
});

describe("isStale", () => {
  it("ignores a stale request sequence", () => {
    expect(isStale(3, 2)).toBe(true);
    expect(isStale(3, 3)).toBe(false);
    expect(isStale(3, 4)).toBe(false);
  });
});

describe("rpcErrorMessage", () => {
  it("maps known RPC codes to user-facing text", () => {
    expect(rpcErrorMessage({ code: "unauthenticated", message: "x" })).toContain("会话");
    expect(rpcErrorMessage({ code: "permission_denied", message: "x" })).toContain("权限");
    expect(rpcErrorMessage({ code: "not_found", message: "x" })).toContain("未找到");
  });
});

// Ensure the module surface does not retain bearer tokens.  This is a static
// shape check: login() accepts bearer as an argument but no exported symbol
// stores it.
describe("security surface", () => {
  it("does not retain the bearer after login", async () => {
    const exported = Object.keys(await import("./api.js"));
    expect(exported).not.toContain("bearer");
    expect(exported).not.toContain("currentBearer");
  });
});
