"use client";
import React, { useState } from "react";
import Link from "next/link";
import Footer from "./Footer";
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
    desc: "Draw, trace, and layer shapes. Import fabric swatches, adjust colors, and build your garment or jewelry design.",
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

export default function LandingPage({ onStart }: { onStart: () => void }) {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="flex flex-col min-h-screen bg-white text-slate-900 font-sans">

      {/* ── NAV ── */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-white/90 backdrop-blur border-b border-slate-100 shadow-sm">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="DesignIt" className="h-7 w-auto" />
          <span className="font-black text-xl tracking-tight text-slate-900">
            Design<span className="text-yellow-500">It</span>
          </span>
        </div>
        <div className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
          <a href="#how-to" className="hover:text-slate-900 transition-colors">How It Works</a>
          <a href="#features" className="hover:text-slate-900 transition-colors">Features</a>
          <Link href="/community" className="hover:text-slate-900 transition-colors">Community</Link>
          <Link href="/about" className="hover:text-slate-900 transition-colors">About</Link>
        </div>
        <button
          onClick={onStart}
          className="bg-yellow-500 hover:bg-yellow-400 text-white font-bold px-5 py-2 rounded-full text-sm transition-all hover:scale-105 shadow-md"
        >
          Launch Studio →
        </button>
      </nav>

      {/* ── HERO ── */}
      <section className="relative flex flex-col items-center justify-center text-center px-6 pt-20 pb-16 overflow-hidden">
        {/* subtle background texture */}
        <div className="absolute inset-0 bg-gradient-to-b from-yellow-50/60 via-white to-white pointer-events-none" />

        <div className="relative z-10 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-yellow-100 text-yellow-700 text-xs font-bold px-3 py-1.5 rounded-full mb-6 tracking-wide uppercase">
            <Sparkles size={12} />
            Design Studio + AR Try-On
          </div>

          <h1 className="text-4xl md:text-6xl font-black leading-tight tracking-tight text-slate-900 mb-4">
            Design Clothes & Jewelry.{" "}
            <span className="text-yellow-500">Try Them On.</span>
          </h1>

          <p className="text-slate-500 text-base md:text-lg mb-8 max-w-lg mx-auto leading-relaxed">
            The only studio that takes your design from blank canvas to AR try-on in minutes — no apps, no photoshoots, no waiting.
          </p>

          {/* Upload-style CTA — mirrors FitRoom's drop zone */}
          <button
            onClick={onStart}
            className="group w-full max-w-sm mx-auto flex flex-col items-center justify-center gap-3 border-2 border-dashed border-yellow-400 rounded-2xl py-10 px-6 bg-yellow-50 hover:bg-yellow-100 transition-all hover:border-yellow-500 cursor-pointer mb-5"
          >
            <div className="w-14 h-14 rounded-full bg-yellow-400 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <Upload size={24} className="text-white" />
            </div>
            <span className="font-bold text-slate-700 text-base">Open the Design Studio</span>
            <span className="text-slate-400 text-xs">No sign-up required — start immediately</span>
          </button>

          <button
            onClick={onStart}
            className="text-yellow-600 text-sm font-semibold hover:underline"
          >
            Or launch directly →
          </button>
        </div>
      </section>

      {/* ── TRUSTED BY ── */}
      <section className="py-6 border-y border-slate-100 bg-slate-50">
        <p className="text-center text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">
          Built for designers, makers & fashion creators
        </p>
        <div className="flex justify-center items-center gap-8 flex-wrap px-6 text-slate-400 text-sm font-semibold">
          {["Jewelry Designers", "Clothing Brands", "Fashion Students", "Boutique Owners", "Hobbyist Makers"].map((label) => (
            <span key={label} className="flex items-center gap-1.5">
              <Gem size={12} className="text-yellow-400" />
              {label}
            </span>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-to" className="py-20 px-6 max-w-5xl mx-auto w-full">
        <p className="text-xs font-bold text-yellow-500 uppercase tracking-widest text-center mb-2">How It Works</p>
        <h2 className="text-3xl md:text-4xl font-black text-center text-slate-900 mb-12">
          From sketch to try-on in 3 steps
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {STEPS.map((step) => (
            <div key={step.num} className="flex flex-col items-center text-center p-6 rounded-2xl bg-slate-50 border border-slate-100 hover:border-yellow-300 hover:shadow-md transition-all">
              <span className="text-4xl font-black text-yellow-400 mb-3">{step.num}</span>
              <h3 className="font-bold text-lg text-slate-800 mb-2">{step.title}</h3>
              <p className="text-slate-500 text-sm leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <button
            onClick={onStart}
            className="bg-yellow-500 hover:bg-yellow-400 text-white font-bold px-8 py-3.5 rounded-full text-sm shadow-md hover:scale-105 transition-all"
          >
            Start Designing Now →
          </button>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="py-20 px-6 bg-slate-50 border-y border-slate-100">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-bold text-yellow-500 uppercase tracking-widest text-center mb-2">Features</p>
          <h2 className="text-3xl md:text-4xl font-black text-center text-slate-900 mb-12">
            Your Personal Design Studio
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-5 p-6 bg-white rounded-2xl border border-slate-100 hover:border-yellow-300 hover:shadow-md transition-all">
                <div className="text-3xl shrink-0">{f.icon}</div>
                <div>
                  <h3 className="font-bold text-slate-800 mb-1">{f.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{f.desc}</p>
                  <button onClick={onStart} className="mt-3 text-yellow-600 text-xs font-bold hover:underline">
                    Try now →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── VALUE PROPS ── */}
      <section className="py-16 px-6 max-w-5xl mx-auto w-full">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[
            { stat: "Real-time", label: "AR Try-On" },
            { stat: "100%", label: "Browser-based" },
            { stat: "Free", label: "No sign-up needed" },
            { stat: "Instant", label: "Design to preview" },
          ].map((item) => (
            <div key={item.label} className="flex flex-col items-center gap-1 p-5 rounded-2xl bg-yellow-50 border border-yellow-100">
              <span className="text-2xl font-black text-yellow-500">{item.stat}</span>
              <span className="text-slate-500 text-xs font-medium">{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── COMMUNITY SHOWCASE ── */}
      <CommunityShowcase />

      {/* ── FAQ ── */}
      <section className="py-20 px-6 bg-slate-50 border-t border-slate-100">
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
      <section className="py-20 px-6 text-center bg-gradient-to-br from-yellow-500 to-yellow-600">
        <h2 className="text-3xl md:text-4xl font-black text-white mb-3">
          Ready to create something beautiful?
        </h2>
        <p className="text-yellow-100 mb-8 text-base max-w-md mx-auto">
          Open the studio now — free, instant, no account required.
        </p>
        <button
          onClick={onStart}
          className="bg-white text-yellow-600 font-black px-8 py-3.5 rounded-full text-sm hover:scale-105 transition-all shadow-lg"
        >
          Launch Studio →
        </button>
      </section>

      <Footer />
    </div>
  );
}
