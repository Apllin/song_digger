"use client";

import { useEffect, useRef } from "react";
import { PlayerCover } from "./PlayerCover";
import { PlayerPlaybackControls } from "./PlayerPlaybackControls";
import { PlayerProgressBar } from "./PlayerProgressBar";
import { PlayerTrackInfo } from "./PlayerTrackInfo";
import { PlayerVolume } from "./PlayerVolume";

import {
  type BCPlayerReturn,
  type SCPlayerReturn,
  useAudioPlayer,
  type YTPlayerReturn,
} from "@/features/player/hooks/useAudioPlayer";
import { useMediaSession } from "@/features/player/hooks/useMediaSession";
import { usePlayer } from "@/features/player/hooks/usePlayer";
import { usePlayerKeyboard } from "@/features/player/hooks/usePlayerKeyboard";
import type { PlayerTrack } from "@/features/player/types";
import { silentWavSrc } from "@/features/player/utils";

export function BottomPlayer() {
  const { track } = usePlayer();
  if (!track) return null;
  return <BottomPlayerContent track={track} />;
}

interface SharedProps {
  track: PlayerTrack;
  resolving: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  playPrev: () => void;
  playNext: () => void;
  close: () => void;
}

function BottomPlayerContent({ track }: { track: PlayerTrack }) {
  const { playingIndex, playlist, close, playNext, playPrev, swapTrack } = usePlayer();
  const player = useAudioPlayer({ track, onEnded: playNext, swapTrack });

  const audioRef = player.source === "bandcamp" ? player.audioRef : null;

  const resolving = !player.source && !!track.source;
  const hasPrev = playingIndex !== null && playingIndex > 0;
  const hasNext = playingIndex !== null && playingIndex < playlist.length - 1;

  useMediaSession({
    track,
    playing: player.playing,
    currentTime: player.currentTime,
    duration: player.duration,
    playingIndex,
    playlist,
    playNext,
    playPrev,
    seekTo: player.seekTo,
    audioRef,
  });
  usePlayerKeyboard({ trackId: track.id, toggle: player.toggle, playNext, playPrev });

  const shared: SharedProps = { track, resolving, hasPrev, hasNext, playPrev, playNext, close };

  return (
    <div
      className="fixed bottom-4 left-4 right-4 md:left-7 md:right-7 z-50 max-w-6xl md:mx-auto rounded-[18px] backdrop-blur-xl shadow-2xl"
      style={{ background: "rgba(20,18,26,0.85)", border: "1px solid var(--td-hair-2)" }}
    >
      {player.source === "youtube_music" ? (
        <YoutubePlayer player={player} {...shared} />
      ) : player.source === "bandcamp" ? (
        <BandcampPlayer player={player} {...shared} />
      ) : player.source === "soundcloud" ? (
        <SoundCloudPlayer player={player} {...shared} />
      ) : (
        <PlayerLayout
          track={track}
          coverUrl={track.coverUrl ?? null}
          sourceHref={track.sourceUrl ?? "#"}
          resolving={resolving}
          playing={player.playing}
          currentTime={player.currentTime}
          duration={player.duration}
          isReady={player.isReady}
          isPlayable={false}
          volume={player.volume}
          hasPrev={hasPrev}
          hasNext={hasNext}
          toggle={player.toggle}
          seekTo={player.seekTo}
          setVolume={player.setVolume}
          playPrev={playPrev}
          playNext={playNext}
          close={close}
        />
      )}
    </div>
  );
}

function YoutubePlayer({
  player,
  track,
  resolving,
  hasPrev,
  hasNext,
  playPrev,
  playNext,
  close,
}: SharedProps & { player: YTPlayerReturn }) {
  const { playing, currentTime, duration, isReady, toggle, seekTo, volume, setVolume, videoId } = player;

  const silentRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (playing) {
      silentRef.current?.play().catch(() => {});
    } else {
      silentRef.current?.pause();
    }
  }, [playing]);

  const coverUrl = track.coverUrl ?? (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null);
  const sourceHref = videoId ? `https://www.youtube.com/watch?v=${videoId}` : (track.sourceUrl ?? "#");

  return (
    <>
      {videoId && <audio ref={silentRef} src={silentWavSrc()} loop />}
      <PlayerLayout
        track={track}
        coverUrl={coverUrl}
        sourceHref={sourceHref}
        resolving={resolving}
        playing={playing}
        currentTime={currentTime}
        duration={duration}
        isReady={isReady}
        isPlayable
        volume={volume}
        hasPrev={hasPrev}
        hasNext={hasNext}
        toggle={toggle}
        seekTo={seekTo}
        setVolume={setVolume}
        playPrev={playPrev}
        playNext={playNext}
        close={close}
      />
    </>
  );
}

function BandcampPlayer({
  player,
  track,
  resolving,
  hasPrev,
  hasNext,
  playPrev,
  playNext,
  close,
}: SharedProps & { player: BCPlayerReturn }) {
  const {
    playing,
    currentTime,
    duration,
    isReady,
    toggle,
    seekTo,
    volume,
    setVolume,
    audioRef,
    audioUrl,
    audioEventHandlers,
  } = player;

  const coverUrl = track.coverUrl ?? null;
  const sourceHref = track.sourceUrl ?? "#";

  return (
    <>
      {audioUrl && <audio ref={audioRef} src={audioUrl} autoPlay {...audioEventHandlers} />}
      <PlayerLayout
        track={track}
        coverUrl={coverUrl}
        sourceHref={sourceHref}
        resolving={resolving}
        playing={playing}
        currentTime={currentTime}
        duration={duration}
        isReady={isReady}
        isPlayable
        volume={volume}
        hasPrev={hasPrev}
        hasNext={hasNext}
        toggle={toggle}
        seekTo={seekTo}
        setVolume={setVolume}
        playPrev={playPrev}
        playNext={playNext}
        close={close}
      />
    </>
  );
}

function SoundCloudPlayer({
  player,
  track,
  resolving,
  hasPrev,
  hasNext,
  playPrev,
  playNext,
  close,
}: SharedProps & { player: SCPlayerReturn }) {
  const { playing, currentTime, duration, isReady, toggle, seekTo, volume, setVolume, iframeRef, embedUrl } = player;

  return (
    <>
      {embedUrl && (
        <iframe
          ref={iframeRef}
          src={embedUrl}
          allow="autoplay"
          title="SoundCloud player"
          style={{ position: "fixed", left: "-1px", top: 0, width: "1px", height: "1px", opacity: 0 }}
        />
      )}
      <PlayerLayout
        track={track}
        coverUrl={track.coverUrl ?? null}
        sourceHref={track.sourceUrl ?? "#"}
        resolving={resolving}
        playing={playing}
        currentTime={currentTime}
        duration={duration}
        isReady={isReady}
        isPlayable
        volume={volume}
        hasPrev={hasPrev}
        hasNext={hasNext}
        toggle={toggle}
        seekTo={seekTo}
        setVolume={setVolume}
        playPrev={playPrev}
        playNext={playNext}
        close={close}
      />
    </>
  );
}

interface PlayerLayoutProps {
  track: PlayerTrack;
  coverUrl: string | null;
  sourceHref: string;
  resolving: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  isReady: boolean;
  isPlayable: boolean;
  volume: number;
  hasPrev: boolean;
  hasNext: boolean;
  toggle: () => void;
  seekTo: (t: number) => void;
  setVolume: (v: number) => void;
  playPrev: () => void;
  playNext: () => void;
  close: () => void;
}

function PlayerLayout({
  track,
  coverUrl,
  sourceHref,
  resolving,
  playing,
  currentTime,
  duration,
  isReady,
  isPlayable,
  volume,
  hasPrev,
  hasNext,
  toggle,
  seekTo,
  setVolume,
  playPrev,
  playNext,
  close,
}: PlayerLayoutProps) {
  return (
    <div className="px-4 py-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <PlayerCover coverUrl={coverUrl} />
        <PlayerTrackInfo title={track.title} artist={track.artist} source={track.source} resolving={resolving} />
        <div className="flex items-center gap-1.5 shrink-0">
          <PlayerPlaybackControls
            playing={playing}
            isReady={isReady}
            isPlayable={isPlayable}
            hasPrev={hasPrev}
            hasNext={hasNext}
            onPrev={playPrev}
            onNext={playNext}
            onToggle={toggle}
          />
          {isPlayable && <PlayerVolume volume={volume} onSetVolume={setVolume} />}
          <a
            href={sourceHref}
            target="_blank"
            rel="noopener noreferrer"
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: "var(--td-fg-d)" }}
            aria-label="Open on source"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
          <button
            onClick={close}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: "var(--td-fg-m)" }}
            aria-label="Close player"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {isPlayable && (
        <PlayerProgressBar currentTime={currentTime} duration={duration} onSeek={(pct) => seekTo(pct * duration)} />
      )}
    </div>
  );
}
