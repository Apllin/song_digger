export function LabelsHero() {
  return (
    <div className="pt-2 sm:pt-4">
      <h1
        className="font-display text-td-fg m-0"
        style={{
          fontSize: "clamp(34px, 6.5vw, 84px)",
          lineHeight: 0.9,
          letterSpacing: "-0.02em",
          fontWeight: 600,
        }}
      >
        Labels
      </h1>
      <p className="mt-4 text-[18px] sm:text-[20px] font-semibold text-td-fg">Browse releases by record label</p>
    </div>
  );
}
