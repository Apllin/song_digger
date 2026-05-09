"use client";

import Link from "next/link";
import { useState } from "react";
import { MOCK_QUERY, MOCK_TRACKS, type MockTrack, SOURCE_LABEL } from "../data";

export default function LightPrototype() {
  const [query, setQuery] = useState(MOCK_QUERY);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="max-w-6xl mx-auto px-4 py-10 flex flex-col gap-8">
        <PrototypeHeader />
        <h1 className="text-2xl font-bold tracking-tight">Track Digger</h1>

        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Artist - Track"
            className="flex-1 bg-white border border-zinc-300 rounded-xl px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-500"
          />
          <button className="px-5 py-3 bg-zinc-900 text-zinc-50 rounded-xl text-sm font-medium hover:bg-black">
            Search
          </button>
        </div>

        <p className="text-sm text-zinc-500">{MOCK_TRACKS.length} tracks</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {MOCK_TRACKS.map((t) => (
            <LightCard key={t.id} track={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LightCard({ track }: { track: MockTrack }) {
  return (
    <div className="group flex flex-col bg-white border border-zinc-200 hover:border-zinc-400 rounded-xl overflow-hidden transition-colors">
      <div className="relative aspect-square bg-zinc-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={track.coverUrl} alt="" className="w-full h-full object-cover" />
      </div>

      <div className="flex flex-col gap-2 p-3">
        <div className="min-w-0">
          <p className="font-medium text-sm text-zinc-900 truncate" title={track.title}>
            {track.title}
          </p>
          <p className="text-xs text-zinc-500 truncate">{track.artist}</p>
        </div>

        <a
          href={track.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-zinc-500 hover:text-zinc-900 truncate"
        >
          Open in {SOURCE_LABEL[track.source]} ↗
        </a>

        <button className="mt-1 w-full py-2 text-xs font-medium rounded-lg bg-zinc-900 text-zinc-50 hover:bg-black transition-colors">
          Find similar
        </button>
      </div>
    </div>
  );
}

function PrototypeHeader() {
  return (
    <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-zinc-400">
      <Link href="/prototypes" className="hover:text-zinc-700">
        ← All prototypes
      </Link>
      <span>Light</span>
    </div>
  );
}
