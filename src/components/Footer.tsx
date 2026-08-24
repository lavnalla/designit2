import React from "react";
import Link from "next/link";
import { whisperingSignature } from "../lib/fonts";

export default function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-[#ead8dc] bg-[radial-gradient(circle_at_top,rgba(223,246,232,0.45),transparent_34%),linear-gradient(180deg,#fffaf2_0%,#f9e8ee_48%,#fff4ed_100%)] px-6 py-12 text-stone-900 shadow-[0_-4px_20px_rgba(143,106,136,0.14)]">
      <div className="absolute inset-0 bg-white/30 mix-blend-overlay pointer-events-none opacity-30"></div>
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#dff6e8] via-[#fffaf2] to-[#f3d9df]"></div>

      <div className="relative z-10 mx-auto mb-8 grid max-w-6xl grid-cols-1 gap-8 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className={`${whisperingSignature.className} text-4xl tracking-tight text-transparent bg-gradient-to-r from-[#4f264f] via-[#8a644a] to-[#8f6a88] bg-clip-text`}>
              DesignIt
            </span>
          </div>
          <p className="max-w-xs text-sm font-medium leading-7 text-stone-700">
            iDesignIts.com is built by Learncapes Inc. to make browser-based design, vector editing, and AR try-on workflows easier to understand and use.
          </p>
        </div>

        <div>
          <h3 className={`${whisperingSignature.className} mb-4 inline-block border-b-2 border-[#8f6a88] pb-1 text-2xl text-[#4f264f]`}>
            Quick Links
          </h3>
          <ul className={`${whisperingSignature.className} space-y-2 text-xl text-slate-700`}>
            <li><Link href="/" className="transition-colors hover:text-[#8f6a88]">Home</Link></li>
            <li><Link href="/blog" className="transition-colors hover:text-[#8f6a88]">Blog</Link></li>
            <li><Link href="/studio" className="transition-colors hover:text-[#8f6a88]">Design Studio</Link></li>
            <li><Link href="/about" className="transition-colors hover:text-[#8f6a88]">About Us</Link></li>
            <li><Link href="/contact" className="transition-colors hover:text-[#8f6a88]">Contact Us</Link></li>
            <li><Link href="/community" className="transition-colors hover:text-[#8f6a88]">Community</Link></li>
          </ul>
        </div>

        <div>
          <h3 className={`${whisperingSignature.className} mb-4 inline-block border-b-2 border-[#8f6a88] pb-1 text-2xl text-[#4f264f]`}>
            Trust & Legal
          </h3>
          <ul className={`${whisperingSignature.className} space-y-2 text-xl text-slate-700`}>
            <li><Link href="/privacy-policy" className="transition-colors hover:text-[#8f6a88]">Privacy Policy</Link></li>
            <li><Link href="/terms-of-service" className="transition-colors hover:text-[#8f6a88]">Terms of Service</Link></li>
            <li><Link href="/about" className="transition-colors hover:text-[#8f6a88]">About Us</Link></li>
            <li><Link href="/contact" className="transition-colors hover:text-[#8f6a88]">Contact Us</Link></li>
          </ul>
        </div>

        <div>
          <h3 className={`${whisperingSignature.className} mb-4 inline-block border-b-2 border-[#8f6a88] pb-1 text-2xl text-[#4f264f]`}>
            Contact
          </h3>
          <p className="text-sm leading-7 text-slate-700">
            Support: <a href="mailto:support@idesignits.com" className="font-semibold text-[#4f264f] hover:text-[#8f6a88]">support@idesignits.com</a>
          </p>
          <p className="mt-2 text-sm leading-7 text-slate-700">
            Business: <a href="mailto:info@idesignits.com" className="font-semibold text-[#4f264f] hover:text-[#8f6a88]">info@idesignits.com</a>
          </p>
          <p className="mt-3 text-sm leading-7 text-slate-700">
            Questions about privacy, the vector engine, or browser-based AR try-on can also be sent through our contact form.
          </p>
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-6xl border-t border-[#ead8dc] pt-8 text-center">
        <p className="text-sm font-semibold text-slate-600">&copy; {new Date().getFullYear()} Learncapes Inc. All rights reserved.</p>
      </div>
    </footer>
  );
}
