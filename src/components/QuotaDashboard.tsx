import { Loader2, RefreshCw } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { formatPlanSpend } from "@/lib/plan-spend";
import type { LocaleKey } from "@/locales";
import {
  WindowRow,
  providerError,
  providerLabel,
  usePlanUsage,
  windowLabel,
  type PlanProvider,
  type PlanUsageReport,
} from "./PlanUsage";

/** Providers in the order the dashboard lists them; anything else follows, in the order the server sent it. */
const GROUP_ORDER = ["claude", "codex", "grok", "opencode"] as const;
const GROUP_TITLE: Record<(typeof GROUP_ORDER)[number], LocaleKey> = {
  claude: "quota.group.claude",
  codex: "quota.group.codex",
  grok: "quota.group.grok",
  opencode: "quota.group.opencode",
};
/** At or past this much used, an account counts as near its limit. */
const NEAR_LIMIT = 90;

export interface QuotaGroup {
  driver: string;
  accounts: PlanProvider[];
}

export interface QuotaSummary {
  accounts: number;
  reporting: number;
  nearLimit: number;
  failed: number;
}

/** The share of the tightest window an account still has, or null when it reports none. */
export function tightestLeft(provider: Pick<PlanProvider, "ok" | "fiveHour" | "weekly" | "extra">): number | null {
  if (!provider.ok) return null;
  const left: number[] = [];
  for (const window of [provider.fiveHour, provider.weekly]) {
    if (window.available && window.remainingPercent !== null) left.push(window.remainingPercent);
  }
  for (const extra of provider.extra) left.push(extra.remainingPercent);
  return left.length ? Math.min(...left) : null;
}

/** One group per provider, each with its accounts: the most used first, accounts that report nothing last. */
export function groupQuota(providers: readonly PlanProvider[]): QuotaGroup[] {
  const byDriver = new Map<string, PlanProvider[]>();
  for (const provider of providers) byDriver.set(provider.driver, [...(byDriver.get(provider.driver) ?? []), provider]);
  const known: readonly string[] = GROUP_ORDER;
  const drivers = [...GROUP_ORDER.filter((driver) => byDriver.has(driver)), ...[...byDriver.keys()].filter((driver) => !known.includes(driver))];
  return drivers.map((driver) => ({
    driver,
    accounts: [...byDriver.get(driver)!].sort((a, b) => (tightestLeft(a) ?? 101) - (tightestLeft(b) ?? 101)),
  }));
}

export function summarizeQuota(report: Pick<PlanUsageReport, "providers"> | null): QuotaSummary {
  const providers = report?.providers ?? [];
  let reporting = 0;
  let nearLimit = 0;
  let failed = 0;
  for (const provider of providers) {
    if (!provider.ok) { failed += 1; continue; }
    const left = tightestLeft(provider);
    if (left === null) continue;
    reporting += 1;
    if (100 - left >= NEAR_LIMIT) nearLimit += 1;
  }
  return { accounts: providers.length, reporting, nearLimit, failed };
}

function groupTitle(driver: string): string {
  return driver in GROUP_TITLE ? t(GROUP_TITLE[driver as keyof typeof GROUP_TITLE]) : driver;
}

function checkedAgo(fetchedAt: string, now: number): string | null {
  const at = Date.parse(fetchedAt);
  if (!Number.isFinite(at)) return null;
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  return minutes < 1 ? t("quota.checkedNow") : t("quota.checkedAgo", { minutes: String(minutes) });
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" | "bad" }) {
  return (
    <div className="min-w-0 rounded-lg bg-inset px-3 py-2">
      <div className={cn("text-[20px] font-semibold leading-6 tabular-nums text-ink", value > 0 && tone === "warn" && "text-warning", value > 0 && tone === "bad" && "text-danger")}>{value}</div>
      <div className="truncate text-[12px] text-ink-secondary">{label}</div>
    </div>
  );
}

function AccountCard({ provider, now }: { provider: PlanProvider; now: number }) {
  const left = tightestLeft(provider);
  const near = left !== null && 100 - left >= NEAR_LIMIT;
  const models = provider.models ?? [];
  return (
    <article data-quota-account={provider.id} className="flex min-w-0 flex-col gap-3 rounded-xl border-[0.5px] border-hairline/50 bg-card p-3.5">
      <header className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium text-ink">{providerLabel(provider)}</div>
          {provider.plan && <div className="truncate text-[12px] text-ink-secondary">{provider.plan}</div>}
        </div>
        {provider.ok && left !== null && (
          <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-medium tabular-nums", near ? "bg-danger/12 text-danger" : "bg-inset text-ink-secondary")}>
            {t("planUsage.left", { remaining: Math.round(left) })}
          </span>
        )}
      </header>
      {provider.ok ? (
        <div className="flex flex-col gap-2">
          <WindowRow label={t("planUsage.fiveHour")} window={provider.fiveHour} now={now} />
          <WindowRow label={t("planUsage.weekly")} window={provider.weekly} now={now} />
          {provider.extra.map((extra, index) => (
            <WindowRow
              key={`${extra.label}-${index}`}
              label={windowLabel(extra.label)}
              now={now}
              usedHeadline={Boolean(extra.spend)}
              detail={extra.spend ? formatPlanSpend(extra.spend) : undefined}
              window={{ available: true, remainingPercent: extra.remainingPercent, usedPercent: extra.usedPercent, resetsAt: extra.resetsAt }}
            />
          ))}
          {models.length > 0 && (
            <details className="group mt-0.5">
              <summary className="cursor-pointer select-none text-[12px] text-ink-secondary hover:text-ink">{t("planUsage.byModel")} ({models.length})</summary>
              <div className="mt-2 flex flex-col gap-2">
                {models.map((model) => (
                  <div key={model.name} className="flex flex-col gap-1">
                    <div className="truncate text-[13px] font-medium text-ink">{model.name}</div>
                    {model.windows.map((entry, index) => (
                      <WindowRow
                        key={`${model.name}-${entry.label}-${index}`}
                        label={windowLabel(entry.label)}
                        now={now}
                        usedHeadline
                        window={{ available: true, remainingPercent: entry.remainingPercent, usedPercent: entry.usedPercent, resetsAt: entry.resetsAt }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      ) : (
        <p role="status" className="text-[13px] text-danger">{providerError(provider)}</p>
      )}
    </article>
  );
}

/** Every signed-in AI account's allowance on one page, grouped by provider: Claude, ChatGPT (Codex), Grok and OpenCode. */
export function QuotaDashboard() {
  const { report, loading, error, now, load } = usePlanUsage();
  const summary = summarizeQuota(report);
  const groups = report ? groupQuota(report.providers) : [];
  const checked = report ? checkedAgo(report.fetchedAt, now) : null;
  return (
    <section data-quota-dashboard aria-label={t("quota.title")} className="flex flex-col gap-4 rounded-2xl bg-card p-4 max-md:rounded-2xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold text-ink">{t("quota.title")}</h3>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-secondary">{t("quota.subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {checked && <span className="text-[12px] text-ink-tertiary">{checked}</span>}
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            aria-label={t("planUsage.refresh")}
            title={t("planUsage.refresh")}
            className="rounded-md p-2 text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </div>
      {loading && !report && <p role="status" className="text-[13px] text-ink-secondary">{t("planUsage.loading")}</p>}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      {report && report.providers.length === 0 && <p className="text-[13px] text-ink-secondary">{t("planUsage.empty")}</p>}
      {report && report.providers.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-quota-summary>
            <Stat label={t("quota.stat.accounts")} value={summary.accounts} />
            <Stat label={t("quota.stat.reporting")} value={summary.reporting} />
            <Stat label={t("quota.stat.near")} value={summary.nearLimit} tone="warn" />
            <Stat label={t("quota.stat.failed")} value={summary.failed} tone="bad" />
          </div>
          {groups.map((group) => (
            <div key={group.driver} data-quota-group={group.driver} className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <h4 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">{groupTitle(group.driver)}</h4>
                <span className="text-[12px] text-ink-tertiary">{t("quota.accountCount", { count: String(group.accounts.length) })}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {group.accounts.map((provider) => <AccountCard key={provider.id} provider={provider} now={now} />)}
              </div>
            </div>
          ))}
          <p className="text-[12px] leading-relaxed text-ink-tertiary">{t("quota.chatgptNote")}</p>
        </>
      )}
    </section>
  );
}
