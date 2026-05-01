export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
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
