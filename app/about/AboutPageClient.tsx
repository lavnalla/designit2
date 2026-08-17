"use client";

import React from "react";
import Link from "next/link";
import { hughIsLife, whisperingSignature } from "../../src/lib/fonts";

export default function AboutPageClient() {
  return (
    <div className="min-h-screen bg-[#ece8e3] px-4 py-6 text-slate-900 md:px-8 lg:px-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-[1120px] flex-col overflow-hidden bg-[#fffdfa] shadow-[0_28px_80px_rgba(15,23,42,0.12)]">
        <nav className="border-b border-[#ece5db] bg-[#fffdfa] px-5 py-5 md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <img src="/logo.png" alt="DesignIt" className="h-8 w-auto" />
              <div>
                <span className="block truncate text-lg font-black tracking-tight text-slate-900 sm:text-xl">
                  Design<span className="text-[#9b5a2e]">It</span>
                </span>
                <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Browser Design Studio</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-6 text-[11px] font-medium text-slate-600">
              <Link href="/" className="transition-colors hover:text-slate-900">Home</Link>
              <Link href="/blog" className="transition-colors hover:text-slate-900">Blog</Link>
              <Link href="/community" className="transition-colors hover:text-slate-900">Community</Link>
              <Link href="/about" className="text-slate-900">About</Link>
              <Link href="/contact" className="transition-colors hover:text-slate-900">Contact</Link>
              <Link href="/studio" className="bg-black px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-white transition-colors hover:bg-slate-800">
                Make a Design
              </Link>
            </div>
          </div>
        </nav>

        <main className="flex-1 px-5 py-12 md:px-8 md:py-14">
          <div className="mx-auto max-w-5xl">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#7c4a26]">About DesignIt</p>
            <h1 className={`${hughIsLife.className} mt-3 text-5xl leading-tight tracking-tight text-[#6b2fa2] md:text-6xl`}>
              About The Studio
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-8 text-slate-600">
              DesignIt is a browser-based creative studio for clothing, jewelry, vector editing, and AR visualization.
            </p>

          <div className="prose prose-lg max-w-none">
            <section className="mb-12 mt-12 border-t border-[#ece5db] pt-10">
              <h2 className={`${whisperingSignature.className} mb-4 text-4xl text-slate-900`}>Our Mission</h2>
              <p className="text-slate-600 leading-relaxed text-lg mb-4">
                DesignIt is a cutting-edge digital design studio built for jewelry and clothing designers
                who demand professional tools without the complexity. We believe that powerful design
                software should be accessible, intuitive, and lightning-fast.
              </p>
              <p className="text-slate-600 leading-relaxed text-lg">
                Our platform combines advanced image tracing, vector manipulation, and real-time editing
                capabilities to help you bring your creative vision to life-all in your browser.
              </p>
            </section>

            <section className="mb-12">
              <h2 className={`${whisperingSignature.className} mb-6 text-4xl text-slate-900`}>What We Offer</h2>
              <div className="grid md:grid-cols-2 gap-8">
                <div className="border border-[#e5dfd7] bg-white p-6 shadow-[0_18px_36px_rgba(15,23,42,0.06)]">
                  <h3 className="mb-3 text-xl font-black text-slate-900">Image Tracing</h3>
                  <p className="text-slate-700 leading-relaxed">
                    Convert bitmap images into editable vector shapes with our intelligent tracing engine.
                    Perfect for transforming sketches and photos into professional designs.
                  </p>
                </div>
                <div className="border border-[#e5dfd7] bg-white p-6 shadow-[0_18px_36px_rgba(15,23,42,0.06)]">
                  <h3 className="mb-3 text-xl font-black text-slate-900">Vector Editing</h3>
                  <p className="text-slate-700 leading-relaxed">
                    Manipulate shapes with precision using distortable control points. Create unique
                    silhouettes and patterns with complete creative freedom.
                  </p>
                </div>
                <div className="border border-[#e5dfd7] bg-white p-6 shadow-[0_18px_36px_rgba(15,23,42,0.06)]">
                  <h3 className="mb-3 text-xl font-black text-slate-900">Dress Form Tools</h3>
                  <p className="text-slate-700 leading-relaxed">
                    Design clothes with customizable mannequin measurements. Drape garments using
                    neck-to-neck alignment for realistic visualization.
                  </p>
                </div>
                <div className="border border-[#e5dfd7] bg-white p-6 shadow-[0_18px_36px_rgba(15,23,42,0.06)]">
                  <h3 className="mb-3 text-xl font-black text-slate-900">Drawing & Painting</h3>
                  <p className="text-slate-700 leading-relaxed">
                    Add details with pen, fill, and erase tools. Work with multiple colors and layers
                    to create rich, detailed designs.
                  </p>
                </div>
              </div>
            </section>

            <section className="mb-12">
              <h2 className={`${whisperingSignature.className} mb-4 text-4xl text-slate-900`}>Why Choose DesignIt?</h2>
              <ul className="space-y-4">
                <li className="flex items-start gap-3">
                  <span className="font-black text-2xl text-[#7d47b5]">✓</span>
                  <div>
                    <strong className="font-black text-slate-900">No Installation Required:</strong>
                    <span className="text-slate-600"> Work directly in your browser with no downloads or plugins.</span>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="font-black text-2xl text-[#7d47b5]">✓</span>
                  <div>
                    <strong className="font-black text-slate-900">Professional Results:</strong>
                    <span className="text-slate-600"> Export high-quality designs ready for production or presentation.</span>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="font-black text-2xl text-[#7d47b5]">✓</span>
                  <div>
                    <strong className="font-black text-slate-900">Fast & Responsive:</strong>
                    <span className="text-slate-600"> Built with modern web technology for smooth, real-time editing.</span>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="font-black text-2xl text-[#7d47b5]">✓</span>
                  <div>
                    <strong className="font-black text-slate-900">Designer-Focused:</strong>
                    <span className="text-slate-600"> Created by designers, for designers. Every feature is built with your workflow in mind.</span>
                  </div>
                </li>
              </ul>
            </section>

            <section>
              <h2 className={`${whisperingSignature.className} mb-4 text-4xl text-slate-900`}>Behind the Project</h2>
              <p className="text-slate-600 leading-relaxed text-lg mb-4">
                DesignIt is developed by Learncapes Inc., a team passionate about creating innovative
                tools that empower creative professionals. We&apos;re constantly improving and adding new
                features based on feedback from our community of designers.
              </p>
              <p className="text-slate-600 leading-relaxed text-lg mb-4">
                The people behind iDesignIts.com care deeply about practical engineering. We built the platform to combine creative tooling with fast browser delivery, so users can trace images, edit vector shapes, and preview fashion or jewelry ideas without installing desktop software.
              </p>
              <p className="text-slate-600 leading-relaxed text-lg mb-4">
                Our browser-based AR engine works by combining user-approved camera or uploaded image input with landmark detection and layout rules to position items such as earrings, necklaces, and garments inside the preview. That workflow is designed to help users understand proportion and placement before moving forward with a design idea.
              </p>
              <p className="text-slate-600 leading-relaxed text-lg">
                Have questions or suggestions? We&apos;d love to hear from you. Visit our {" "}
                <Link href="/contact" className="text-amber-600 font-bold underline hover:text-orange-600 transition-colors">
                  contact page
                </Link>{" "}
                to get in touch.
              </p>
            </section>
          </div>

          <div className="mt-16 border-t border-[#ece5db] pt-10 text-center">
            <Link href="/studio" className="inline-block bg-black px-8 py-4 text-[10px] font-black uppercase tracking-[0.12em] text-white transition-colors hover:bg-slate-800">
              Start Designing Now
            </Link>
          </div>
        </div>
      </main>
      </div>
    </div>
  );
}