import type {
  DailyFeedback,
  FeedbackTotals,
  ModelHistoryEntry,
  SourceHitRate,
} from "@/features/admin/server/loadStats";

interface TrainStatsProps {
  totals: FeedbackTotals;
  perDay: DailyFeedback[];
  sources: SourceHitRate[];
  history: ModelHistoryEntry[];
}

export function TrainStats({ totals, perDay, sources, history }: TrainStatsProps) {
  return (
    <div className="flex flex-col gap-6">
      <FeedbackPanel totals={totals} perDay={perDay} />
      <SourceHitRatePanel sources={sources} />
      <ModelHistoryPanel history={history} />
    </div>
  );
}

function FeedbackPanel({ totals, perDay }: { totals: FeedbackTotals; perDay: DailyFeedback[] }) {
  const max = Math.max(1, ...perDay.map((d) => d.count));
  const totalLast14 = perDay.reduce((sum, d) => sum + d.count, 0);
  return (
    <section className="rounded-lg border border-td-hair p-4">
      <h2 className="text-lg font-semibold mb-3">Feedback accumulation</h2>
      <div className="flex gap-6 font-mono-td text-sm mb-4">
        <span>
          Total: <strong className="text-td-fg">{totals.total}</strong>
        </span>
        <span className="text-td-fg-m">
          yes <strong className="text-td-fg">{totals.yes}</strong> · no{" "}
          <strong className="text-td-fg">{totals.no}</strong>
        </span>
        <span className="text-td-fg-m">
          last 14 d <strong className="text-td-fg">{totalLast14}</strong>
        </span>
      </div>
      <div className="flex items-end gap-1 h-24">
        {perDay.map((d) => (
          <div key={d.day} className="flex-1 flex flex-col items-stretch justify-end" title={`${d.day}: ${d.count}`}>
            <div
              className="rounded-sm transition-colors"
              style={{
                height: `${(d.count / max) * 100}%`,
                minHeight: d.count > 0 ? "2px" : "0",
                background: d.count > 0 ? "var(--td-accent)" : "var(--td-hair)",
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-2 text-[10px] font-mono-td text-td-fg-d">
        <span>{perDay[0]?.day.slice(5)}</span>
        <span>{perDay[perDay.length - 1]?.day.slice(5)}</span>
      </div>
    </section>
  );
}

function SourceHitRatePanel({ sources }: { sources: SourceHitRate[] }) {
  return (
    <section className="rounded-lg border border-td-hair p-4">
      <h2 className="text-lg font-semibold mb-1">Per-source hit-rate</h2>
      <p className="text-xs text-td-fg-d mb-3">
        Of the tracks a source surfaced and a trainer rated, share marked &ldquo;similar&rdquo;.
      </p>
      {sources.length === 0 ? (
        <p className="text-td-fg-m text-sm">No labeled feedback yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sources.map((s) => (
            <div key={s.source} className="grid grid-cols-[160px_1fr_120px] gap-3 items-center font-mono-td text-sm">
              <span className="truncate">{s.source}</span>
              <div className="h-3 rounded-sm overflow-hidden" style={{ background: "var(--td-hair)" }}>
                <div
                  className="h-full"
                  style={{
                    width: `${s.rate * 100}%`,
                    background: rateColor(s.rate),
                  }}
                />
              </div>
              <span className="text-td-fg-d text-right">
                {Math.round(s.rate * 100)}% · {s.similar}/{s.total}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function rateColor(rate: number): string {
  // Red → amber → green band. 50% is the baseline (coin-flip).
  if (rate >= 0.65) return "#4ade80";
  if (rate >= 0.45) return "#facc15";
  return "#f87171";
}

function ModelHistoryPanel({ history }: { history: ModelHistoryEntry[] }) {
  return (
    <section className="rounded-lg border border-td-hair p-4">
      <h2 className="text-lg font-semibold mb-3">Recent training runs</h2>
      {history.length === 0 ? (
        <p className="text-td-fg-m text-sm">No models trained yet.</p>
      ) : (
        <div className="font-mono-td text-sm">
          <div className="grid grid-cols-[80px_1fr_120px] gap-3 text-xs uppercase tracking-wider text-td-fg-d pb-2 border-b border-td-hair">
            <span>Version</span>
            <span>Trained at (UTC)</span>
            <span className="text-right">Sample size</span>
          </div>
          {history.map((h) => (
            <div key={h.version} className="grid grid-cols-[80px_1fr_120px] gap-3 py-1.5">
              <span>v{h.version}</span>
              <span className="text-td-fg-m">{h.trainedAt.toISOString().replace("T", " ").slice(0, 19)}</span>
              <span className="text-right">{h.sampleSize}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
