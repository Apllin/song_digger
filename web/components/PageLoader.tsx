// Overlay spinner for "loading the next page" — sits absolutely inside a
// `relative` wrapper above the (dimmed) current page so Prev/Next never
// unmounts the grid. Centered horizontally, pinned near the top so it stays
// visible regardless of how tall the grid is.
export function PageLoader() {
  return (
    <div className="absolute inset-x-0 top-10 flex justify-center pointer-events-none">
      <svg className="w-7 h-7 animate-spin" fill="none" viewBox="0 0 24 24" style={{ color: "var(--td-accent)" }}>
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
    </div>
  );
}
