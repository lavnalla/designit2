import React from "react";
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="animate-shimmer relative overflow-hidden text-amber-950 py-12 px-6 shadow-[0_-4px_20px_rgba(234,179,8,0.4)]">
      {/* Glossy overlay for extra shine */}
      <div className="absolute inset-0 bg-white/30 mix-blend-overlay pointer-events-none sparkle-bg opacity-40"></div>
      
      {/* Top Border with distinct Diamond look */}
      <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-purple-200 via-white to-sky-200 shadow-lg"></div>

      <div className="max-w-6xl relative z-10 mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-4">
            {/* Darker text for logo on gold */}
            <span className="font-serif text-3xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-emerald-800 to-teal-700 font-bold drop-shadow-sm filter brightness-75">
              DesignIt 💎
            </span>
          </div>
          <p className="text-amber-900 font-serif text-sm max-w-xs italic font-medium">
            The ultimate digital studio for jewelry and clothes designers. Pull, trace, edit, and reimagine designs with professional vector tools.
          </p>
        </div>
        
        <div>
          <h3 className="font-black text-lg mb-4 text-rose-700 uppercase tracking-widest border-b-2 border-emerald-500 inline-block pb-1">
            <span className="mr-2">♦</span> Quick Links
          </h3>
          <ul className="space-y-2 font-medium">
            <li><Link href="/" className="text-emerald-700 hover:text-rose-600 transition-colors flex items-center gap-2"><span className="text-yellow-500 text-xs">✨</span> Home</Link></li>
            <li><Link href="/blog" className="text-emerald-700 hover:text-rose-600 transition-colors flex items-center gap-2"><span className="text-yellow-500 text-xs">✨</span> Blog</Link></li>
            <li><Link href="/studio" className="text-emerald-700 hover:text-rose-600 transition-colors flex items-center gap-2"><span className="text-yellow-500 text-xs">✨</span> Design Studio</Link></li>
            <li><Link href="/about" className="text-emerald-700 hover:text-rose-600 transition-colors flex items-center gap-2"><span className="text-yellow-500 text-xs">✨</span> About Us</Link></li>
            <li><Link href="/contact" className="text-emerald-700 hover:text-rose-600 transition-colors flex items-center gap-2"><span className="text-yellow-500 text-xs">✨</span> Contact</Link></li>
            <li><Link href="/community" className="text-emerald-700 hover:text-rose-600 transition-colors flex items-center gap-2"><span className="text-yellow-500 text-xs">✨</span> Community</Link></li>
          </ul>
        </div>
        
        <div>
          <h3 className="font-black text-lg mb-4 text-rose-700 uppercase tracking-widest border-b-2 border-emerald-500 inline-block pb-1">
            <span className="mr-2">♦</span> Legal
          </h3>
          <ul className="space-y-2 font-medium">
            <li><Link href="/privacy-policy" className="text-emerald-700 hover:text-rose-600 transition-colors flex items-center gap-2"><span className="text-slate-400 text-xs">⚖️</span> Privacy Policy</Link></li>
            <li><Link href="/terms-of-service" className="text-emerald-700 hover:text-rose-600 transition-colors flex items-center gap-2"><span className="text-slate-400 text-xs">⚖️</span> Terms of Service</Link></li>
          </ul>
        </div>
      </div>
      
      <div className="max-w-6xl mx-auto pt-8 border-t border-slate-300 relative z-10 text-center">
        <p className="text-slate-600 text-sm font-semibold">&copy; {new Date().getFullYear()} Learncapes Inc. All rights reserved.</p>
      </div>
    </footer>
  );
}
