"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { hughIsLife } from "../lib/fonts";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/blog", label: "Blog" },
  { href: "/community", label: "Community" },
  { href: "/my-designs", label: "My Designs" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/privacy-policy", label: "Privacy" },
  { href: "/terms-of-service", label: "Terms" },
];

export default function SiteHeader() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (pathname.startsWith("/studio") || pathname.startsWith("/admin")) {
    return null;
  }

  return (
    // Outer nav uses bg-transparent so the page background shows on the sides (white on the home page,
    // which is white throughout)
    // Sticky so the nav (and the open mobile menu) stays reachable once the page is scrolled down
    <nav className={`sticky top-0 z-50 w-full ${pathname === "/" ? "bg-white" : "bg-transparent"}`}>
      {/* 
        Inner container:
        1. max-w-[1120px] mx-auto matches the exact width of the main container below.
        2. px-5 md:px-8 aligns the contents flush with the main grid.
        3. bg-white and border classes enclose only the inner content box.
      */}
      <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-4 border-x border-t border-[#e3ddd6] bg-white px-5 py-5 md:px-8 max-h-[100dvh] overflow-y-auto">
        <div className="flex min-w-0 items-center gap-3">
          <div>
            <span className={`${hughIsLife.className} block truncate text-2xl leading-none tracking-tight text-black sm:text-3xl`}>
              Design<span className="text-[#000000]">It</span>
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-[#000000]">Browser Design Studio</span>
          </div>
        </div>

        <button
          type="button"
          aria-expanded={mobileMenuOpen}
          aria-controls="site-header-mobile-nav"
          aria-label="Toggle navigation menu"
          onClick={() => setMobileMenuOpen((open) => !open)}
          className="inline-flex items-center justify-center border border-white/30 bg-[#7c5b77] px-3 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#6f5168] md:hidden"
        >
          Menu
        </button>

        <div className="hidden flex-wrap items-center gap-6 text-[11px] font-medium text-black md:flex">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href;

            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={isActive ? "text-black font-bold" : "transition-colors hover:text-black"}
              >
                {link.label}
              </Link>
            );
          })}
          <Link
            href="/studio"
            className="bg-black px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-white transition-colors hover:bg-slate-800"
          >
            Make a Design
          </Link>
        </div>

        {mobileMenuOpen && (
          <div id="site-header-mobile-nav" className="flex w-full flex-col gap-3 border-t border-slate-200 pt-4 text-sm font-medium text-[#000000] md:hidden">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href;

              return (
                <Link
                  key={`mobile-${link.href}`}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={isActive ? "text-black font-bold" : "transition-colors hover:text-black"}
                >
                  {link.label}
                </Link>
              );
            })}
            <Link
              href="/studio"
              onClick={() => setMobileMenuOpen(false)}
              className="mt-2 inline-flex items-center justify-center bg-black px-4 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-white transition-colors hover:bg-slate-800"
            >
              Make a Design
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}