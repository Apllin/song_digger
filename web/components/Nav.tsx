"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Search" },
  { href: "/discography", label: "Discography" },
  { href: "/labels", label: "Labels" },
];

export function Nav({ rightSlot }: { rightSlot?: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname.startsWith("/prototypes")) return null;

  return (
    <nav className="border-b border-zinc-800 bg-zinc-950">
      <div className="max-w-6xl mx-auto px-4 flex items-center gap-2 h-14">
        <Link
          href="/"
          className="flex items-center gap-2.5 mr-4 group"
          aria-label="Track Digger — home"
        >
          <Vinyl className="w-8 h-8 shrink-0" />
          <span className="text-lg font-bold text-zinc-50 tracking-tight group-hover:opacity-80 transition-opacity">
            Track Digger
          </span>
        </Link>
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              pathname === tab.href
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </Link>
        ))}
        {rightSlot && <div className="ml-auto">{rightSlot}</div>}
      </div>
    </nav>
  );
}

function Vinyl({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="11.5" fill="#111111" stroke="#ffffff" strokeWidth="0.5" />
      <circle cx="12" cy="12" r="10" fill="none" stroke="#2a2a2a" strokeWidth="0.3" />
      <circle cx="12" cy="12" r="8" fill="none" stroke="#2a2a2a" strokeWidth="0.3" />
      <circle cx="12" cy="12" r="6" fill="none" stroke="#2a2a2a" strokeWidth="0.3" />
      <circle cx="12" cy="12" r="3.8" fill="#dc2626" />
      <circle cx="12" cy="12" r="0.5" fill="#111111" />
    </svg>
  );
}
