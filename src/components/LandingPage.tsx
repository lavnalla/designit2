"use client";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Footer from "./Footer";
import AdSlot from "./AdSlot";
import { CommunityShowcase } from "./CommunityShowcase";
import { hughIsLife, whisperingSignature } from "../lib/fonts";
import { ChevronDown } from "lucide-react";

const FAQS = [
  {
    q: "What is DesignIt?",
    a: "DesignIt is a digital studio that lets you design jewelry and clothing from scratch using professional vector tools and virtually try them on in real time.",
  },
  {
    q: "Do I need design experience to use it?",
    a: "No. The studio is built for beginners, hobbyists, and professional designers who want a fast browser workflow.",
  },
  {
    q: "Can I try on jewelry with my webcam?",
    a: "Yes. The AR try-on tools use your webcam to preview pieces live in the browser.",
  },
  {
    q: "What file formats can I import?",
    a: "You can import PNG and JPG images as references, artwork, or surface textures in the studio.",
  },
  {
    q: "Can I share my designs with the community?",
    a: "Yes. Designs can be submitted to the community gallery after review.",
  },
  {
    q: "Is DesignIt free to use?",
    a: "Yes. The core design and try-on workflow is available without sign-up.",
  },
];

const STEPS = [
  {
    num: "01",
    title: "Open the Studio",
    desc: "Launch the browser studio and begin immediately without installing desktop software.",
  },
  {
    num: "02",
    title: "Build Your Design",
    desc: "Draw from scratch or import artwork, then refine it with tracing, color, texture, and shape tools.",
  },
  {
    num: "03",
    title: "Preview In AR",
    desc: "Move from canvas to live try-on and inspect your jewelry or fashion concept in context.",
  },
];

const FEATURES = [
  {
    title: "Professional Vector Canvas",
    desc: "Shape, trace, color, and layer your ideas in a fashion-focused design workflow.",
  },
  {
    title: "Jewelry AR Try-On",
    desc: "Preview earrings and necklaces live with browser-based camera tracking.",
  },
  {
    title: "Fabric And Texture Import",
    desc: "Bring swatches, references, and source imagery directly into the studio.",
  },
  {
    title: "Community Gallery",
    desc: "Share finished concepts and explore what other creators are building.",
  },
];

const FEATURED_LINKS = [
  { href: "/blog", label: "Blog" },
  { href: "/community", label: "Community" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

const VALUE_POINTS = [
  { stat: "Real-time", label: "AR Try-On" },
  { stat: "100%", label: "Browser Based" },
  { stat: "Free", label: "No Sign-Up Needed" },
  { stat: "Instant", label: "Design To Preview" },
];

const HERO_CARDS = [
  {
    eyebrow: "We Believe",
    body: "In a workflow where design ideas move from sketch to visualization with speed, clarity, and creative freedom.",
    ctaLabel: "About The Studio",
    ctaHref: "/about",
  },
  {
    eyebrow: "Try It On",
    body: "Preview clothes and jewelry in a more intuitive way by moving from design mode into live try-on, so you can evaluate proportion, placement, and style before making your next creative decision.",
    ctaLabel: "Open The Studio",
    ctaHref: "/studio",
  },
];

export default function LandingPage() {
  const demoVideoSources = ["/demo_video1.mp4", "/demo_video2.mp4"];
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isDemoPlaying, setIsDemoPlaying] = useState(true);
  const [isDemoPopupOpen, setIsDemoPopupOpen] = useState(false);
  const [activeDemoVideoIndex, setActiveDemoVideoIndex] = useState(0);
  const [activeHeroCardIndex, setActiveHeroCardIndex] = useState(0);
  const homepageAdSlot = process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_HOME_SLOT;
  const demoVideoRef = useRef<HTMLVideoElement | null>(null);
  const demoTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playDemoVideo = async (video: HTMLVideoElement) => {
    try {
      await video.play();
      setIsDemoPlaying(true);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setIsDemoPlaying(false);
        return;
      }

      throw error;
    }
  };

  const toggleDemoVideoPlayback = () => {
    const video = demoVideoRef.current;
    if (!video) return;

    if (video.paused) {
      void playDemoVideo(video);
      return;
    }

    video.pause();
    setIsDemoPlaying(false);
  };

  const playNextDemoVideo = () => {
    if (demoTransitionTimeoutRef.current) {
      clearTimeout(demoTransitionTimeoutRef.current);
      demoTransitionTimeoutRef.current = null;
    }

    if (activeDemoVideoIndex >= demoVideoSources.length - 1) {
      return;
    }

    demoTransitionTimeoutRef.current = setTimeout(() => {
      setActiveDemoVideoIndex((currentIndex) => {
        if (currentIndex >= demoVideoSources.length - 1) {
          return currentIndex;
        }

        return currentIndex + 1;
      });
      demoTransitionTimeoutRef.current = null;
    }, 20000);
  };

  useEffect(() => {
    const video = demoVideoRef.current;
    if (!video) {
      return;
    }

    if (isDemoPlaying) {
      void playDemoVideo(video);
      return;
    }

    video.pause();
  }, [activeDemoVideoIndex, isDemoPlaying]);

  useEffect(() => {
    return () => {
      if (demoTransitionTimeoutRef.current) {
        clearTimeout(demoTransitionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setActiveHeroCardIndex((currentIndex) => (currentIndex + 1) % HERO_CARDS.length);
    }, 5000);

    return () => clearInterval(intervalId);
  }, []);

  const activeHeroCard = HERO_CARDS[activeHeroCardIndex];

  return (
    <div className="min-h-screen bg-[#ece8e3] px-4 py-6 font-sans text-slate-900 md:px-8 lg:px-10">
      <aside className="fixed left-2 top-28 z-40 hidden w-44 lg:block xl:left-[max(1rem,calc((100vw-1120px)/2-15.5rem))]">
        <div className="border border-[#e5dfd7] bg-[#fffdfa] p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
          <p className="mb-4 text-[11px] font-black uppercase tracking-[0.24em] text-[#7c4a26]">Navigate</p>
          <nav className={`${whisperingSignature.className} flex flex-col gap-3 text-lg text-slate-600`}>
            <a href="#how-to" className="transition-colors hover:text-slate-900">How It Works</a>
            <a href="#features" className="transition-colors hover:text-slate-900">Features</a>
            <Link href="/blog" className="transition-colors hover:text-slate-900">Blog</Link>
            <Link href="/community" className="transition-colors hover:text-slate-900">Community</Link>
            <Link href="/about" className="transition-colors hover:text-slate-900">About</Link>
          </nav>
        </div>
      </aside>

      {isDemoPopupOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-sm">
          <div className="relative w-full max-w-5xl border border-slate-200 bg-white p-4 shadow-[0_30px_80px_rgba(15,23,42,0.35)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-black uppercase tracking-[0.2em] text-[#7c4a26]">Studio Demo</p>
              <button
                type="button"
                onClick={() => setIsDemoPopupOpen(false)}
                className="border border-slate-300 bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-700 transition-colors hover:bg-slate-200"
              >
                Close
              </button>
            </div>
            <video
              className="w-full border border-slate-200"
              controls
              autoPlay
              muted
              playsInline
              preload="metadata"
              onEnded={playNextDemoVideo}
              key={`popup-${demoVideoSources[activeDemoVideoIndex]}`}
            >
              <source src={demoVideoSources[activeDemoVideoIndex]} type="video/mp4" />
            </video>
          </div>
        </div>
      )}

      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-[1120px] flex-col overflow-hidden bg-[#fffdfa] shadow-[0_28px_80px_rgba(15,23,42,0.12)]">
        <nav className="border-b border-[#ece5db] bg-[#fffdfa] px-5 py-5 md:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div>
                <span className={`${hughIsLife.className} block truncate text-2xl leading-none tracking-tight text-slate-900 sm:text-3xl`}>
                  Design<span className="text-[#9b5a2e]">It</span>
                </span>
                <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Browser Design Studio</span>
              </div>
            </div>
            <div className="hidden items-center gap-6 text-[11px] font-medium text-slate-600 lg:flex">
              <a href="#how-to" className="transition-colors hover:text-slate-900">Programs & Services</a>
              {FEATURED_LINKS.map((item) => (
                <Link key={item.href} href={item.href} className="transition-colors hover:text-slate-900">
                  {item.label}
                </Link>
              ))}
            </div>
            <div className="hidden items-center gap-3 lg:flex">
              <button
                type="button"
                onClick={toggleDemoVideoPlayback}
                className="border border-slate-300 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-slate-700 transition-colors hover:bg-slate-50"
              >
                {isDemoPlaying ? "Stop" : "Play"}
              </button>
              <button
                type="button"
                onClick={() => setIsDemoPopupOpen(true)}
                className="bg-black px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-white transition-colors hover:bg-slate-800"
              >
                Max Demo
              </button>
              <Link
                href="/studio"
                className="bg-black px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-white transition-colors hover:bg-slate-800"
              >
                Make a Design
              </Link>
            </div>
            <button
              type="button"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav-menu"
              aria-label="Toggle navigation menu"
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="inline-flex items-center justify-center border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 lg:hidden"
            >
              Menu
            </button>
          </div>
          {mobileMenuOpen && (
            <div id="mobile-nav-menu" className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 lg:hidden">
              <a href="#how-to" onClick={() => setMobileMenuOpen(false)} className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">How It Works</a>
              <a href="#features" onClick={() => setMobileMenuOpen(false)} className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">Features</a>
              {FEATURED_LINKS.map((item) => (
                <Link
                  key={`mobile-${item.href}`}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
                >
                  {item.label}
                </Link>
              ))}
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  onClick={toggleDemoVideoPlayback}
                  className="flex-1 border border-slate-300 bg-white px-3 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-slate-700"
                >
                  {isDemoPlaying ? "Stop" : "Play"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsDemoPopupOpen(true);
                    setMobileMenuOpen(false);
                  }}
                  className="flex-1 bg-black px-3 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-white"
                >
                  Max Demo
                </button>
              </div>
              <Link
                href="/studio"
                onClick={() => setMobileMenuOpen(false)}
                className="mt-2 inline-flex items-center justify-center bg-black px-4 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-white"
              >
                Make a Design
              </Link>
            </div>
          )}
        </nav>

        <section className="px-5 py-8 md:px-8 md:py-10">
          <div className="relative grid gap-5 lg:grid-cols-[1.05fr_0.95fr] lg:pb-8">
            <div className="max-w-xl lg:pb-24">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#7c4a26]">Creative Technology For Fashion</p>
                <h1 className={`${hughIsLife.className} mt-3 text-4xl leading-tight tracking-tight text-[#6b2fa2] md:text-5xl xl:text-6xl`}>
                  Design Clothes & Jewelry.
                </h1>
                <h2 className={`${hughIsLife.className} mt-2 text-2xl leading-tight tracking-tight text-[#6b2fa2] md:text-3xl xl:text-4xl`}>
                  Create, Customize & Try Them On.
                </h2>
                <p className="mt-4 max-w-md text-base leading-7 text-slate-600">
                  Move from blank canvas to polished visual in a browser studio built for garments, jewelry, swatches, and AR previews.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/studio" className="bg-black px-5 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-white">
                    Open The Studio
                  </Link>
                  <Link href="/blog" className="border border-slate-300 px-5 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">
                    Read The Guides
                  </Link>
                </div>
              </div>
            <div className="relative flex min-h-[34rem] flex-col justify-end overflow-hidden bg-[linear-gradient(180deg,#f4b24f_0%,#f6cf73_24%,#2d6aa0_58%,#6f37b6_100%)] p-6 md:p-8">
              <div className="absolute inset-x-6 top-8 border border-white/30 bg-[#7d47b5] p-8 text-white shadow-[0_18px_36px_rgba(15,23,42,0.18)] md:left-6 md:right-6 md:top-[7rem] lg:left-8 lg:right-8">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/70">{activeHeroCard.eyebrow}</p>
                <p className="mt-4 text-2xl leading-10 md:text-[2rem]">
                  {activeHeroCard.body}
                </p>
                <Link href={activeHeroCard.ctaHref} className="mt-6 inline-block bg-black px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-white">
                  {activeHeroCard.ctaLabel}
                </Link>
              </div>
            </div>

            <div className="border border-[#e3d7c6] bg-white p-3 shadow-[0_18px_36px_rgba(15,23,42,0.08)] lg:absolute lg:left-[2rem] lg:top-[20rem] lg:z-20 lg:w-[18rem] xl:left-[2.5rem] xl:top-[20.5rem] xl:w-[19rem]">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#7c4a26]">Studio Demo</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleDemoVideoPlayback}
                    className="border border-slate-300 bg-white px-2 py-1 text-[8px] font-black uppercase tracking-[0.12em] text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    {isDemoPlaying ? "Stop" : "Play"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsDemoPopupOpen(true)}
                    className="bg-black px-2 py-1 text-[8px] font-black uppercase tracking-[0.12em] text-white transition-colors hover:bg-slate-800"
                  >
                    Max
                  </button>
                </div>
              </div>
              <video
                ref={demoVideoRef}
                className="aspect-video w-full border border-[#eadfce] bg-white object-contain"
                autoPlay
                muted
                playsInline
                preload="metadata"
                onEnded={playNextDemoVideo}
                key={demoVideoSources[activeDemoVideoIndex]}
              >
                <source src={demoVideoSources[activeDemoVideoIndex]} type="video/mp4" />
              </video>
            </div>
          </div>

        </section>

        <section className="px-5 py-8 md:px-8">
          <div className="border-t border-[#ece5db] pt-6">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <p className={`${whisperingSignature.className} text-3xl text-[#7d47b5]`}>Features</p>
                <p className="mt-1 text-sm text-slate-500">A design workflow built for creative iteration, publishing, and AR previewing.</p>
              </div>
              <Link href="/studio" className="bg-black px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-white">
                See More
              </Link>
            </div>
            <div id="features" className="divide-y divide-[#ece5db] border-y border-[#ece5db] bg-white">
              {FEATURES.map((feature, index) => (
                <div key={feature.title} className="grid items-center gap-4 px-4 py-5 md:grid-cols-[5rem_1fr_auto] md:px-0">
                  <div className="text-center text-2xl font-light text-slate-500">{String(index + 1).padStart(2, "0")}</div>
                  <div>
                    <h3 className="text-2xl text-slate-900">{feature.title}</h3>
                    <p className="mt-1 text-sm leading-7 text-slate-500">{feature.desc}</p>
                  </div>
                  <Link href="/studio" className="justify-self-start bg-[#7d47b5] px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-white md:justify-self-end">
                    Explore
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {homepageAdSlot && (
          <section className="px-5 py-6 md:px-8" aria-label="Advertisement">
            <div className="mx-auto max-w-5xl border border-[#e5d8c8] bg-[#f3ede5] p-4">
              <p className="mb-3 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
                Sponsored
              </p>
              <AdSlot slot={homepageAdSlot} className="mx-auto min-h-[90px]" style={{ minHeight: 90 }} />
            </div>
          </section>
        )}

        <section className="grid gap-8 px-5 py-8 md:px-8 lg:grid-cols-[1fr_22rem]">
          <div>
            <div className="grid gap-5 lg:grid-cols-[0.95fr_1.2fr_0.8fr]">
              <div className="overflow-hidden bg-[#dcc7aa]">
                <img src="/design2.png" alt="Design workflow inspiration" className="h-full w-full object-cover" />
              </div>
              <div className="flex min-h-[17rem] items-center bg-[#7d47b5] p-8 text-white">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/70">What We Offer</p>
                  <p className="mt-4 text-3xl leading-10">From vector editing tools to AR preview workflows, the studio brings ideas into focus fast.</p>
                  <Link href="/studio" className="mt-6 inline-block bg-black px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-white">
                    Open The Studio
                  </Link>
                </div>
              </div>
              <div className="overflow-hidden bg-[#b6c5d2]">
                <img src="/design3.png" alt="Creative community inspiration" className="h-full w-full object-cover" />
              </div>
            </div>

            <section className="py-12">
              <div className="grid grid-cols-2 gap-0 border border-[#e5dfd7] bg-white text-center md:grid-cols-4">
                {VALUE_POINTS.map((item) => (
                  <div key={item.label} className="flex flex-col items-center gap-1 border border-[#e5dfd7] p-6 sm:p-7">
                    <span className="text-2xl font-black text-[#7d47b5]">{item.stat}</span>
                    <span className="text-xs font-medium text-slate-500">{item.label}</span>
                  </div>
                ))}
              </div>
            </section>

            <CommunityShowcase />

            <section className="border-t border-[#e5d8c8] bg-[#f3ede5] px-5 py-16 sm:px-6 sm:py-20">
              <div className="mx-auto max-w-2xl">
                <p className="mb-2 text-center text-xs font-bold uppercase tracking-widest text-[#7c4a26]">FAQ</p>
                <h2 className="mb-10 text-center text-3xl font-black text-slate-900">Frequently Asked Questions</h2>

                <div className="flex flex-col gap-3">
                  {FAQS.map((faq, index) => (
                    <div key={faq.q} className="overflow-hidden border border-slate-100 bg-white">
                      <button
                        onClick={() => setOpenFaq(openFaq === index ? null : index)}
                        className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50"
                      >
                        {faq.q}
                        <ChevronDown
                          size={16}
                          className={`shrink-0 text-slate-400 transition-transform ${openFaq === index ? "rotate-180" : ""}`}
                        />
                      </button>
                      {openFaq === index && (
                        <div className="border-t border-slate-100 px-5 pb-4 pt-3 text-sm leading-relaxed text-slate-500">
                          {faq.a}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <section id="how-to" className="hidden lg:block">
            <div className="sticky top-28 border border-[#e5dfd7] bg-[#fffdfa] p-6 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[#7c4a26]">How It Works</p>
              <h2 className={`${whisperingSignature.className} mb-8 text-3xl text-slate-900`}>
                From sketch to try-on in 3 steps
              </h2>

              <div className="grid grid-cols-1 gap-4">
                {STEPS.map((step) => (
                  <div key={step.num} className="border border-slate-100 bg-slate-50 p-5">
                    <span className="mb-3 block text-4xl font-black text-[#7d47b5]">{step.num}</span>
                    <h3 className="mb-2 text-lg font-bold text-slate-800">{step.title}</h3>
                    <p className="text-sm leading-relaxed text-slate-500">{step.desc}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <Link href="/studio" className="inline-flex bg-black px-5 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-white">
                  Start Designing
                </Link>
              </div>
            </div>
          </section>
        </section>

        <section className="px-5 pb-10 lg:hidden md:px-8">
          <div className="border border-[#e5dfd7] bg-[#fffdfa] p-6 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[#7c4a26]">How It Works</p>
            <h2 className={`${whisperingSignature.className} mb-8 text-3xl text-slate-900`}>
              From sketch to try-on in 3 steps
            </h2>
            <div className="grid gap-4">
              {STEPS.map((step) => (
                <div key={`mobile-${step.num}`} className="border border-slate-100 bg-slate-50 p-5">
                  <span className="mb-3 block text-4xl font-black text-[#7d47b5]">{step.num}</span>
                  <h3 className="mb-2 text-lg font-bold text-slate-800">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-500">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#7d47b5] px-5 py-12 text-white md:px-8">
          <div className="grid gap-8 md:grid-cols-[1fr_1.1fr_0.8fr] md:items-start">
            <div>
              <h2 className="text-3xl font-black">DesignIt</h2>
              <p className="mt-3 max-w-xs text-sm leading-7 text-white/80">
                A browser-native studio for fashion, jewelry, and AR-guided design exploration.
              </p>
            </div>
            <div>
              <p className="text-xl leading-8">We have a lot of creative possibilities waiting. Be the first to find out.</p>
              <div className="mt-5 flex max-w-md gap-3">
                <input
                  type="email"
                  placeholder="Enter your email here"
                  className="min-w-0 flex-1 border border-white/30 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/60 focus:outline-none"
                />
                <button className="bg-white px-4 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-[#7d47b5]">
                  Submit
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2 text-sm text-white/80">
              {FEATURED_LINKS.map((item) => (
                <Link key={`footer-${item.href}`} href={item.href} className="hover:text-white">
                  {item.label}
                </Link>
              ))}
              <Link href="/studio" className="mt-3 inline-block bg-black px-4 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-white">
                Make a Design
              </Link>
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </div>
  );
}
