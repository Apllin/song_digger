"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Logo } from "./Logo";

const TABS = [
  { href: "/", label: "Search" },
  { href: "/discography", label: "Discography" },
  { href: "/labels", label: "Labels" },
  { href: "/favorites", label: "Favorites" },
];

// LaunchDarkly-style pill segmented control:
// - container: dark surface w/ subtle border + lg shadow
// - chip: 30px radius, 24px h-padding, 10px v-padding (Toggle Button)
// - active: Carbon Black (#191919) bg + Launch Violet (#7084ff) text
// - inactive: transparent + Mercury White (#ffffff) text
// Purple-tinted glass so the bar lifts off the dark navy bg instead of
// blending into it. Mix is roughly the lavender accent (#b9a3e8) at low
// alpha over a deep violet, kept dark enough that white chip text reads.
const NAV_BAR_STYLE: React.CSSProperties = {
  background: "rgba(40, 32, 110, 0.82)",
  border: "1px solid rgba(216, 200, 255, 0.18)",
  backdropFilter: "blur(20px) saturate(140%)",
  WebkitBackdropFilter: "blur(20px) saturate(140%)",
  boxShadow: "rgba(0, 0, 0, 0.45) 0px 4px 20px 0px",
};

// Per-chip foreground colour. The active background is rendered by a
// shared sliding pill behind the chips (see <DesktopChips /> below), so
// we don't set `background` here.
function chipTextStyle(active: boolean): React.CSSProperties {
  return {
    color: active ? "#7084ff" : "#ffffff",
  };
}

const MOBILE_CHIP_BASE_STYLE: React.CSSProperties = {
  background: "rgba(40, 32, 110, 0.82)",
  backdropFilter: "blur(20px) saturate(140%)",
  WebkitBackdropFilter: "blur(20px) saturate(140%)",
};

function mobileChipStyle(active: boolean): React.CSSProperties {
  return {
    ...MOBILE_CHIP_BASE_STYLE,
    color: active ? "#7084ff" : "#ffffff",
    borderColor: active ? "#7084ff" : "rgba(255, 255, 255, 0.22)",
    boxShadow: active ? "0 0 0 1px rgba(112,132,255,0.35), 0 6px 18px rgba(0,0,0,0.35)" : "0 6px 18px rgba(0,0,0,0.3)",
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
          <Link href="/" className="flex items-center group shrink-0" aria-label="Track Digger — home">
            <Logo size={48} wordmarkSize={26} className="group-hover:opacity-90 transition-opacity" />
          </Link>

          {/* Desktop chips — long segmented control bar with a sliding
              active-pill, centered between logo and right slot. Hidden on
              mobile in favour of the hamburger drawer. */}
          <div className="hidden md:flex flex-1 justify-center">
            <DesktopChips pathname={pathname} />
          </div>

          {/* Mobile spacer — pushes auth + hamburger to the right edge. */}
          <div className="flex-1 md:hidden" />

          {rightSlot && <div className="shrink-0">{rightSlot}</div>}

          {/* Mobile hamburger */}
          <button
            type="button"
            className="md:hidden w-10 h-10 flex items-center justify-center rounded-lg border shrink-0"
            style={{
              ...MOBILE_CHIP_BASE_STYLE,
              borderColor: "rgba(255, 255, 255, 0.22)",
              color: "var(--td-fg)",
              boxShadow: "0 6px 18px rgba(0,0,0,0.3)",
            }}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            aria-controls="mobile-nav-drawer"
            onClick={() => setDrawerOpen(true)}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
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
          background: "rgba(40, 32, 110, 0.92)",
          borderLeft: "1px solid rgba(216, 200, 255, 0.22)",
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
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
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
                  className="block px-4 py-3 font-mono-td uppercase tracking-[0.14em] text-[12px] font-medium rounded-lg border transition-colors"
                  style={mobileChipStyle(active)}
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

/*
  DesktopChips: segmented-control nav with a sliding pill behind the active
  tab. The pill is absolutely positioned and animates `left`/`width` when
  the route changes, giving a switch-like feel.

  Why measure with refs instead of CSS-only? Tab labels have variable
  widths, so we can't pre-compute pill positions in CSS. We measure each
  link's offsetLeft / offsetWidth after layout and store them, then apply
  them as inline transform/width on the pill with a transition.
*/
function DesktopChips({ pathname }: { pathname: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  // First measurement should snap (no transition); subsequent ones animate.
  const [hasMeasured, setHasMeasured] = useState(false);

  const activeIndex = TABS.findIndex((t) => t.href === pathname);

  // Measure synchronously so the pill never paints in the wrong place.
  useLayoutEffect(() => {
    if (activeIndex < 0) {
      setPill(null);
      return;
    }
    const el = chipRefs.current[activeIndex];
    if (!el) return;
    setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [activeIndex, pathname]);

  // Flip the snap flag on the next frame after the first paint, so the
  // initial pill position doesn't visibly slide in from 0.
  useEffect(() => {
    if (pill && !hasMeasured) {
      const id = requestAnimationFrame(() => setHasMeasured(true));
      return () => cancelAnimationFrame(id);
    }
  }, [pill, hasMeasured]);

  // Re-measure on resize — chip widths change with viewport / font load.
  useEffect(() => {
    if (activeIndex < 0) return;
    const onResize = () => {
      const el = chipRefs.current[activeIndex];
      if (!el) return;
      setPill({ left: el.offsetLeft, width: el.offsetWidth });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeIndex]);

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label="Sections"
      className="relative flex items-center gap-1 p-1 rounded-full"
      style={NAV_BAR_STYLE}
    >
      {/* Sliding active-pill — sits behind the chips. */}
      {pill && (
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 rounded-full pointer-events-none"
          style={{
            left: pill.left,
            width: pill.width,
            background: "#191919",
            boxShadow: "0 0 0 1px rgba(112,132,255,0.35)",
            transition: hasMeasured
              ? "left 320ms cubic-bezier(0.4, 0, 0.2, 1), width 320ms cubic-bezier(0.4, 0, 0.2, 1)"
              : "none",
          }}
        />
      )}
      {TABS.map((tab, i) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            ref={(el) => {
              chipRefs.current[i] = el;
            }}
            role="tab"
            aria-selected={active}
            className="relative z-10 px-6 py-2.5 font-mono-td uppercase tracking-[0.14em] text-[12px] font-medium rounded-full whitespace-nowrap transition-colors"
            style={chipTextStyle(active)}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
