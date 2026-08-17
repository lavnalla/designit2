"use client";

import React, { useState } from "react";
import Link from "next/link";
import { hughIsLife, whisperingSignature } from "../../src/lib/fonts";

export default function ContactPageClient() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send message");
      }

      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setFormData({ name: "", email: "", subject: "", message: "" });
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

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
              <Link href="/about" className="transition-colors hover:text-slate-900">About</Link>
              <Link href="/contact" className="text-slate-900">Contact</Link>
              <Link href="/studio" className="bg-black px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-white transition-colors hover:bg-slate-800">
                Make a Design
              </Link>
            </div>
          </div>
        </nav>

        <main className="flex-1 px-5 py-12 md:px-8 md:py-14">
          <div className="mx-auto max-w-5xl">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#7c4a26]">Contact DesignIt</p>
            <h1 className={`${hughIsLife.className} mt-3 text-5xl leading-tight tracking-tight text-[#6b2fa2] md:text-6xl`}>
              Get In Touch
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-8 text-slate-600">
              Questions about the studio, AR tools, blog content, or creative workflows can all be sent here.
            </p>

          <div className="mt-12 grid gap-12 md:grid-cols-2">
            <div>
              <h2 className={`${whisperingSignature.className} mb-6 text-4xl text-slate-900`}>Contact Information</h2>

              <div className="space-y-6">
                <div>
                  <h3 className="mb-2 text-lg font-black text-slate-900">Email</h3>
                  <a href="mailto:info@idesignits.com" className="text-slate-600 hover:text-amber-600 transition-colors font-medium">
                    info@idesignits.com
                  </a>
                </div>

                <div>
                  <h3 className="mb-2 text-lg font-black text-slate-900">Support</h3>
                  <a href="mailto:support@idesignits.com" className="text-slate-600 hover:text-amber-600 transition-colors font-medium">
                    support@idesignits.com
                  </a>
                </div>

                <div>
                  <h3 className="mb-2 text-lg font-black text-slate-900">Company</h3>
                  <p className="text-slate-600">
                    Learncapes Inc.<br />
                    Digital Design Solutions
                  </p>
                </div>

                <div>
                  <h3 className="mb-2 text-lg font-black text-slate-900">Social Media</h3>
                  <div className="flex gap-4">
                    <a href="#" className="text-slate-600 hover:text-amber-600 transition-colors font-medium">
                      Twitter
                    </a>
                    <a href="#" className="text-slate-600 hover:text-amber-600 transition-colors font-medium">
                      Instagram
                    </a>
                    <a href="#" className="text-slate-600 hover:text-amber-600 transition-colors font-medium">
                      LinkedIn
                    </a>
                  </div>
                </div>
              </div>

              <div className="mt-12 border border-[#e5dfd7] bg-white p-6 shadow-[0_18px_36px_rgba(15,23,42,0.06)]">
                <h3 className="mb-3 text-lg font-black text-slate-900">Office Hours</h3>
                <p className="text-slate-600 mb-2">Monday - Friday: 9:00 AM - 6:00 PM EST</p>
                <p className="text-slate-600">Saturday - Sunday: Closed</p>
                <p className="text-slate-500 text-sm mt-4 italic">
                  We typically respond to inquiries within 24-48 hours during business days.
                </p>
              </div>
            </div>

            <div>
              <h2 className={`${whisperingSignature.className} mb-6 text-4xl text-slate-900`}>Send Us A Message</h2>

              {submitted ? (
                <div className="border border-green-200 bg-green-50 p-8 text-center">
                  <div className="text-5xl mb-4">✓</div>
                  <h3 className="text-xl font-black text-green-800 mb-2">Message Sent!</h3>
                  <p className="text-green-700">Thank you for reaching out. We&apos;ll get back to you soon.</p>
                </div>
              ) : error ? (
                <div className="space-y-6">
                  <div className="border border-red-200 bg-red-50 p-6 text-center">
                    <div className="text-3xl mb-2">⚠️</div>
                    <p className="text-red-700 font-bold">{error}</p>
                  </div>
                  <button
                    onClick={() => setError("")}
                    className="w-full bg-slate-200 px-8 py-3 text-sm font-black uppercase text-slate-700 transition-colors hover:bg-slate-300"
                  >
                    Try Again
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div>
                    <label htmlFor="name" className="block text-sm font-black uppercase text-slate-700 mb-2">
                      Name *
                    </label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      required
                      className="w-full border border-slate-200 px-4 py-3 focus:border-[#7d47b5] focus:outline-none"
                      placeholder="Your name"
                    />
                  </div>

                  <div>
                    <label htmlFor="email" className="block text-sm font-black uppercase text-slate-700 mb-2">
                      Email *
                    </label>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      required
                      className="w-full border border-slate-200 px-4 py-3 focus:border-[#7d47b5] focus:outline-none"
                      placeholder="your@email.com"
                    />
                  </div>

                  <div>
                    <label htmlFor="subject" className="block text-sm font-black uppercase text-slate-700 mb-2">
                      Subject *
                    </label>
                    <input
                      type="text"
                      id="subject"
                      name="subject"
                      value={formData.subject}
                      onChange={handleChange}
                      required
                      className="w-full border border-slate-200 px-4 py-3 focus:border-[#7d47b5] focus:outline-none"
                      placeholder="What&apos;s this about?"
                    />
                  </div>

                  <div>
                    <label htmlFor="message" className="block text-sm font-black uppercase text-slate-700 mb-2">
                      Message *
                    </label>
                    <textarea
                      id="message"
                      name="message"
                      value={formData.message}
                      onChange={handleChange}
                      required
                      rows={6}
                      className="w-full resize-none border border-slate-200 px-4 py-3 focus:border-[#7d47b5] focus:outline-none"
                      placeholder="Tell us more..."
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-black px-8 py-4 text-sm font-black uppercase text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSubmitting ? "Sending..." : "Send Message →"}
                  </button>

                  <p className="text-xs text-slate-500 text-center">
                    By submitting this form, you agree to our privacy policy and terms of service.
                  </p>
                </form>
              )}
            </div>
          </div>

          <div className="mt-16 bg-[#7d47b5] p-8 text-center text-white shadow-[0_18px_36px_rgba(15,23,42,0.12)] md:p-12">
            <h2 className="mb-4 text-3xl font-black">Need Help Getting Started?</h2>
            <p className="text-white mb-6 max-w-2xl mx-auto font-medium">
              Check out our interactive tutorial that guides you through all the features of DesignIt.
              Click the yellow "?" button in the studio to start learning!
            </p>
            <Link href="/studio" className="inline-block bg-white px-10 py-4 text-sm font-black uppercase text-[#7d47b5] transition-transform hover:scale-105">
              Launch Design Studio
            </Link>
          </div>
        </div>
      </main>
      </div>
    </div>
  );
}