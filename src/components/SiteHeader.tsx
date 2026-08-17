"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { hughIsLife } from "../lib/fonts";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/blog", label: "Blog" },
  { href: "/community", label: "Community" },
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
    <nav className="border-b border-[#ece5db] bg-[#fffdfa] px-5 py-5 md:px-8">
      <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div>
            <span className={`${hughIsLife.className} block truncate text-2xl leading-none tracking-tight text-slate-900 sm:text-3xl`}>
              Design<span className="text-[#9b5a2e]">It</span>
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Browser Design Studio</span>
          </div>
        </div>
        <button
          type="button"
          aria-expanded={mobileMenuOpen}
          aria-controls="site-header-mobile-nav"
          aria-label="Toggle navigation menu"
          onClick={() => setMobileMenuOpen((open) => !open)}
          className="inline-flex items-center justify-center border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 md:hidden"
        >
          Menu
        </button>
        <div className="hidden flex-wrap items-center gap-6 text-[11px] font-medium text-slate-600 md:flex">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href;

            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={isActive ? "text-slate-900" : "transition-colors hover:text-slate-900"}
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
          <div id="site-header-mobile-nav" className="flex w-full flex-col gap-3 border-t border-slate-100 pt-4 text-sm font-medium text-slate-600 md:hidden">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href;

              return (
                <Link
                  key={`mobile-${link.href}`}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={isActive ? "text-slate-900" : "transition-colors hover:text-slate-900"}
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