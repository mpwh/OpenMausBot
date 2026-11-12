import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ report: null as unknown }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [initial === null ? fixture.report : initial === true ? false : typeof initial === "function" ? (initial as () => unknown)() : initial, () => {}],
}));
vi.mock("@/state/store", () => ({ api: vi.fn() }));
import { QuotaDashboard, groupQuota, summarizeQuota, tightestLeft } from "./QuotaDashboard";
import type { PlanProvider } from "./PlanUsage";

const none = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };
const win = (used: number) => ({ available: true, remainingPercent: 100 - used, usedPercent: used, resetsAt: null });
const account = (id: string, driver: string, five: number | null, weekly: number | null, extra: Partial<PlanProvider> = {}): PlanProvider => ({
  id, name: id, driver, plan: null, ok: true, error: null,
  fiveHour: five === null ? none : win(five), weekly: weekly === null ? none : win(weekly), extra: [], models: [], ...extra,
});

describe("Quota dashboard", () => {
  it("takes the tightest window as what an account has left", () => {
    expect(tightestLeft(account("a", "claude", 8, 64))).toBe(36);
    expect(tightestLeft(account("a", "claude", null, null))).toBeNull();
    expect(tightestLeft(account("a", "claude", 8, 64, { ok: false }))).toBeNull();
  });

  it("groups accounts by provider, Claude first, the most used account first", () => {
    const groups = groupQuota([
      account("codex-1", "codex", 10, 10), account("claude-quiet", "claude", 5, 5), account("claude-busy", "claude", 40, 95),
      account("other", "mystery", 1, 1), account("grok-1", "grok", 20, null),
    ]);
    expect(groups.map((group) => group.driver)).toEqual(["claude", "codex", "grok", "mystery"]);
    expect(groups[0]!.accounts.map((entry) => entry.id)).toEqual(["claude-busy", "claude-quiet"]);
  });

  it("counts accounts, the ones reporting, those near their limit and the ones that failed", () => {
    expect(summarizeQuota({ providers: [
      account("a", "claude", 5, 5), account("b", "claude", 91, 20), account("c", "codex", null, null),
      account("d", "codex", 0, 0, { ok: false, error: "Sign in again in Codex" }),
    ] })).toEqual({ accounts: 4, reporting: 2, nearLimit: 1, failed: 1 });
    expect(summarizeQuota(null)).toEqual({ accounts: 0, reporting: 0, nearLimit: 0, failed: 0 });
  });

  it("lists two Claude accounts side by side with their own windows", () => {
    fixture.report = {
      fetchedAt: "2026-10-02T09:00:00Z",
      providers: [account("claude-a", "claude", 8, 64, { plan: "Max" }), account("claude-b", "claude", 30, 12), account("codex-1", "codex", 50, 25)],
    };
    const html = renderToStaticMarkup(createElement(QuotaDashboard));
    expect(html).toContain('data-quota-group="claude"');
    expect(html).toContain('data-quota-group="codex"');
    expect(html).toContain('data-quota-account="claude-a"');
    expect(html).toContain('data-quota-account="claude-b"');
    expect(html).toContain("36% left");
    expect(html).toContain("Near limit");
  });

  it("explains an account that cannot be read", () => {
    fixture.report = { fetchedAt: "2026-10-02T09:00:00Z", providers: [account("claude-a", "claude", 0, 0, { ok: false, error: "Sign in again in Claude" })] };
    expect(renderToStaticMarkup(createElement(QuotaDashboard))).toContain("Sign in again in Claude");
  });
});
