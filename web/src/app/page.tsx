import { format, parseISO } from "date-fns";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 60;

type DailyRow = { day: string; service: string; total_cost: string | null; events: string };
type RecentRow = {
  id: string;
  ts: string;
  service: string;
  provider: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string | null;
  duration_ms: number | null;
};
type SummaryRow = {
  scope: string;
  total_cost: string | null;
  events: string;
};

const SERVICES = ["claude-code-agent", "foundry-interpret"] as const;

const SERVICE_COLOR: Record<string, string> = {
  "claude-code-agent": "bg-orange-500",
  "foundry-interpret": "bg-blue-500",
};

function fmtUsd(n: string | number | null | undefined): string {
  const v = typeof n === "string" ? parseFloat(n) : n ?? 0;
  if (!v && v !== 0) return "—";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

export default async function CostPage() {
  // Three queries in parallel.
  const [summary, daily, recent] = await Promise.all([
    query<SummaryRow>(`
      SELECT 'today' AS scope, SUM(cost_usd)::text AS total_cost, COUNT(*)::text AS events
      FROM cost_event WHERE ts >= date_trunc('day', NOW())
      UNION ALL
      SELECT '7d', SUM(cost_usd)::text, COUNT(*)::text
      FROM cost_event WHERE ts >= NOW() - INTERVAL '7 days'
      UNION ALL
      SELECT '30d', SUM(cost_usd)::text, COUNT(*)::text
      FROM cost_event WHERE ts >= NOW() - INTERVAL '30 days'
      UNION ALL
      SELECT 'mtd', SUM(cost_usd)::text, COUNT(*)::text
      FROM cost_event WHERE ts >= date_trunc('month', NOW())
    `),
    query<DailyRow>(`
      SELECT to_char(date_trunc('day', ts), 'YYYY-MM-DD') AS day,
             service,
             SUM(cost_usd)::text AS total_cost,
             COUNT(*)::text AS events
      FROM cost_event
      WHERE ts >= NOW() - INTERVAL '30 days'
      GROUP BY day, service
      ORDER BY day ASC, service ASC
    `),
    query<RecentRow>(`
      SELECT id::text, ts::text, service, provider, model,
             input_tokens, output_tokens,
             cost_usd::text,
             duration_ms
      FROM cost_event
      ORDER BY ts DESC
      LIMIT 50
    `),
  ]);

  const summaryByScope = new Map(summary.map((s) => [s.scope, s]));

  // Build a 30-day series, fill missing days with 0.
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const dailyMap = new Map<string, Map<string, number>>();
  for (const r of daily) {
    if (!dailyMap.has(r.day)) dailyMap.set(r.day, new Map());
    dailyMap.get(r.day)!.set(r.service, parseFloat(r.total_cost ?? "0") || 0);
  }
  const dailyMax = Math.max(
    0.01,
    ...days.map((d) =>
      [...(dailyMap.get(d)?.values() ?? [0])].reduce((a, b) => a + b, 0),
    ),
  );

  return (
    <main className="max-w-6xl mx-auto px-5 py-12">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">cost</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          AI spend across services on this VM. Refreshes every 60s.
        </p>
        <p className="text-xs text-neutral-500 dark:text-neutral-500 mt-1">
          Numbers are estimates: Claude Code agent runs are flat per-run guesses
          (subscription quota — no per-call API to read exact $); Foundry calls
          use response token counts × per-model rate. Authoritative billing is in
          Azure Cost Management / your Anthropic console.
        </p>
      </header>

      {/* Top totals */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
        {[
          { key: "today", label: "Today" },
          { key: "7d", label: "Last 7 days" },
          { key: "30d", label: "Last 30 days" },
          { key: "mtd", label: "Month to date" },
        ].map(({ key, label }) => {
          const r = summaryByScope.get(key);
          const cost = parseFloat(r?.total_cost ?? "0") || 0;
          const events = parseInt(r?.events ?? "0", 10);
          return (
            <div
              key={key}
              className="border border-neutral-200 dark:border-neutral-800 rounded-md p-4 bg-white dark:bg-neutral-900"
            >
              <div className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                {label}
              </div>
              <div className="mt-2 text-xl font-semibold">{fmtUsd(cost)}</div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                {events} event{events === 1 ? "" : "s"}
              </div>
            </div>
          );
        })}
      </section>

      {/* Daily chart */}
      <section className="mb-12">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-500 mb-3">
          Last 30 days
        </h2>
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-md p-4 bg-white dark:bg-neutral-900 overflow-x-auto">
          <div className="flex items-end gap-[3px] h-40">
            {days.map((d) => {
              const byService = dailyMap.get(d);
              const stacks = SERVICES.map((s) => ({
                service: s,
                cost: byService?.get(s) ?? 0,
              }));
              const total = stacks.reduce((a, b) => a + b.cost, 0);
              const totalPct = (total / dailyMax) * 100;
              return (
                <div key={d} className="flex-1 min-w-[10px] flex flex-col items-stretch group relative" title={`${d}: ${fmtUsd(total)}`}>
                  <div className="flex-1" />
                  <div className="flex flex-col-reverse" style={{ height: `${totalPct}%` }}>
                    {stacks.map((s) =>
                      s.cost === 0 ? null : (
                        <div
                          key={s.service}
                          className={SERVICE_COLOR[s.service] ?? "bg-neutral-400"}
                          style={{ height: `${(s.cost / total) * 100}%` }}
                        />
                      ),
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] font-mono text-neutral-500 mt-2">
            <span>{days[0]}</span>
            <span>{days[Math.floor(days.length / 2)]}</span>
            <span>{days.at(-1)}</span>
          </div>
          <div className="flex gap-4 mt-3 text-xs text-neutral-600 dark:text-neutral-400">
            {SERVICES.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={`inline-block w-2.5 h-2.5 rounded-sm ${SERVICE_COLOR[s]}`} />
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Recent events */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-500 mb-3">
          Recent events
        </h2>
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-md bg-white dark:bg-neutral-900 overflow-x-auto">
          {recent.length === 0 ? (
            <p className="p-4 text-sm text-neutral-500">
              No cost events yet. Trigger an agent run or click an "AI explain" button on /feed.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Time</th>
                  <th className="text-left px-3 py-2 font-medium">Service</th>
                  <th className="text-left px-3 py-2 font-medium">Model</th>
                  <th className="text-right px-3 py-2 font-medium">In tok</th>
                  <th className="text-right px-3 py-2 font-medium">Out tok</th>
                  <th className="text-right px-3 py-2 font-medium">Duration</th>
                  <th className="text-right px-3 py-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => {
                  const ts = (() => {
                    try {
                      return format(parseISO(r.ts), "MM-dd HH:mm");
                    } catch {
                      return r.ts.slice(0, 16);
                    }
                  })();
                  return (
                    <tr
                      key={r.id}
                      className="border-t border-neutral-100 dark:border-neutral-800 first:border-t-0"
                    >
                      <td className="px-3 py-1.5 font-mono text-xs">{ts}</td>
                      <td className="px-3 py-1.5">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${SERVICE_COLOR[r.service] ?? "bg-neutral-400"}`} />
                        {r.service}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-neutral-600 dark:text-neutral-400 truncate max-w-[14rem]">
                        {r.model ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">
                        {r.input_tokens ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">
                        {r.output_tokens ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs text-neutral-600 dark:text-neutral-400">
                        {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmtUsd(r.cost_usd)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}
