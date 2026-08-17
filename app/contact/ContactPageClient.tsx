"use client";

import React, { useState } from "react";
import Link from "next/link";

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
          <Link href="/about" className="text-white hover:text-yellow-100 font-semibold text-sm uppercase transition-colors drop-shadow-sm">
            About
          </Link>
          <Link href="/contact" className="text-white font-bold text-sm uppercase drop-shadow-sm border-b-2 border-white">
            Contact
          </Link>
          <Link href="/" className="bg-white text-yellow-700 border border-yellow-200 px-8 py-3 rounded-full font-bold text-sm uppercase transition-all hover:scale-105 shadow-md hover:shadow-lg hover:bg-yellow-50">
            Launch Design Studio
          </Link>
        </div>
      </nav>

      <main className="flex-1 px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-7xl font-black mb-8 leading-tight text-slate-800">
            Get in <span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">Touch</span>
          </h1>

          <div className="grid md:grid-cols-2 gap-12">
            <div>
              <h2 className="text-2xl font-black mb-6 text-slate-900">Contact Information</h2>

              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-black mb-2 bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent">Email</h3>
                  <a href="mailto:info@idesignits.com" className="text-slate-600 hover:text-amber-600 transition-colors font-medium">
                    info@idesignits.com
                  </a>
                </div>

                <div>
                  <h3 className="text-lg font-black mb-2 bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent">Support</h3>
                  <a href="mailto:support@idesignits.com" className="text-slate-600 hover:text-amber-600 transition-colors font-medium">
                    support@idesignits.com
                  </a>
                </div>

                <div>
                  <h3 className="text-lg font-black mb-2 bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent">Company</h3>
                  <p className="text-slate-600">
                    Learncapes Inc.<br />
                    Digital Design Solutions
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-black mb-2 bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent">Social Media</h3>
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

              <div className="mt-12 p-6 bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl border-2 border-amber-200 shadow-md">
                <h3 className="text-lg font-black mb-3 text-slate-900">Office Hours</h3>
                <p className="text-slate-600 mb-2">Monday - Friday: 9:00 AM - 6:00 PM EST</p>
                <p className="text-slate-600">Saturday - Sunday: Closed</p>
                <p className="text-slate-500 text-sm mt-4 italic">
                  We typically respond to inquiries within 24-48 hours during business days.
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-black mb-6 text-slate-900">Send Us a Message</h2>

              {submitted ? (
                <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-8 text-center">
                  <div className="text-5xl mb-4">✓</div>
                  <h3 className="text-xl font-black text-green-800 mb-2">Message Sent!</h3>
                  <p className="text-green-700">Thank you for reaching out. We&apos;ll get back to you soon.</p>
                </div>
              ) : error ? (
                <div className="space-y-6">
                  <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6 text-center">
                    <div className="text-3xl mb-2">⚠️</div>
                    <p className="text-red-700 font-bold">{error}</p>
                  </div>
                  <button
                    onClick={() => setError("")}
                    className="w-full bg-slate-200 text-slate-700 px-8 py-3 rounded-xl font-black uppercase text-sm hover:bg-slate-300 transition-colors"
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
                      className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:border-amber-500 focus:outline-none transition-colors"
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
                      className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:border-amber-500 focus:outline-none transition-colors"
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
                      className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:border-amber-500 focus:outline-none transition-colors"
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
                      className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:border-amber-500 focus:outline-none transition-colors resize-none"
                      placeholder="Tell us more..."
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-white px-8 py-4 rounded-full font-black uppercase text-sm shadow-lg hover:shadow-xl hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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

          <div className="mt-16 bg-gradient-to-br from-amber-500 via-orange-500 to-amber-600 rounded-3xl p-8 md:p-12 text-center text-white shadow-2xl">
            <h2 className="text-3xl font-black mb-4">Need Help Getting Started?</h2>
            <p className="text-white mb-6 max-w-2xl mx-auto font-medium">
              Check out our interactive tutorial that guides you through all the features of DesignIt.
              Click the yellow "?" button in the studio to start learning!
            </p>
            <Link href="/" className="inline-block bg-white text-amber-600 px-10 py-4 rounded-full font-black uppercase text-sm shadow-xl hover:scale-105 transition-transform">
              Launch Design Studio →
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}