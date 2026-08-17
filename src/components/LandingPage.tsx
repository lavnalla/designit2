"use client";
import React, { useState } from "react";
import Link from "next/link";
import Footer from "./Footer";
import AdSlot from "./AdSlot";
import { CommunityShowcase } from "./CommunityShowcase";
import { Upload, Sparkles, Gem, ChevronDown } from "lucide-react";

const FAQS = [
  {
    q: "What is DesignIt?",
    a: "DesignIt is a digital studio that lets you design jewelry and clothing from scratch using professional vector tools — and virtually try them on in real time.",
  },
  {
    q: "Do I need design experience to use it?",
    a: "Not at all. The studio is built for everyone, from first-time hobbyists to professional designers. Just open it and start creating.",
  },
  {
    q: "Can I try on jewelry with my webcam?",
    a: "Yes! The AR necklace try-on uses your webcam and pose detection to overlay your designs on your body in real time.",
  },
  {
    q: "What file formats can I import?",
    a: "You can import PNG and JPG images as fabric or design references directly into the studio canvas.",
  },
  {
    q: "Can I share my designs with the community?",
    a: "Absolutely. Once you're happy with a design, submit it from the studio and it will appear in the Community Gallery after review.",
  },
  {
    q: "Is DesignIt free to use?",
    a: "Yes — the core studio and try-on features are completely free.",
  },
];

//check if these are alright FAQS

const STEPS = [
  {
    num: "01",
    title: "Open the Studio",
    desc: "Click Launch Studio to enter the design canvas. No sign-up required — start immediately.",
  },
  {
    num: "02",
    title: "Design Your Piece",
    desc: "Download image and upload to studio or draw from scratch, modify using dot art and trace, and layer shapes. Import fabric swatches, adjust colors, and build your garment or jewelry design.",
  },
  {
    num: "03",
    title: "Try It On",
    desc: "Switch to AR Try-On mode and see your necklace placed on your body in real time via webcam.",
  },
];

const FEATURES = [
  {
    icon: "✏️",
    title: "Professional Vector Canvas",
    desc: "Draw with precision tools — bezier curves, shape primitives, fill, stroke, and layer management built for fashion design.",
  },
  {
    icon: "💎",
    title: "Jewelry AR Try-On",
    desc: "See your necklace designs on your body in real time. Adjust size and position with live pose tracking.",
  },
  {
    icon: "🎨",
    title: "Fabric & Texture Import",
    desc: "Paste real fabric swatches directly onto your canvas. The studio preserves color, grain, and pattern fidelity.",
  },
  {
    icon: "🌐",
    title: "Community Gallery",
    desc: "Share finished designs with the DesignIt community. Discover and draw inspiration from other creators.",
  },
];

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const homepageAdSlot = process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_HOME_SLOT;

  return (
    <div className="flex flex-col min-h-screen bg-white text-slate-900 font-sans">

      {/* ── NAV ── */}
      <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/90 px-4 py-4 shadow-sm backdrop-blur md:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
          <img src="/logo.png" alt="DesignIt" className="h-7 w-auto" />
          <span className="truncate font-black text-lg tracking-tight text-slate-900 sm:text-xl">
            Design<span className="text-yellow-500">It</span>
          </span>
        </div>
        <div className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
          <a href="#how-to" className="hover:text-slate-900 transition-colors">How It Works</a>
          <a href="#features" className="hover:text-slate-900 transition-colors">Features</a>
          <Link href="/blog" className="hover:text-slate-900 transition-colors">Blog</Link>
          <Link href="/community" className="hover:text-slate-900 transition-colors">Community</Link>
          <Link href="/about" className="hover:text-slate-900 transition-colors">About</Link>
        </div>
        <Link
          href="/studio"
          className="hidden rounded-full bg-yellow-500 px-5 py-2 text-sm font-bold text-white shadow-md transition-all hover:scale-105 hover:bg-yellow-400 md:inline-flex"
        >
          Launch Studio →
        </Link>
          <button
            type="button"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav-menu"
            aria-label="Toggle navigation menu"
            onClick={() => setMobileMenuOpen((open) => !open)}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 md:hidden"
          >
            Menu
          </button>
        </div>
        {mobileMenuOpen && (
          <div id="mobile-nav-menu" className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 md:hidden">
            <a href="#how-to" onClick={() => setMobileMenuOpen(false)} className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">How It Works</a>
            <a href="#features" onClick={() => setMobileMenuOpen(false)} className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">Features</a>
            <Link href="/blog" onClick={() => setMobileMenuOpen(false)} className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">Blog</Link>
            <Link href="/community" onClick={() => setMobileMenuOpen(false)} className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">Community</Link>
            <Link href="/about" onClick={() => setMobileMenuOpen(false)} className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">About</Link>
            <Link
              href="/studio"
              onClick={() => setMobileMenuOpen(false)}
              className="mt-2 inline-flex items-center justify-center rounded-full bg-yellow-500 px-5 py-3 text-sm font-bold text-white shadow-md transition-all hover:bg-yellow-400"
            >
              Launch Studio →
            </Link>
          </div>
        )}
      </nav>

      {/* ── HERO ── */}
      <section className="relative flex flex-col items-center justify-center overflow-hidden px-4 pb-14 pt-14 text-center sm:px-6 sm:pt-20">
        {/* subtle background texture */}
        <div className="absolute inset-0 bg-gradient-to-b from-yellow-50/60 via-white to-white pointer-events-none" />

        <div className="relative z-10 max-w-2xl mx-auto">
          <div className="mb-6 inline-flex max-w-full items-center gap-2 rounded-full bg-yellow-100 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-yellow-700 sm:text-xs">
            <Sparkles size={12} />
            Design Studio + AR Try-On
          </div>

          <h1 className="mb-4 text-4xl font-black leading-tight tracking-tight text-slate-900 sm:text-5xl md:text-6xl">
            <span className="block">Design Clothes & Jewelry.</span>
            <span className="block text-yellow-500">Create, Customize & Try Them On.</span>
          </h1>

          <p className="mx-auto mb-4 max-w-3xl text-base leading-relaxed text-slate-600 sm:text-lg md:text-xl">
            Start from a blank canvas or bring in an image from anywhere. Customize and reshape it using powerful tools like <strong>Dot Art, Pen, Ghost, colors, fabrics, and more</strong>.
          </p>

          <Link href="/blog" className="mx-auto mb-8 inline-flex max-w-2xl text-base font-bold tracking-normal text-cyan-700 transition-colors hover:text-cyan-900 sm:text-lg md:text-xl">
            Explore our how-to guides.
          </Link>

          <p className="mx-auto mb-8 max-w-3xl text-sm leading-relaxed text-slate-500 sm:text-base md:text-lg">
            The <Link href="/studio" className="font-bold text-cyan-700 transition-colors hover:text-cyan-900">Design Studio</Link> takes your idea from a blank canvas or existing image to <strong>AR try-on in minutes</strong> - no apps, no photoshoots, no waiting.
          </p>

          {/* Upload-style CTA — mirrors FitRoom's drop zone */}
        </div>
      </section>

      {/* ── TRUSTED BY ── */}
      <section className="py-6 border-y border-slate-100 bg-slate-50">
        <p className="text-center text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">
          Built for online shoppers, designers, makers & fashion creators
        </p>
        <div className="flex justify-center items-center gap-8 flex-wrap px-6 text-slate-400 text-sm font-semibold">
          {["online shoppers", "Jewelry Designers", "Clothing Brands", "Fashion Students", "Boutique Owners"].map((label) => (
            <span key={label} className="flex items-center gap-1.5">
              <Gem size={12} className="text-yellow-400" />
              {label}
            </span>
          ))}
        </div>
      </section>

      {homepageAdSlot && (
        <section className="px-4 py-6 sm:px-6" aria-label="Advertisement">
          <div className="mx-auto max-w-5xl rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <p className="mb-3 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
              Sponsored
            </p>
            <AdSlot
              slot={homepageAdSlot}
              className="mx-auto min-h-[90px]"
              style={{ minHeight: 90 }}
            />
          </div>
        </section>
      )}

      {/* ── HOW IT WORKS ── */}
      <section id="how-to" className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
        <p className="text-xs font-bold text-yellow-500 uppercase tracking-widest text-center mb-2">How It Works</p>
        <h2 className="text-3xl md:text-4xl font-black text-center text-slate-900 mb-12">
          From sketch to try-on in 3 steps
        </h2>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
          {STEPS.map((step) => (
            <div key={step.num} className="flex flex-col items-center text-center p-6 rounded-2xl bg-slate-50 border border-slate-100 hover:border-yellow-300 hover:shadow-md transition-all">
              <span className="text-4xl font-black text-yellow-400 mb-3">{step.num}</span>
              <h3 className="font-bold text-lg text-slate-800 mb-2">{step.title}</h3>
              <p className="text-slate-500 text-sm leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/studio"
            className="w-full rounded-full bg-yellow-500 px-6 py-3.5 text-sm font-bold text-white shadow-md transition-all hover:scale-105 hover:bg-yellow-400 sm:w-auto sm:px-8"
          >
            Start Designing Now →
          </Link>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="border-y border-slate-100 bg-slate-50 px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-bold text-yellow-500 uppercase tracking-widest text-center mb-2">Features</p>
          <h2 className="text-3xl md:text-4xl font-black text-center text-slate-900 mb-12">
            Your Personal Design Studio
          </h2>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-5 p-6 bg-white rounded-2xl border border-slate-100 hover:border-yellow-300 hover:shadow-md transition-all">
                <div className="text-3xl shrink-0">{f.icon}</div>
                <div>
                  <h3 className="font-bold text-slate-800 mb-1">{f.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{f.desc}</p>
                  <Link href="/studio" className="mt-3 inline-flex text-yellow-600 text-xs font-bold hover:underline">
                    Try now →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── VALUE PROPS ── */}
      <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
        <div className="grid grid-cols-2 gap-4 text-center sm:gap-6 md:grid-cols-4">
          {[
            { stat: "Real-time", label: "AR Try-On" },
            { stat: "100%", label: "Browser-based" },
            { stat: "Free", label: "No sign-up needed" },
            { stat: "Instant", label: "Design to preview" },
          ].map((item) => (
            <div key={item.label} className="flex flex-col items-center gap-1 rounded-2xl border border-yellow-100 bg-yellow-50 p-4 sm:p-5">
              <span className="text-2xl font-black text-yellow-500">{item.stat}</span>
              <span className="text-slate-500 text-xs font-medium">{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── COMMUNITY SHOWCASE ── */}
      <CommunityShowcase />

      {/* ── FAQ ── */}
      <section className="border-t border-slate-100 bg-slate-50 px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs font-bold text-yellow-500 uppercase tracking-widest text-center mb-2">FAQ</p>
          <h2 className="text-3xl font-black text-center text-slate-900 mb-10">
            Frequently Asked Questions
          </h2>

          <div className="flex flex-col gap-3">
            {FAQS.map((faq, i) => (
              <div
                key={i}
                className="bg-white rounded-xl border border-slate-100 overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left font-semibold text-slate-800 hover:bg-slate-50 transition-colors text-sm"
                >
                  {faq.q}
                  <ChevronDown
                    size={16}
                    className={`text-slate-400 shrink-0 transition-transform ${openFaq === i ? "rotate-180" : ""}`}
                  />
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4 text-slate-500 text-sm leading-relaxed border-t border-slate-100 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="bg-gradient-to-br from-yellow-500 to-yellow-600 px-4 py-16 text-center sm:px-6 sm:py-20">
        <h2 className="text-3xl md:text-4xl font-black text-white mb-3">
          Ready to create something beautiful?
        </h2>
        <p className="text-yellow-100 mb-8 text-base max-w-md mx-auto">
          Open the studio now — free, instant, no account required.
        </p>
        <Link
          href="/studio"
          className="w-full rounded-full bg-white px-6 py-3.5 text-sm font-black text-yellow-600 shadow-lg transition-all hover:scale-105 sm:w-auto sm:px-8"
        >
          Launch Studio →
        </Link>
      </section>

      <Footer />
    </div>
  );
}
