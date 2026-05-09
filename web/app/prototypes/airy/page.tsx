"use client";

import Link from "next/link";
import { useState } from "react";
import { MOCK_QUERY, MOCK_TRACKS, type MockTrack, SOURCE_LABEL } from "../data";

type Theme = "dark" | "light";

const PALETTE = {
  dark: {
    page: "bg-zinc-950 text-zinc-100",
    navBorder: "border-zinc-800",
    navBg: "bg-zinc-950",
    navTitle: "text-zinc-50",
    navTabActive: "bg-zinc-800 text-zinc-100",
    navTabIdle: "text-zinc-500 hover:text-zinc-300",
    inputBorder: "border-zinc-700 focus:border-zinc-400",
    inputText: "text-zinc-100 placeholder-zinc-600",
    cardCover: "bg-zinc-900",
    title: "text-zinc-50",
    subtitle: "text-zinc-400",
    link: "text-zinc-500 hover:text-zinc-200",
    button: "border-zinc-700 text-zinc-300 hover:border-zinc-300 hover:text-zinc-50",
    tagline: "text-zinc-400",
    meta: "text-zinc-600",
    iconBtn: "text-zinc-400 hover:text-zinc-100",
    vinylBody: "#111111",
    vinylGroove: "#2a2a2a",
    vinylOutline: "#ffffff",
    vinylHole: "#111111",
  },
  light: {
    page: "bg-zinc-50 text-zinc-900",
    navBorder: "border-zinc-200",
    navBg: "bg-zinc-50",
    navTitle: "text-zinc-900",
    navTabActive: "bg-zinc-200 text-zinc-900",
    navTabIdle: "text-zinc-500 hover:text-zinc-900",
    inputBorder: "border-zinc-300 focus:border-zinc-600",
    inputText: "text-zinc-900 placeholder-zinc-400",
    cardCover: "bg-zinc-100",
    title: "text-zinc-900",
    subtitle: "text-zinc-600",
    link: "text-zinc-500 hover:text-zinc-900",
    button: "border-zinc-300 text-zinc-700 hover:border-zinc-700 hover:text-zinc-900",
    tagline: "text-zinc-600",
    meta: "text-zinc-500",
    iconBtn: "text-zinc-500 hover:text-zinc-900",
    vinylBody: "#111111",
    vinylGroove: "#2a2a2a",
    vinylOutline: "#0a0a0a",
    vinylHole: "#111111",
  },
} as const;

const TABS = [
  { href: "/", label: "Search" },
  { href: "/discography", label: "Discography" },
  { href: "/labels", label: "Labels" },
];

export default function AiryPrototype() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [query, setQuery] = useState(MOCK_QUERY);
  const p = PALETTE[theme];

  return (
    <div className={`min-h-screen ${p.page}`}>
      <ProtoNav theme={theme} onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")} />

      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col gap-8">
        <PrototypeBackLink theme={theme} />

        <h2 className={`text-2xl md:text-3xl font-semibold tracking-tight ${p.title}`}>
          Find your next favourite track
        </h2>

        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Artist - Track"
            className={`flex-1 bg-transparent border-b ${p.inputBorder} px-1 py-3 text-base ${p.inputText} focus:outline-none transition-colors`}
          />
          <button className={`px-5 py-3 text-sm font-medium ${p.iconBtn}`}>Search →</button>
        </div>

        <p className={`text-xs uppercase tracking-widest ${p.meta}`}>{MOCK_TRACKS.length} tracks</p>

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-x-4 gap-y-7">
          {MOCK_TRACKS.map((t) => (
            <TrackCard key={t.id} track={t} theme={theme} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProtoNav({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const p = PALETTE[theme];
  // In a real app, usePathname would drive this. In the prototype, we mark
  // Search as the active route since this page mocks /.
  const activeHref = "/";
  return (
    <nav className={`border-b ${p.navBorder} ${p.navBg}`}>
      <div className="max-w-6xl mx-auto px-4 flex items-center gap-2 h-14">
        <Link href="/" className="flex items-center gap-2.5 mr-4 group" aria-label="Track Digger — home">
          <Vinyl
            className="w-8 h-8 shrink-0"
            body={p.vinylBody}
            groove={p.vinylGroove}
            outline={p.vinylOutline}
            hole={p.vinylHole}
          />
          <span className={`text-lg font-bold tracking-tight ${p.navTitle} group-hover:opacity-80 transition-opacity`}>
            Track Digger
          </span>
        </Link>

        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              tab.href === activeHref ? p.navTabActive : p.navTabIdle
            }`}
          >
            {tab.label}
          </Link>
        ))}

        <button
          onClick={onToggleTheme}
          className={`ml-auto p-2 rounded-lg ${p.iconBtn} transition-colors`}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </nav>
  );
}

function TrackCard({ track, theme }: { track: MockTrack; theme: Theme }) {
  const p = PALETTE[theme];
  return (
    <div className="group flex flex-col gap-2">
      <div className={`relative aspect-square ${p.cardCover} rounded-md overflow-hidden`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={track.coverUrl}
          alt=""
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="min-w-0">
          <p className={`font-medium text-xs ${p.title} truncate`} title={track.title}>
            {track.title}
          </p>
          <div className="flex items-center gap-1 min-w-0">
            <p className={`text-[11px] ${p.subtitle} truncate`}>{track.artist}</p>
            <button
              onClick={() => window.open(`/discography?artist=${encodeURIComponent(track.artist)}`, "_blank")}
              className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
              aria-label={`${track.artist} discography`}
              title="Discography"
            >
              <Vinyl
                className="w-3 h-3"
                body={p.vinylBody}
                groove={p.vinylGroove}
                outline={p.vinylOutline}
                hole={p.vinylHole}
              />
            </button>
          </div>
        </div>

        <a
          href={track.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`text-[10px] ${p.link} truncate`}
        >
          Open in {SOURCE_LABEL[track.source]} ↗
        </a>

        <button
          className={`self-start text-[11px] font-medium px-2.5 py-1 rounded-full border ${p.button} transition-colors`}
        >
          Find similar
        </button>
      </div>
    </div>
  );
}

function PrototypeBackLink({ theme }: { theme: Theme }) {
  const p = PALETTE[theme];
  return (
    <div className={`flex items-center justify-between text-[10px] uppercase tracking-widest ${p.meta}`}>
      <Link href="/prototypes" className="hover:opacity-100 opacity-70">
        ← All prototypes
      </Link>
      <span>Dark · Airy</span>
    </div>
  );
}

function Vinyl({
  className = "",
  body,
  groove,
  outline,
  hole,
}: {
  className?: string;
  body: string;
  groove: string;
  outline: string;
  hole: string;
}) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="11.5" fill={body} stroke={outline} strokeWidth="0.5" />
      <circle cx="12" cy="12" r="10" fill="none" stroke={groove} strokeWidth="0.3" />
      <circle cx="12" cy="12" r="8" fill="none" stroke={groove} strokeWidth="0.3" />
      <circle cx="12" cy="12" r="6" fill="none" stroke={groove} strokeWidth="0.3" />
      <circle cx="12" cy="12" r="3.8" fill="#dc2626" />
      <circle cx="12" cy="12" r="0.5" fill={hole} />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4" />
      <path
        strokeLinecap="round"
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
