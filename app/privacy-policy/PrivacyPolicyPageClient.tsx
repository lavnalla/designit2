"use client";

import React from "react";
import Link from "next/link";
import { hughIsLife } from "../../src/lib/fonts";

export default function PrivacyPolicyPageClient() {
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-slate-50 via-white to-stone-50 text-slate-900">
      <nav className="flex items-center justify-between px-6 py-5 border-b-2 border-slate-200 bg-white shadow-md">
        <div className="flex items-center gap-2">
          <span className={`${hughIsLife.className} text-3xl leading-none tracking-tight text-slate-900`}>
            Design<span className="text-[#9b5a2e]">It</span>
          </span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/" className="text-slate-500 hover:text-yellow-600 font-semibold text-sm uppercase transition-colors">
            Home
          </Link>
          <Link href="/about" className="text-slate-500 hover:text-yellow-600 font-semibold text-sm uppercase transition-colors">
            About
          </Link>
          <Link href="/contact" className="text-slate-500 hover:text-yellow-600 font-semibold text-sm uppercase transition-colors">
            Contact
          </Link>
          <Link href="/" className="bg-gradient-to-r from-blue-900 to-blue-800 text-white px-8 py-3 rounded-full font-bold text-sm uppercase transition-all hover:scale-105 shadow-lg hover:shadow-xl">
            Launch Design Studio
          </Link>
        </div>
      </nav>

      <main className="flex-1 px-6 py-16">
        <div className="max-w-4xl mx-auto bg-white p-8 md:p-12 rounded-3xl shadow-xl border border-slate-100">
          <h1 className="text-4xl md:text-5xl font-black mb-8 text-slate-800">
            Privacy Policy
          </h1>

          <div className="prose prose-lg max-w-none text-slate-600">
            <p className="mb-6">Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">1. Introduction</h2>
            <p className="mb-4">
              Welcome to DesignIt ("we," "our," or "us"). We respect your privacy and are committed to protecting your personal data. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website and use our design tools.
            </p>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">2. Information We Collect</h2>
            <p className="mb-4">We may collect the following types of information:</p>
            <ul className="list-disc pl-6 mb-4 space-y-2">
              <li><strong>Usage Data:</strong> Information about how you use our website, including your IP address, browser type, operating system, pages visited, and time spent on the site.</li>
              <li><strong>Cookies and Tracking Technologies:</strong> We use cookies and similar tracking technologies to track activity on our website and hold certain information.</li>
              <li><strong>Contact Information:</strong> If you contact us, we may collect your name, email address, and the contents of your message.</li>
              <li><strong>Camera and Photo Inputs:</strong> If you choose to use live try-on or upload an image for AR preview features, your webcam stream and uploaded images are used only to generate the on-screen preview you request.</li>
              <li><strong>Face and Landmark Processing:</strong> For browser-based AR placement, the app may analyze face or body landmarks in memory so earrings, necklaces, garments, or other assets can be positioned on the preview.</li>
            </ul>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">3. Camera, Webcam, and AR Disclosure</h2>
            <p className="mb-4">
              DesignIt&apos;s webcam and upload-based AR tools are optional. We only access your camera after you grant browser permission. Camera frames, uploaded images, and landmark calculations are used to render the preview experience in your browser or in the processing flow required for the feature you selected.
            </p>
            <ul className="list-disc pl-6 mb-4 space-y-2">
              <li>We do not require camera access to browse the site, read the blog, or use non-AR sections.</li>
              <li>We do not sell webcam data or uploaded images.</li>
              <li>You control when to start or stop camera-based previews through your browser and device settings.</li>
              <li>If you contact us for support, we may review materials you intentionally send us to troubleshoot your issue.</li>
            </ul>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">4. How We Use Your Information</h2>
            <p className="mb-4">We use the collected information for various purposes, including:</p>
            <ul className="list-disc pl-6 mb-4 space-y-2">
              <li>To provide and maintain our service</li>
              <li>To improve, personalize, and expand our website</li>
              <li>To understand and analyze how you use our website</li>
              <li>To communicate with you, including for customer service</li>
              <li>To serve advertisements (see "Advertising" section below)</li>
            </ul>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">5. Advertising and Google AdSense</h2>
            <p className="mb-4">
              We use Google AdSense to display ads on our website. Google, as a third-party vendor, uses cookies to serve ads based on your prior visits to our website or other websites.
            </p>
            <ul className="list-disc pl-6 mb-4 space-y-2">
              <li>Google&apos;s use of advertising cookies enables it and its partners to serve ads to our users based on their visit to our sites and/or other sites on the Internet.</li>
              <li>Users may opt out of personalized advertising by visiting <a href="https://myadcenter.google.com/" target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:underline">Google Ads Settings</a>.</li>
              <li>Alternatively, you can opt out of a third-party vendor&apos;s use of cookies for personalized advertising by visiting <a href="https://optout.aboutads.info/" target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:underline">www.aboutads.info</a>.</li>
            </ul>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">6. Third-Party Services</h2>
            <p className="mb-4">
              We may employ third-party companies and individuals to facilitate our service, provide the service on our behalf, perform service-related services, or assist us in analyzing how our service is used (e.g., Vercel Analytics). These third parties have access to your personal data only to perform these tasks on our behalf and are obligated not to disclose or use it for any other purpose.
            </p>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">7. Data Security</h2>
            <p className="mb-4">
              The security of your data is important to us, but remember that no method of transmission over the Internet or method of electronic storage is 100% secure. While we strive to use commercially acceptable means to protect your personal data, we cannot guarantee its absolute security.
            </p>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">8. Children&apos;s Privacy</h2>
            <p className="mb-4">
              Our service does not address anyone under the age of 13. We do not knowingly collect personally identifiable information from anyone under the age of 13.
            </p>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">9. Changes to This Privacy Policy</h2>
            <p className="mb-4">
              We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date.
            </p>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">10. Contact Us</h2>
            <p className="mb-4">
              If you have any questions about this Privacy Policy, please contact us at:
              <br />
              <a href="mailto:support@idesignits.com" className="text-amber-600 hover:underline font-medium">support@idesignits.com</a>
            </p>
          </div>
        </div>
      </main>

    </div>
  );
}