"use client";
import React, { useRef, useState } from "react";
import Link from "next/link";
import AdSlot from "./AdSlot";
import { CommunityShowcase } from "./CommunityShowcase";
import { cormorant } from "../lib/fonts";
import { ArrowRight, Camera, ChevronDown, Gem, Play, ScanSearch, Share2, Sparkles, Wand2 } from "lucide-react";

const FAQS = [
  {
    q: "What is DesignIt?",
    a: "A free design studio in your browser for jewellery and clothes. Start from a picture, a template or a blank canvas, design it with the studio's tools, then try it on with your camera or a photo.",
  },
  {
    q: "Do I need design experience?",
    a: "No. Pick a picture, click the piece you want, and start changing it. The studio is made for beginners and professionals alike.",
  },
  {
    q: "Can I try things on with my webcam?",
    a: "Yes. Necklaces, earrings and garments follow you live on your webcam, or fit onto a photo of yourself.",
  },
  {
    q: "What pictures can I use?",
    a: "Any PNG or JPG: a product photo, a photo of someone wearing it, or your own sketch. The studio finds the pieces in it for you.",
  },
  {
    q: "Can I share my designs?",
    a: "Yes. Submit a design and, once it's reviewed, it appears in the community gallery.",
  },
  {
    q: "Is it really free?",
    a: "Yes. Designing and trying on are free, with no sign-up and nothing to install.",
  },
];

// What the studio works with, for the band that scrolls across under the hero
const MARQUEE = ["Necklaces", "Earrings", "Dresses", "Sarees", "Tops", "Fabrics", "Gemstones", "Live try-on"];

const STEPS = [
  {
    num: "01",
    title: "Start from any picture",
    body: "Upload a photo, pick a template or begin on a blank canvas. The studio finds every piece in your picture, so one click lifts a necklace off its display or a top off a model.",
    tags: ["Upload", "Templates", "Finds the pieces"],
  },
  {
    num: "02",
    title: "Make it yours",
    body: "Redraw it, recolour it, set it with emeralds, rubies or diamonds, drape it in a new fabric. Pens, shapes, gems and an eraser: everything an atelier needs.",
    tags: ["Pens & shapes", "Gems & metals", "Fabrics"],
  },
  {
    num: "03",
    title: "See it on you",
    body: "Try it on live with your webcam, or fit it onto a photo of yourself, shaped to your body. Then download it, or share it with the community.",
    tags: ["Webcam", "Your photo", "Share"],
  },
];

const FEATURES = [
  { icon: ScanSearch, title: "Finds the pieces", body: "Every necklace, earring and garment in a photo, cut out and ready." },
  { icon: Gem, title: "Real-looking gems", body: "Gold, platinum and silver that shine; stones cut and set." },
  { icon: Camera, title: "Live try-on", body: "Jewellery and clothes that follow you on your webcam." },
  { icon: Share2, title: "Share your designs", body: "A community gallery of what others are making." },
];

// The hero's backdrop: deep sapphire (midnight blue), with a glow of gold and of emerald behind the picture
const HERO_BACKDROP =
  "radial-gradient(60rem 40rem at 85% 30%, rgba(16,185,129,0.18), transparent 60%)," +
  "radial-gradient(50rem 30rem at 15% 10%, rgba(212,166,74,0.20), transparent 60%)," +
  "radial-gradient(40rem 40rem at 50% 120%, rgba(126,34,206,0.30), transparent 60%)," +
  "linear-gradient(180deg, #0c1633 0%, #14244f 55%, #0a1229 100%)";

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [isDemoPopupOpen, setIsDemoPopupOpen] = useState(false);
  const homepageAdSlot = process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_HOME_SLOT;
  const demoVideoRef = useRef<HTMLVideoElement | null>(null);

  const goldButton =
    "inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#c9973b] via-[#f3d98b] to-[#c9973b] px-7 py-3.5 text-[11px] font-black uppercase tracking-[0.18em] text-[#0f1a3a] shadow-[0_10px_40px_rgba(212,166,74,0.35)] transition-transform hover:scale-[1.03]";
  const ghostButton =
    "inline-flex items-center gap-2 rounded-full border border-white/25 px-7 py-3.5 text-[11px] font-black uppercase tracking-[0.18em] text-white/90 transition-colors hover:border-[#f3d98b] hover:text-[#f3d98b]";
  const eyebrow = "text-[11px] font-black uppercase tracking-[0.32em] text-[#c9973b]";

  return (
    <div className="font-sans text-slate-900">
      {isDemoPopupOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm">
          <div className="relative w-full max-w-5xl rounded-2xl border border-[#c9973b]/40 bg-[#0c1633] p-4 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className={eyebrow}>Studio demo</p>
              <button
                type="button"
                onClick={() => setIsDemoPopupOpen(false)}
                className="rounded-full border border-white/20 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-white/80 hover:text-white"
              >
                Close
              </button>
            </div>
            <video className="w-full rounded-lg" controls autoPlay muted playsInline preload="metadata" poster="/demo_video_studio_poster.jpg">
              <source src="/demo_video_studio.mp4" type="video/mp4" />
            </video>
          </div>
        </div>
      )}

      {/* ——— Hero: sapphire, gold and emerald, the look that hits you first ——— */}
      <section className="relative overflow-hidden text-white" style={{ background: HERO_BACKDROP }}>
        {/* (Fine gold lines across, like a jeweller's case) */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "repeating-linear-gradient(115deg, #f3d98b 0 1px, transparent 1px 60px)" }}
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-14 md:px-10 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
          <div>
            <p className={eyebrow}>✦ Your atelier, in the browser</p>
            <h1 className={`${cormorant.className} mt-5 text-[3.4rem] font-semibold leading-[0.92] tracking-tight sm:text-7xl lg:text-[5.6rem]`}>
              Design it.
              <br />
              <span className="text-gold-shimmer italic">Wear it.</span>
              <br />
              Own the look.
            </h1>
            <p className="mt-7 max-w-md text-base leading-7 text-white/75 md:text-lg md:leading-8">
              Turn any picture into your own jewellery or outfit. Redraw it, recolour it, set it with gems, then see it
              on you: live on camera, or on your photo.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/studio" className={goldButton}>
                Start designing <ArrowRight size={15} />
              </Link>
              <a href="#how-it-works" className={ghostButton}>
                See how it works
              </a>
            </div>
            <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/55">
              {["Free", "No sign-up", "Nothing to install"].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-[#c9973b]" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* The finished look: the runway photo in an arch, the emerald necklace floating in front */}
          <div className="relative mx-auto h-[28rem] w-full max-w-[30rem] sm:h-[34rem]">
            <div className="absolute right-0 top-0 h-full w-[74%] overflow-hidden rounded-t-[999px] border border-[#c9973b]/50 shadow-[0_0_80px_rgba(16,185,129,0.25)]">
              <img
                src="/home-step3-tryon.jpg"
                alt="A model on a runway wearing an emerald necklace designed in DesignIt"
                className="h-full w-full object-cover object-top"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0c1633]/70 via-transparent to-transparent" aria-hidden />
            </div>
            <img
              src="/home-hero-necklace.png"
              alt="The emerald necklace, redesigned from a diamond necklace"
              className="animate-float-soft absolute -left-2 bottom-8 w-[64%] drop-shadow-[0_18px_40px_rgba(16,185,129,0.55)]"
            />
            <div className="absolute left-0 top-6 flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 p-2.5 pr-4 backdrop-blur-md">
              <img src="/home-step2-cutout.png" alt="" className="h-11 w-11 rounded-xl bg-white object-contain p-1" />
              <ArrowRight size={14} className="text-[#f3d98b]" aria-hidden />
              <img src="/home-step2-designed.png" alt="" className="h-11 w-11 rounded-xl bg-white object-contain p-1" />
              <span className="text-[10px] font-bold uppercase leading-tight tracking-[0.14em] text-white/80">
                Diamonds
                <br />
                to emeralds
              </span>
            </div>
          </div>
        </div>

        {/* Everything it works with, scrolling by */}
        <div className="relative overflow-hidden border-y border-[#c9973b]/30 bg-[#081026]/60 py-4" aria-hidden>
          <div className="animate-marquee flex w-max gap-10 whitespace-nowrap">
            {[...MARQUEE, ...MARQUEE, ...MARQUEE, ...MARQUEE].map((word, i) => (
              <span
                key={i}
                className={`${cormorant.className} flex items-center gap-10 text-2xl italic text-[#f3d98b]/85`}
              >
                {word}
                <Sparkles size={14} className="text-[#c9973b]" />
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ——— How it works: three steps, one necklace from a photo to the runway ——— */}
      <section id="how-it-works" className="scroll-mt-20 bg-[#faf6ef] px-5 py-20 md:px-10 md:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-2xl text-center">
            <p className={eyebrow}>How it works</p>
            <h2 className={`${cormorant.className} mt-4 text-4xl font-semibold leading-tight text-[#0f1a3a] md:text-6xl`}>
              From a picture to the runway, <span className="italic text-[#8a5a14]">in three steps</span>
            </h2>
          </div>

          <div className="mt-16 flex flex-col gap-20 md:gap-28">
            {STEPS.map((step, index) => (
              <div
                key={step.num}
                className={`grid items-center gap-10 md:grid-cols-2 md:gap-16 ${index % 2 ? "md:[&>*:first-child]:order-2" : ""}`}
              >
                <div>
                  <span
                    className={`${cormorant.className} block text-[6.5rem] font-bold leading-none text-transparent md:text-[9rem]`}
                    style={{ WebkitTextStroke: "1.5px #c9973b" }}
                    aria-hidden
                  >
                    {step.num}
                  </span>
                  <h3 className={`${cormorant.className} mt-1 text-4xl font-semibold text-[#0f1a3a] md:text-5xl`}>
                    {step.title}
                  </h3>
                  <p className="mt-5 max-w-md text-base leading-8 text-slate-600">{step.body}</p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {step.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-[#c9973b]/40 bg-white px-3.5 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#8a5a14]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="relative">
                  <div className="absolute -inset-3 rounded-[2rem] bg-gradient-to-br from-[#f3d98b]/40 via-transparent to-[#10b981]/20 blur-xl" aria-hidden />
                  <div className="relative overflow-hidden rounded-[1.75rem] border border-[#c9973b]/30 bg-white shadow-[0_30px_70px_rgba(12,22,51,0.15)]">
                    {index === 0 && (
                      <div className="flex justify-center bg-gradient-to-b from-[#f3ece2] to-white py-6">
                        <img
                          src="/home-step1-source.png"
                          alt="The studio's Source window: a photo of a diamond necklace on a display bust, the necklace found and outlined"
                          className="max-h-[32rem] w-auto max-w-full rounded-xl shadow-lg"
                        />
                      </div>
                    )}
                    {index === 1 && (
                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 p-6 md:p-8">
                        <figure className="flex flex-col items-center gap-3">
                          <img src="/home-step2-cutout.png" alt="The diamond necklace, lifted out of its photo" className="max-h-60 w-full object-contain" />
                          <figcaption className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Before</figcaption>
                        </figure>
                        <Wand2 className="text-[#c9973b]" size={26} aria-hidden />
                        <figure className="flex flex-col items-center gap-3">
                          <img src="/home-step2-designed.png" alt="The same necklace redesigned in emeralds with a sapphire drop" className="max-h-60 w-full object-contain" />
                          <figcaption className="text-[10px] font-black uppercase tracking-[0.18em] text-[#047857]">After</figcaption>
                        </figure>
                      </div>
                    )}
                    {index === 2 && (
                      <div className="relative h-[30rem]">
                        <img
                          src="/home-step3-tryon.jpg"
                          alt="A model on a runway wearing the redesigned emerald necklace"
                          className="absolute inset-0 h-full w-full object-cover object-top"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-20 flex justify-center">
            <Link href="/studio" className={goldButton}>
              Open the studio <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* ——— What's in the studio, and the demo ——— */}
      <section className="relative overflow-hidden px-5 py-20 text-white md:px-10 md:py-28" style={{ background: HERO_BACKDROP }}>
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className={eyebrow}>Inside the studio</p>
            <h2 className={`${cormorant.className} mt-4 text-4xl font-semibold leading-tight md:text-6xl`}>
              Everything an atelier has. <span className="italic text-[#f3d98b]">None of the cost.</span>
            </h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                  <Icon className="text-[#f3d98b]" size={22} aria-hidden />
                  <h3 className="mt-3 text-sm font-black uppercase tracking-[0.14em]">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/65">{body}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-[#c9973b]/20 blur-2xl" aria-hidden />
            <div className="relative overflow-hidden rounded-[1.5rem] border border-[#c9973b]/40 bg-black shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
              <video
                ref={demoVideoRef}
                className="aspect-video w-full object-contain"
                autoPlay
                muted
                playsInline
                loop
                preload="metadata"
                poster="/demo_video_studio_poster.jpg"
              >
                <source src="/demo_video_studio.mp4" type="video/mp4" />
              </video>
              <button
                type="button"
                onClick={() => setIsDemoPopupOpen(true)}
                className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#f3d98b] backdrop-blur hover:bg-black/90"
              >
                <Play size={12} /> Watch full screen
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ——— The community ——— */}
      <section className="bg-[#faf6ef] px-5 pt-20 md:px-10 md:pt-28">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className={eyebrow}>The community</p>
              <h2 className={`${cormorant.className} mt-4 text-4xl font-semibold text-[#0f1a3a] md:text-6xl`}>
                Made in <span className="italic text-[#8a5a14]">DesignIt</span>
              </h2>
            </div>
            <Link
              href="/community"
              className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-[#8a5a14] hover:text-[#0f1a3a]"
            >
              See the gallery <ArrowRight size={14} />
            </Link>
          </div>
        </div>
        <CommunityShowcase hideHeading className="mx-auto mt-10 w-full max-w-6xl" />
      </section>

      {homepageAdSlot && (
        <section className="bg-[#faf6ef] px-5 pt-14 md:px-10" aria-label="Advertisement">
          <div className="mx-auto max-w-5xl rounded-2xl border border-[#e8dccb] bg-white p-4">
            <p className="mb-3 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Sponsored</p>
            <AdSlot slot={homepageAdSlot} className="mx-auto min-h-[90px]" style={{ minHeight: 90 }} />
          </div>
        </section>
      )}

      {/* ——— Questions ——— */}
      <section className="bg-[#faf6ef] px-5 py-20 md:px-10 md:py-28">
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <p className={eyebrow}>Questions</p>
            <h2 className={`${cormorant.className} mt-4 text-4xl font-semibold text-[#0f1a3a] md:text-5xl`}>
              Everything you&apos;d like to know
            </h2>
          </div>
          <div className="mt-12 divide-y divide-[#e8dccb] border-y border-[#e8dccb]">
            {FAQS.map((faq, index) => (
              <div key={faq.q}>
                <button
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  className="flex w-full items-center justify-between gap-4 py-5 text-left"
                  aria-expanded={openFaq === index}
                >
                  <span className={`${cormorant.className} text-2xl font-semibold text-[#0f1a3a]`}>{faq.q}</span>
                  <ChevronDown
                    size={18}
                    className={`shrink-0 text-[#c9973b] transition-transform ${openFaq === index ? "rotate-180" : ""}`}
                  />
                </button>
                {openFaq === index && <p className="pb-6 pr-8 text-base leading-7 text-slate-600">{faq.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ——— The last word ——— */}
      <section className="relative overflow-hidden px-5 py-24 text-center text-white md:px-10" style={{ background: HERO_BACKDROP }}>
        <img
          src="/home-hero-necklace.png"
          alt=""
          className="pointer-events-none absolute left-1/2 top-1/2 w-[38rem] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-[0.12]"
          aria-hidden
        />
        <div className="relative mx-auto max-w-2xl">
          <h2 className={`${cormorant.className} text-5xl font-semibold leading-tight md:text-7xl`}>
            Your next look starts <span className="text-gold-shimmer italic">with a picture.</span>
          </h2>
          <div className="mt-10 flex justify-center">
            <Link href="/studio" className={goldButton}>
              Start designing, free <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
