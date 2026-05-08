"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";

const TABS = [
  { href: "/", label: "Search" },
  { href: "/discography", label: "Discography" },
  { href: "/labels", label: "Labels" },
];

const CHIP_BASE_STYLE: React.CSSProperties = {
  background: "rgba(14, 16, 28, 0.78)",
  backdropFilter: "blur(20px) saturate(140%)",
  WebkitBackdropFilter: "blur(20px) saturate(140%)",
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    ...CHIP_BASE_STYLE,
    color: active ? "var(--td-fg)" : "var(--td-fg-d)",
    borderColor: active ? "var(--td-accent)" : "rgba(255, 255, 255, 0.22)",
    boxShadow: active
      ? "0 0 0 1px var(--td-accent-soft), 0 6px 18px rgba(0,0,0,0.35)"
      : "0 6px 18px rgba(0,0,0,0.3)",
  };
}

export function Nav({ rightSlot }: { rightSlot?: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer when navigating to a new route.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Esc to close + lock body scroll while open.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  if (pathname.startsWith("/prototypes")) return null;

  return (
    <>
      <nav className="relative z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-7 flex items-center gap-3 sm:gap-5 h-[68px] sm:h-[80px]">
          <Link
            href="/"
            className="flex items-center group shrink-0"
            aria-label="Track Digger — home"
          >
            <Logo
              size={48}
              wordmarkSize={26}
              className="group-hover:opacity-90 transition-opacity"
            />
          </Link>

          {/* Desktop chips — centered between logo and right slot. Hidden on
              mobile in favour of the hamburger drawer. */}
          <div className="hidden md:flex flex-1 justify-center gap-6">
            {TABS.map((tab) => {
              const active = pathname === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className="px-4 py-2.5 text-[13px] font-medium rounded-lg border transition-colors whitespace-nowrap"
                  style={chipStyle(active)}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>

          {/* Mobile spacer — pushes auth + hamburger to the right edge. */}
          <div className="flex-1 md:hidden" />

          {rightSlot && <div className="shrink-0">{rightSlot}</div>}

          {/* Mobile hamburger */}
          <button
            type="button"
            className="md:hidden w-10 h-10 flex items-center justify-center rounded-lg border shrink-0"
            style={{
              ...CHIP_BASE_STYLE,
              borderColor: "rgba(255, 255, 255, 0.22)",
              color: "var(--td-fg)",
              boxShadow: "0 6px 18px rgba(0,0,0,0.3)",
            }}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            aria-controls="mobile-nav-drawer"
            onClick={() => setDrawerOpen(true)}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>
      </nav>

      {/* Drawer — mobile only. Slides in from the right. */}
      <div
        className={`md:hidden fixed inset-0 z-40 transition-opacity ${
          drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        style={{ background: "rgba(0, 0, 0, 0.55)" }}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <aside
        id="mobile-nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className={`md:hidden fixed top-0 right-0 z-50 h-full w-72 max-w-[85vw] flex flex-col gap-4 p-5 transition-transform duration-200 ease-out ${
          drawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
        style={{
          background: "rgba(14, 16, 28, 0.92)",
          borderLeft: "1px solid rgba(255, 255, 255, 0.18)",
          backdropFilter: "blur(24px) saturate(140%)",
          WebkitBackdropFilter: "blur(24px) saturate(140%)",
          boxShadow: "0 0 60px rgba(0,0,0,0.5)",
        }}
      >
        <div className="flex justify-end">
          <button
            type="button"
            className="w-9 h-9 flex items-center justify-center rounded-md transition-colors"
            style={{ color: "var(--td-fg-d)" }}
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <ul className="flex flex-col gap-2 mt-2">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  onClick={() => setDrawerOpen(false)}
                  className="block px-4 py-3 text-[15px] font-medium rounded-lg border transition-colors"
                  style={chipStyle(active)}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>
    </>
  );
}
