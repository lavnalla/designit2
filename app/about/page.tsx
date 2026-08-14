"use client";

import type { Metadata } from "next";
import React from "react";
import Link from "next/link";
import Footer from "../../src/components/Footer";

export const metadata: Metadata = {
  title: "About DesignIt",
  description:
    "Learn about DesignIt, the free browser-based design studio for apparel, jewelry and creative mockups.",
  alternates: {
    canonical: "/about",
  },
};

export default function AboutPage() {
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-slate-50 via-white to-stone-100 text-slate-900">
      <nav className="flex items-center justify-between px-6 py-5 border-b-4 border-[#B87333] bg-gradient-to-r from-yellow-600 via-yellow-500 to-yellow-600 shadow-md">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="DesignIt" className="h-8 w-auto brightness-0 invert" />
          <span className="font-black text-2xl tracking-tight text-white drop-shadow-md">DesignIt</span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/" className="text-white hover:text-yellow-100 font-semibold text-sm uppercase transition-colors drop-shadow-sm">
            Home
          </Link>
          <Link href="/about" className="text-white font-bold text-sm uppercase drop-shadow-sm border-b-2 border-white">
            About
          </Link>
          <Link href="/contact" className="text-white hover:text-yellow-100 font-semibold text-sm uppercase transition-colors drop-shadow-sm">
            Contact
          </Link>
          <Link href="/" className="bg-white text-yellow-700 border border-yellow-200 px-8 py-3 rounded-full font-bold text-sm uppercase transition-all hover:scale-105 shadow-md hover:shadow-lg hover:bg-yellow-50">
            Launch Studio
          </Link>
        </div>
      </nav>

      <main className="flex-1 px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-7xl font-black mb-8 leading-tight text-slate-800">
            About <span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">DesignIt</span>
          </h1>
          
          <div className="prose prose-lg max-w-none">
            <section className="mb-12">
              <h2 className="text-3xl font-black mb-4 text-slate-900">Our Mission</h2>
              <p className="text-slate-600 leading-relaxed text-lg mb-4">
                DesignIt is a cutting-edge digital design studio built for jewelry and clothing designers 
                who demand professional tools without the complexity. We believe that powerful design 
                software should be accessible, intuitive, and lightning-fast.
              </p>
              <p className="text-slate-600 leading-relaxed text-lg">
                Our platform combines advanced image tracing, vector manipulation, and real-time editing 
                capabilities to help you bring your creative vision to life—all in your browser.
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-3xl font-black mb-4 text-slate-900">What We Offer</h2>
              <div className="grid md:grid-cols-2 gap-8">
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-2xl border-2 border-amber-200 shadow-md hover:shadow-lg transition-shadow">
                  <h3 className="text-xl font-black mb-3 bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent">✨ Image Tracing</h3>
                  <p className="text-slate-700 leading-relaxed">
                    Convert bitmap images into editable vector shapes with our intelligent tracing engine. 
                    Perfect for transforming sketches and photos into professional designs.
                  </p>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-2xl border-2 border-amber-200 shadow-md hover:shadow-lg transition-shadow">
                  <h3 className="text-xl font-black mb-3 bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent">🎨 Vector Editing</h3>
                  <p className="text-slate-700 leading-relaxed">
                    Manipulate shapes with precision using distortable control points. Create unique 
                    silhouettes and patterns with complete creative freedom.
                  </p>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-2xl border-2 border-amber-200 shadow-md hover:shadow-lg transition-shadow">
                  <h3 className="text-xl font-black mb-3 bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent">👗 Dress Form Tools</h3>
                  <p className="text-slate-700 leading-relaxed">
                    Design clothes with customizable mannequin measurements. Drape garments using 
                    neck-to-neck alignment for realistic visualization.
                  </p>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-2xl border-2 border-amber-200 shadow-md hover:shadow-lg transition-shadow">
                  <h3 className="text-xl font-black mb-3 bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent">✏️ Drawing & Painting</h3>
                  <p className="text-slate-700 leading-relaxed">
                    Add details with pen, fill, and erase tools. Work with multiple colors and layers 
                    to create rich, detailed designs.
                  </p>
                </div>
              </div>
            </section>

            <section className="mb-12">
              <h2 className="text-3xl font-black mb-4 text-slate-900">Why Choose DesignIt?</h2>
              <ul className="space-y-4">
                <li className="flex items-start gap-3">
                  <span className="text-amber-500 font-black text-2xl">✓</span>
                  <div>
                    <strong className="font-black text-slate-900">No Installation Required:</strong>
                    <span className="text-slate-600"> Work directly in your browser with no downloads or plugins.</span>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-amber-500 font-black text-2xl">✓</span>
                  <div>
                    <strong className="font-black text-slate-900">Professional Results:</strong>
                    <span className="text-slate-600"> Export high-quality designs ready for production or presentation.</span>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-amber-500 font-black text-2xl">✓</span>
                  <div>
                    <strong className="font-black text-slate-900">Fast & Responsive:</strong>
                    <span className="text-slate-600"> Built with modern web technology for smooth, real-time editing.</span>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-amber-500 font-black text-2xl">✓</span>
                  <div>
                    <strong className="font-black text-slate-900">Designer-Focused:</strong>
                    <span className="text-slate-600"> Created by designers, for designers. Every feature is built with your workflow in mind.</span>
                  </div>
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-3xl font-black mb-4 text-slate-900">Behind the Project</h2>
              <p className="text-slate-600 leading-relaxed text-lg mb-4">
                DesignIt is developed by Learncapes Inc., a team passionate about creating innovative 
                tools that empower creative professionals. We're constantly improving and adding new 
                features based on feedback from our community of designers.
              </p>
              <p className="text-slate-600 leading-relaxed text-lg">
                Have questions or suggestions? We'd love to hear from you. Visit our{" "}
                <Link href="/contact" className="text-amber-600 font-bold underline hover:text-orange-600 transition-colors">
                  contact page
                </Link>{" "}
                to get in touch.
              </p>
            </section>
          </div>

          <div className="mt-16 text-center">
            <Link href="/" className="inline-block bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white px-12 py-5 rounded-full font-black uppercase text-sm shadow-2xl hover:shadow-3xl hover:scale-105 transition-all">
              Start Designing Now →
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
