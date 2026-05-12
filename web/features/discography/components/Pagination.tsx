interface PaginationProps {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}

export function Pagination({ page, totalPages, onPrev, onNext }: PaginationProps) {
  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      <button
        onClick={onPrev}
        disabled={page === 1}
        className="px-5 py-2 text-sm font-medium rounded-full border transition-transform duration-150 ease-out hover:scale-[1.04] disabled:opacity-40 disabled:hover:scale-100"
        style={{
          borderColor: "rgba(255, 255, 255, 0.30)",
          background: "rgba(255,255,255,0.12)",
          color: "var(--td-fg)",
          backdropFilter: "blur(16px) saturate(140%)",
          WebkitBackdropFilter: "blur(16px) saturate(140%)",
          boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
        }}
      >
        ← Prev
      </button>
      <span className="text-sm font-mono-td text-td-fg">
        {page} / {totalPages}
      </span>
      <button
        onClick={onNext}
        disabled={page === totalPages}
        className="px-5 py-2 text-sm font-medium rounded-full border transition-transform duration-150 ease-out hover:scale-[1.04] disabled:opacity-40 disabled:hover:scale-100"
        style={{
          borderColor: "rgba(255, 255, 255, 0.30)",
          background: "rgba(255,255,255,0.12)",
          color: "var(--td-fg)",
          backdropFilter: "blur(16px) saturate(140%)",
          WebkitBackdropFilter: "blur(16px) saturate(140%)",
          boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
        }}
      >
        Next →
      </button>
    </div>
  );
}
