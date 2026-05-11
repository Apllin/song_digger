type NavigableListProps<T> = {
  items: T[];
  activeIndex: number;
  onHover: (index: number) => void;
  onLeave: () => void;
  onSelect: (index: number) => void;
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T, index: number) => string;
  header?: React.ReactNode;
};

export function NavigableList<T>({
  items,
  activeIndex,
  onHover,
  onLeave,
  onSelect,
  renderItem,
  keyExtractor,
  header,
}: NavigableListProps<T>) {
  return (
    <ul
      className="absolute z-50 top-full mt-2 left-0 right-0 rounded-2xl overflow-hidden shadow-2xl border backdrop-blur"
      style={{ background: "rgba(20,18,26,0.92)", borderColor: "rgba(255, 255, 255, 0.18)" }}
    >
      {header && (
        <li className="px-5 py-2 font-mono-td text-[10px] uppercase tracking-[0.14em] text-td-fg-m">{header}</li>
      )}
      {items.map((item, i) => (
        <li key={keyExtractor(item, i)}>
          <button
            onMouseEnter={() => onHover(i)}
            onMouseLeave={onLeave}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(i);
            }}
            className="w-full flex items-center gap-3 px-5 py-3 text-sm transition-colors text-left"
            style={{
              background: i === activeIndex ? "rgba(255, 255, 255, 0.10)" : "transparent",
              color: i === activeIndex ? "var(--td-fg)" : "var(--td-fg-d)",
            }}
          >
            {renderItem(item, i)}
          </button>
        </li>
      ))}
    </ul>
  );
}
