"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";

export default function CookieConsent() {
  const [showConsent, setShowConsent] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("cookie-consent");
    if (!consent) {
      setShowConsent(true);
    }
  }, []);

  const acceptCookies = () => {
    localStorage.setItem("cookie-consent", "accepted");
    setShowConsent(false);
  };

  const rejectCookies = () => {
    localStorage.setItem("cookie-consent", "rejected");
    setShowConsent(false);
  };

  if (!showConsent) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-slate-900 text-white p-4 z-[9999] shadow-2xl border-t border-slate-700">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="text-sm text-slate-300 text-center sm:text-left">
          We use cookies to personalize content and ads, to provide social media features and to analyze our traffic. We also share information about your use of our site with our social media, advertising and analytics partners. 
          <Link href="/privacy-policy" className="text-yellow-500 hover:underline ml-1">
            Learn more
          </Link>
        </div>
        <div className="flex w-full flex-wrap gap-3 sm:w-auto sm:shrink-0">
          <button 
            onClick={rejectCookies}
            className="flex-1 rounded-full bg-slate-700 px-4 py-2 text-sm font-bold whitespace-nowrap text-white transition-colors hover:bg-slate-600 sm:flex-none sm:px-6"
          >
            Reject All
          </button>
          <button 
            onClick={acceptCookies}
            className="flex-1 rounded-full bg-yellow-500 px-4 py-2 text-sm font-bold whitespace-nowrap text-slate-900 transition-colors hover:bg-yellow-600 sm:flex-none sm:px-6"
          >
            Accept All
          </button>
        </div>
      </div>
    </div>
  );
}
