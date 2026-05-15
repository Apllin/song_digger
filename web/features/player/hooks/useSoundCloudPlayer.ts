"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { TrackSource } from "@/features/player/types";

interface SCWidget {
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  setVolume(volume: number): void;
  getDuration(callback: (ms: number) => void): void;
  bind(event: string, callback: (data: unknown) => void): void;
  unbind(event: string): void;
}

interface SCWidgetEvents {
  READY: string;
  PLAY: string;
  PAUSE: string;
  FINISH: string;
  PLAY_PROGRESS: string;
  ERROR: string;
}

interface SCWidgetConstructor {
  (iframe: HTMLIFrameElement): SCWidget;
  Events: SCWidgetEvents;
}

declare global {
  interface Window {
    SC?: { Widget: SCWidgetConstructor };
  }
}

const SC_API_SRC = "https://w.soundcloud.com/player/api.js";

function loadSCApi(): Promise<void> {
  if (window.SC) return Promise.resolve();
  let script = document.getElementById("sc-widget-api") as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement("script");
    script.id = "sc-widget-api";
    script.src = SC_API_SRC;
    document.head.appendChild(script);
  }
  return new Promise((resolve) => {
    if (window.SC) {
      resolve();
      return;
    }
    script!.addEventListener("load", () => resolve(), { once: true });
  });
}

interface SoundCloudProps {
  source: TrackSource | null;
  embedUrl: string | null;
  volume: number;
  onEnded: () => void;
}

export function useSoundCloudPlayer({ source, embedUrl, volume, onEnded }: SoundCloudProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const widgetRef = useRef<SCWidget | null>(null);
  const onEndedRef = useRef(onEnded);
  const volumeRef = useRef(volume);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  // Reset state on track change so stale progress never leaks into the next track.
  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setIsReady(false);
    widgetRef.current = null;
  }, [embedUrl]);

  // Load SC Widget API and bind events. Re-runs on each new embedUrl so the
  // widget is re-created for each track (changing the iframe src invalidates
  // the old widget instance).
  useEffect(() => {
    if (source !== "soundcloud" || !embedUrl || !iframeRef.current) return;

    let cancelled = false;
    const iframe = iframeRef.current;

    loadSCApi().then(() => {
      if (cancelled || !window.SC) return;

      const widget = window.SC.Widget(iframe);
      widgetRef.current = widget;

      const { Events } = window.SC.Widget;

      widget.bind(Events.READY, () => {
        if (cancelled) return;
        widget.getDuration((ms) => {
          if (!cancelled && ms > 0) setDuration(ms / 1000);
        });
        widget.setVolume(volumeRef.current);
        setIsReady(true);
        // Auto-start playback — mirrors YTM/Bandcamp behaviour.
        widget.play();
      });

      widget.bind(Events.PLAY, () => {
        if (!cancelled) setPlaying(true);
      });

      widget.bind(Events.PAUSE, () => {
        if (!cancelled) setPlaying(false);
      });

      widget.bind(Events.FINISH, () => {
        if (!cancelled) {
          setPlaying(false);
          onEndedRef.current();
        }
      });

      widget.bind(Events.PLAY_PROGRESS, (data) => {
        if (cancelled) return;
        const d = data as { currentPosition: number };
        setCurrentTime(d.currentPosition / 1000);
      });

      widget.bind(Events.ERROR, (data) => {
        console.error("[SoundCloud] widget error:", data);
      });
    });

    return () => {
      cancelled = true;
      try {
        widgetRef.current?.pause();
      } catch {
        // iframe may already be detached from the DOM
      }
      widgetRef.current = null;
    };
  }, [source, embedUrl]);

  // Pause when source switches away from soundcloud.
  useEffect(() => {
    if (source !== "soundcloud") {
      try {
        widgetRef.current?.pause();
      } catch {
        // iframe may already be detached from the DOM
      }
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setIsReady(false);
    }
  }, [source]);

  // Sync volume to the widget whenever it changes.
  useEffect(() => {
    widgetRef.current?.setVolume(volume);
  }, [volume]);

  const toggle = useCallback(() => {
    const w = widgetRef.current;
    if (!w) return;
    if (playing) w.pause();
    else w.play();
  }, [playing]);

  const seekTo = useCallback((t: number) => {
    widgetRef.current?.seekTo(t * 1000);
    setCurrentTime(t);
  }, []);

  return { iframeRef, embedUrl, playing, currentTime, duration, isReady, toggle, seekTo };
}
