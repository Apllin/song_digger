import type { TrackSource } from "./types";

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(volume: number): void;
  destroy(): void;
  loadVideoById(videoId: string): void;
}

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: {
      Player: new (el: HTMLElement, opts: object) => YTPlayer;
    };
  }
}

export function extractVideoId(
  source: TrackSource | null,
  sourceUrl: string | null | undefined,
  embedUrl: string | null | undefined,
): string | null {
  if (source === "youtube_music") {
    return sourceUrl?.split("v=")[1]?.split("&")[0] ?? null;
  }
  return embedUrl ? (embedUrl.split("/embed/")[1]?.split("?")[0] ?? null) : null;
}

let _ready = false;
const _queue: Array<() => void> = [];

export function loadYTApi(): Promise<void> {
  return new Promise((resolve) => {
    if (_ready) return resolve();
    _queue.push(resolve);
    if (_queue.length > 1) return;
    window.onYouTubeIframeAPIReady = () => {
      _ready = true;
      _queue.splice(0).forEach((fn) => fn());
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
}

// ─── Singleton player ────────────────────────────────────────────────────────
// One YT.Player instance for the whole app lifetime, with a holder element
// appended to <body> so it persists across React component mounts/unmounts.
// useYTPlayer registers callbacks here once on mount; the singleton delegates
// all events through this object so no re-registration is ever needed.

const _handlers = {
  onStateChange: (_data: number) => {},
  onEnded: () => {},
  onReady: (_duration: number) => {},
};

let _singleton: YTPlayer | null = null;
let _holderEl: HTMLDivElement | null = null;

export function registerYTHandlers(h: Partial<typeof _handlers>): void {
  Object.assign(_handlers, h);
}

export function getYTSingleton(): YTPlayer | null {
  return _singleton;
}

export async function ensureYTSingleton(videoId: string): Promise<void> {
  if (_singleton) return;
  await loadYTApi();
  if (_singleton || !window.YT) return; // double-check after async gap
  if (!_holderEl) {
    _holderEl = document.createElement("div");
    Object.assign(_holderEl.style, {
      position: "fixed",
      left: "-1px",
      top: "0",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      opacity: "0",
      pointerEvents: "none",
    });
    document.body.appendChild(_holderEl);
  }
  _singleton = new window.YT.Player(_holderEl, {
    videoId,
    width: 1,
    height: 1,
    playerVars: { autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1 },
    events: {
      onReady: (e: { target: YTPlayer }) => _handlers.onReady(e.target.getDuration()),
      onStateChange: (e: { data: number }) => {
        _handlers.onStateChange(e.data);
        if (e.data === 0) _handlers.onEnded();
      },
    },
  });
}
