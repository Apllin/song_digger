interface PlayerPlaybackControlsProps {
  playing: boolean;
  isReady: boolean;
  isPlayable: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggle: () => void;
}

export function PlayerPlaybackControls({
  playing,
  isReady,
  isPlayable,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onToggle,
}: PlayerPlaybackControlsProps) {
  return (
    <>
      <button
        onClick={onPrev}
        disabled={!hasPrev}
        className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30"
        style={{ color: "var(--td-fg-d)" }}
        aria-label="Previous"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
        </svg>
      </button>

      {isPlayable && (
        <button
          onClick={onToggle}
          disabled={!isReady}
          className="w-8.5 h-8.5 flex items-center justify-center rounded-full transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{
            background: "var(--td-accent)",
            color: "var(--td-bg)",
            boxShadow: "0 0 18px var(--td-accent-soft)",
          }}
          aria-label={playing ? "Pause" : "Play"}
        >
          {!isReady ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : playing ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      )}

      <button
        onClick={onNext}
        disabled={!hasNext}
        className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30"
        style={{ color: "var(--td-fg-d)" }}
        aria-label="Next"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 18l8.5-6L6 6v12zm2-8.14 5.51 3.86L8 17.14V9.86z" />
          <path d="M16 6h2v12h-2z" />
        </svg>
      </button>
    </>
  );
}
