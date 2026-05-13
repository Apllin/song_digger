const POPULAR_LABELS = [
  "Tresor",
  "Ostgut Ton",
  "трип",
  "Lotus Parable",
  "Hypnus Records",
  "Another Psyde Records",
  "SK_Eleven",
];

interface PopularLabelsProps {
  selectedLabelName: string | undefined;
  onSelect: (name: string) => void;
}

export function PopularLabels({ selectedLabelName, onSelect }: PopularLabelsProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono-td text-[10px] uppercase tracking-[0.14em] text-td-fg">Popular techno labels</p>
      <div className="flex flex-wrap gap-2 sm:gap-3">
        {POPULAR_LABELS.map((name) => {
          const active = selectedLabelName === name;
          return (
            <button
              key={name}
              onClick={() => onSelect(name)}
              className="px-3 py-2 sm:px-4 sm:py-2.5 text-[12px] sm:text-[13px] font-medium rounded-lg border transition-colors whitespace-nowrap"
              style={{
                color: active ? "var(--td-fg)" : "var(--td-fg-d)",
                background: "rgba(14, 16, 28, 0.78)",
                borderColor: active ? "var(--td-accent)" : "rgba(255, 255, 255, 0.22)",
                boxShadow: active
                  ? "0 0 0 1px var(--td-accent-soft), 0 6px 18px rgba(0,0,0,0.35)"
                  : "0 6px 18px rgba(0,0,0,0.3)",
                backdropFilter: "blur(20px) saturate(140%)",
                WebkitBackdropFilter: "blur(20px) saturate(140%)",
              }}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
