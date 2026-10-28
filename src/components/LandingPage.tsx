"use client";
import React, { useRef, useState } from "react";
import Link from "next/link";
import AdSlot from "./AdSlot";
import { CommunityShowcase } from "./CommunityShowcase";
import { hughIsLife, whisperingSignature } from "../lib/fonts";
import {
  ArrowRight,
  Camera,
  ChevronDown,
  Download,
  Share2,
} from "lucide-react";

const FAQS = [
  {
    q: "What is DesignIt?",
    a: "DesignIt is a free design studio in your browser for clothes and jewelry: start from a picture, a template or a blank canvas, design it with the studio's tools, then try it on with your camera or a photo.",
  },
  {
    q: "Do I need design experience to use it?",
    a: "No. The studio is built for beginners, hobbyists, and professional designers who want a fast browser workflow.",
  },
  {
    q: "Can I try on jewelry with my webcam?",
    a: "Yes. Necklaces, earrings and garments can be tried on live with your webcam, or on a photo of yourself.",
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

const FEATURED_LINKS = [
  { href: "/blog", label: "Blog" },
  { href: "/community", label: "Community" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

// A step's window: a title bar (with the window's three dots) over what it shows
function StepWindow({ title, className = "", children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border border-[#e3d6ca] bg-white shadow-[0_18px_36px_rgba(15,23,42,0.08)] ${className}`}
    >
      <div className="flex items-center gap-3 border-b border-slate-200 bg-[#f6f1ec] px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-[#6b4a5f]">
        <span className="flex gap-1" aria-hidden>
          <i className="block h-2 w-2 rounded-full bg-[#f87171]" />
          <i className="block h-2 w-2 rounded-full bg-[#fbbf24]" />
          <i className="block h-2 w-2 rounded-full bg-[#34d399]" />
        </span>
        {title}
      </div>
      {children}
    </div>
  );
}

// A step's number, title and what to do, above its window
function StepText({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <div className="pb-4">
      <span className="text-4xl font-black text-[#4f264f]">{num}</span>
      <h3 className="mt-2 text-lg font-bold text-slate-800">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">{children}</p>
    </div>
  );
}

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [isDemoPlaying, setIsDemoPlaying] = useState(true);
  const [isDemoPopupOpen, setIsDemoPopupOpen] = useState(false);
  const homepageAdSlot = process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_HOME_SLOT;
  const demoVideoRef = useRef<HTMLVideoElement | null>(null);

  const toggleDemoVideoPlayback = () => {
    const video = demoVideoRef.current;
    if (!video) return;
    if (video.paused) {
      video
        .play()
        .then(() => setIsDemoPlaying(true))
        .catch(() => setIsDemoPlaying(false));
      return;
    }
    video.pause();
    setIsDemoPlaying(false);
  };

  const chip =
    "inline-flex items-center gap-1 border border-[#e3d6ca] bg-[#f8f1ea] px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em] text-[#6b4a5f]";

  return (
    <div className="min-h-screen bg-[#e8e0d9] px-4 pt-0 font-sans text-slate-900 md:px-8 lg:px-10">
      {isDemoPopupOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-sm">
          <div className="relative w-full max-w-5xl border border-slate-200 bg-white p-4 shadow-[0_30px_80px_rgba(15,23,42,0.35)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-black uppercase tracking-[0.2em] text-[#8a644a]">
                Studio Demo
              </p>
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
            >
              <source src="/demo_video1.mp4" type="video/mp4" />
            </video>
          </div>
        </div>
      )}

      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-[1120px] flex-col overflow-hidden border border-[#e3ddd6] bg-[#fffdfa] shadow-[0_28px_80px_rgba(15,23,42,0.12)]">
        {/* The gist, with the three steps one below another beside it (the gist stays in view beside them) */}
        <section className="grid gap-12 px-5 py-10 md:px-10 md:py-14 lg:grid-cols-[0.85fr_1.15fr] lg:gap-10">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#8a644a]">
              A Free Design Studio In Your Browser
            </p>
            <h1
              className={`${hughIsLife.className} mt-3 text-4xl leading-tight tracking-tight text-[#4f264f] md:text-5xl xl:text-6xl`}
            >
              Design Clothes & Jewelry.
            </h1>
            <h2
              className={`${hughIsLife.className} mt-2 text-2xl leading-tight tracking-tight text-[#4f264f] md:text-3xl xl:text-4xl`}
            >
              Then Try Them On.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-slate-600">
              Start from a picture, a template or a blank canvas. Shape it with drawing, colour, fabric and gem
              tools. Then see it on you, live on your webcam or on a photo, and save it or share it with the
              community. No sign-up, nothing to install.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/studio"
                className="inline-flex items-center gap-2 bg-black px-5 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-white transition-colors hover:bg-slate-800"
              >
                Start Designing <ArrowRight size={14} />
              </Link>
              <a
                href="#how-it-works"
                className="border border-slate-300 px-5 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-slate-700 transition-colors hover:bg-slate-50"
              >
                How It Works
              </a>
            </div>
          </div>

          {/* Three steps, each a window showing it in the studio, one necklace going through all three: picked
              out of a photo, redesigned in emeralds, worn */}
          <div id="how-it-works" className="scroll-mt-24">
          <p className="text-xs font-bold uppercase tracking-widest text-[#8a644a]">How It Works</p>
          <h2 className={`${whisperingSignature.className} mt-1 text-3xl text-slate-900 md:text-4xl`}>
            From idea to try-on in 3 steps
          </h2>

          <div className="mt-6 flex flex-col gap-10">
            {/* 1. Source: the studio's Source window, the necklace found in a photo */}
            <div className="flex flex-col">
              <StepText num="01" title="Source">
                Upload a picture, select a template, or start on a blank canvas. The studio finds the objects in
                your picture: click one to put it on the canvas.
              </StepText>
              <StepWindow title="Source" className="bg-slate-50">
                <img
                  src="/home-step1-source.png"
                  alt="The studio's Source window: a photo of a diamond necklace on a display bust, the necklace outlined as an object"
                  className="mx-auto block max-h-[44rem] w-auto max-w-full py-3"
                />
              </StepWindow>
            </div>

            {/* 2. Design: the necklace cut out, then redesigned */}
            <div className="flex flex-col">
              <StepText num="02" title="Design">
                Use the tools provided: pens and shapes, colours, fabrics, gems and the eraser, then refine it into a
                finished look.
              </StepText>
              <StepWindow title="Studio">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 p-4">
                  <figure className="flex flex-col items-center gap-2">
                    <img
                      src="/home-step2-cutout.png"
                      alt="The diamond necklace cut out of its photo"
                      className="max-h-56 w-full object-contain"
                    />
                    <figcaption className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                      On the canvas
                    </figcaption>
                  </figure>
                  <ArrowRight className="text-[#4f264f]" size={22} aria-hidden />
                  <figure className="flex flex-col items-center gap-2">
                    <img
                      src="/home-step2-designed.png"
                      alt="The same necklace redesigned with emeralds and a blue sapphire drop"
                      className="max-h-56 w-full object-contain"
                    />
                    <figcaption className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                      Redesigned
                    </figcaption>
                  </figure>
                </div>
              </StepWindow>
            </div>

            {/* 3. Try it on or save: the redesigned necklace, worn */}
            <div className="flex flex-col">
              <StepText num="03" title="Try it on or save">
                See it on you, live on your webcam or on a photo. Then download it, or submit it to the community
                gallery.
              </StepText>
              <StepWindow title="Try-On">
                <div className="relative h-[30rem] bg-slate-900">
                  <img
                    src="/home-step3-tryon.jpg"
                    alt="A model on a runway wearing the redesigned emerald necklace"
                    className="absolute inset-0 h-full w-full object-cover object-top"
                  />
                </div>
                <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-white px-3 py-2">
                  <span className={chip}>
                    <Camera size={12} aria-hidden /> Try on
                  </span>
                  <span className={chip}>
                    <Download size={12} aria-hidden /> Download
                  </span>
                  <span className={chip}>
                    <Share2 size={12} aria-hidden /> Submit
                  </span>
                </div>
              </StepWindow>
            </div>
          </div>

          <div className="mt-10 flex justify-center">
            <Link
              href="/studio"
              className="inline-flex items-center gap-2 bg-black px-6 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-white transition-colors hover:bg-slate-800"
            >
              Open The Studio <ArrowRight size={14} />
            </Link>
          </div>
          </div>
        </section>

        {/* The studio in action */}
        <section className="border-t border-[#e7ddd4] px-5 py-12 md:px-10">
          <div className="grid items-center gap-8 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#8a644a]">See It In Action</p>
              <h2 className={`${whisperingSignature.className} mt-1 text-3xl text-slate-900 md:text-4xl`}>
                Studio demo
              </h2>
              <p className="mt-3 max-w-sm text-sm leading-7 text-slate-500">
                A quick look at a design going from the canvas to a try-on.
              </p>
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={toggleDemoVideoPlayback}
                  className="border border-slate-300 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-slate-700 transition-colors hover:bg-slate-50"
                >
                  {isDemoPlaying ? "Pause" : "Play"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsDemoPopupOpen(true)}
                  className="bg-black px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-white transition-colors hover:bg-slate-800"
                >
                  Full Screen
                </button>
              </div>
            </div>
            <video
              ref={demoVideoRef}
              className="aspect-video w-full border border-[#eadfd7] bg-white object-contain"
              autoPlay
              muted
              playsInline
              loop
              preload="metadata"
            >
              <source src="/demo_video1.mp4" type="video/mp4" />
            </video>
          </div>
        </section>

        <div className="border-t border-[#e7ddd4] px-5 md:px-10">
          <CommunityShowcase />
        </div>

        {homepageAdSlot && (
          <section className="px-5 py-6 md:px-8" aria-label="Advertisement">
            <div className="mx-auto max-w-5xl border border-[#e7ddd4] bg-[#fffdfa] p-4">
              <p className="mb-3 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
                Sponsored
              </p>
              <AdSlot slot={homepageAdSlot} className="mx-auto min-h-[90px]" style={{ minHeight: 90 }} />
            </div>
          </section>
        )}

        <section className="border-t border-[#e7ddd4] bg-[#fffdfa] px-5 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl">
            <p className="mb-2 text-center text-xs font-bold uppercase tracking-widest text-[#8a644a]">FAQ</p>
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

        <section className="border-t border-[#e7ddd4] bg-[#fffdfa] px-5 py-12 text-slate-900 md:px-8">
          <div className="grid gap-8 md:grid-cols-[1fr_1.1fr_0.8fr] md:items-start">
            <div>
              <h2 className="text-3xl font-black text-[#4f264f]">DesignIt</h2>
              <p className="mt-3 max-w-xs text-sm leading-7 text-slate-600">
                A browser-native studio for fashion, jewelry, and AR-guided design exploration.
              </p>
            </div>
            <div>
              <p className="text-xl leading-8 text-slate-900">
                We have a lot of creative possibilities waiting. Be the first to find out.
              </p>
              <div className="mt-5 flex max-w-md gap-3">
                <input
                  type="email"
                  placeholder="Enter your email here"
                  className="min-w-0 flex-1 border border-[#d8dbe3] bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                />
                <button className="bg-black px-4 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-white">
                  Submit
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2 text-sm text-slate-600">
              {FEATURED_LINKS.map((item) => (
                <Link key={`footer-${item.href}`} href={item.href} className="hover:text-slate-900">
                  {item.label}
                </Link>
              ))}
              <Link
                href="/studio"
                className="mt-3 inline-block bg-black px-4 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-white"
              >
                Make a Design
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
