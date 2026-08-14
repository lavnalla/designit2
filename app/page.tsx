"use client";

import React, { useState, useEffect } from "react";

// Navigate: Up one level (..), then into src, then into components
import LandingPage from "../src/components/LandingPage";
import { Studio } from "../src/components/Studio";

export default function Page() {
  const [inStudio, setInStudio] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Prevent hydration errors
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <main className="relative w-full min-h-[100dvh] bg-white">
      {/* LANDING PAGE / WEBSITE VIEW */}
      <div 
        className={`absolute inset-0 z-20 transition-all duration-1000 ease-in-out overflow-y-auto ${
          inStudio ? "-translate-y-full opacity-0 pointer-events-none" : "translate-y-0 opacity-100"
        }`}
      >
        <LandingPage onStart={() => setInStudio(true)} />
      </div>

      {/* STUDIO / PROGRAM VIEW */}
      <div 
        className={`absolute inset-0 z-10 transition-all duration-1000 ease-in-out ${
          inStudio ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0 pointer-events-none"
        }`}
      >
        {inStudio && (
          <div className="w-full h-full">
            {/* onBack allows the user to return to the landing page */}
            <Studio onBack={() => setInStudio(false)} />
          </div>
        )}
      </div>
    </main>
  );
}