"use client";
import React from "react";
import Link from "next/link";
import Footer from "./Footer";
import { CommunityShowcase } from "./CommunityShowcase";

export default function LandingPage({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-slate-50 via-white to-stone-100 text-slate-900">
      <nav className="flex items-center justify-between px-6 py-5 border-b-4 border-[#B87333] bg-gradient-to-r from-yellow-600 via-yellow-500 to-yellow-600 shadow-xl overflow-hidden relative">
        {/* Gems Decoration */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-rose-500 to-emerald-500 opacity-50"></div>
        
        <div className="flex items-center gap-2 relative z-10">
          <img src="/logo.png" alt="DesignIt" className="h-8 w-auto brightness-0 invert drop-shadow-md" />
          <span className="font-black text-2xl tracking-tight text-white drop-shadow-lg flex items-center gap-2">
            DesignIt 
            <span className="flex gap-1 text-[10px] items-center opacity-90">
               <span className="text-emerald-400 drop-shadow-md">♦</span>
               <span className="text-rose-500 drop-shadow-md">♦</span>
            </span>
          </span>
        </div>

        <div className="flex items-center gap-6 text-xs font-bold tracking-wide">
          <Link href="/try-on" className="text-white hover:text-yellow-100 transition-colors drop-shadow-sm">
            Try it on
          </Link>
          <Link href="/community" className="text-white hover:text-yellow-100 transition-colors drop-shadow-sm">
            Community
          </Link>
          <Link href="/admin" className="text-white hover:text-yellow-100 transition-colors drop-shadow-sm">
            Admin
          </Link>
          <Link href="/about" className="text-white hover:text-yellow-100 transition-colors drop-shadow-sm">
            About
          </Link>
          <Link href="/contact" className="text-white hover:text-yellow-100 transition-colors drop-shadow-sm">
            Contact
          </Link>
          <button onClick={onStart} className="bg-white text-yellow-700 border border-yellow-200 px-5 py-2 rounded-full font-bold text-xs uppercase transition-all hover:scale-105 shadow-md hover:shadow-lg hover:bg-yellow-50">
            Launch Studio
          </button>
        </div>
      </nav>

      <main className="flex flex-col lg:flex-row items-center justify-between gap-8 px-6 lg:px-12 py-6 max-w-[1000px] mx-auto w-full">
        {/* Title Section */}
        <div className="flex-1 flex flex-col items-start text-left shrink-0 max-w-md">
          <h1 className="text-2xl md:text-3xl font-black mb-2 leading-tight text-slate-800 tracking-tight">
            CRAFT YOUR <span className="text-[#B87333]">Design.</span>
          </h1>
          <p className="text-slate-500 text-xs md:text-sm mb-4 font-medium leading-relaxed">
            The ultimate digital studio for jewelry and clothes designers. Pull, trace, edit, and reimagine designs with professional vector tools.
          </p>
          
          <div className="flex flex-wrap items-center gap-3 self-start">
            <button onClick={onStart} className="bg-gradient-to-r from-yellow-500 via-yellow-600 to-[#B87333] text-white px-6 py-2.5 rounded-full font-bold uppercase text-xs shadow-md hover:shadow-lg hover:scale-105 transition-all hover:from-yellow-400 hover:to-yellow-500 border border-yellow-400">
                Start Designing →
            </button>
            <Link
              href="/try-on"
              className="px-6 py-2.5 rounded-full font-bold uppercase text-xs border-2 border-[#B87333] text-[#B87333] bg-white hover:bg-amber-50 hover:scale-105 transition-all shadow-sm"
            >
              Try it on
            </Link>
          </div>
        </div>
        
        {/* Video Section - Wide Banner Style */}
        <div className="w-full max-w-[400px] h-48 rounded-xl shadow-lg overflow-hidden border-4 border-slate-100 bg-slate-50 relative ring-1 ring-[#B87333]">
           <video 
             src="/demo_video.mp4" 
             controls
             autoPlay
             muted
             loop
             playsInline
             className="w-full h-full object-cover"
             poster="/logo.png"
           >
             Your browser does not support the video tag.
           </video>
        </div>
      </main>

      {/* Community Section */}
      <CommunityShowcase />

      <Footer />
    </div>
  );
}