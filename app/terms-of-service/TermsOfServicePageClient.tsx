"use client";

import React from "react";
import Link from "next/link";

export default function TermsOfServicePageClient() {
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-slate-50 via-white to-stone-50 text-slate-900">
      <nav className="flex items-center justify-between px-6 py-5 border-b-2 border-slate-200 bg-white shadow-md">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="DesignIt" className="h-8 w-auto" />
          <span className="font-black text-2xl tracking-tight bg-gradient-to-r from-yellow-600 to-yellow-400 bg-clip-text text-transparent">DesignIt</span>
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
            Terms of Service
          </h1>

          <div className="prose prose-lg max-w-none text-slate-600">
            <p className="mb-6">Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">1. Acceptance of Terms</h2>
            <p className="mb-4">
              By accessing and using DesignIt ("the Service"), you accept and agree to be bound by the terms and provision of this agreement. In addition, when using these particular services, you shall be subject to any posted guidelines or rules applicable to such services. Any participation in this service will constitute acceptance of this agreement. If you do not agree to abide by the above, please do not use this service.
            </p>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">2. Description of Service</h2>
            <p className="mb-4">
              DesignIt provides users with access to a rich collection of resources, including various design tools, image tracing, vector manipulation, and related features. You understand and agree that the Service is provided "AS-IS" and that DesignIt assumes no responsibility for the timeliness, deletion, mis-delivery, or failure to store any user communications or personalization settings.
            </p>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">3. User Conduct</h2>
            <p className="mb-4">
              You agree to use the Service only for lawful purposes. You agree not to take any action that might compromise the security of the site, render the site inaccessible to others, or otherwise cause damage to the site or the Content. You agree not to add to, subtract from, or otherwise modify the Content, or to attempt to access any Content that is not intended for you.
            </p>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">4. Intellectual Property Rights</h2>
            <p className="mb-4">
              The Service and its original content, features, and functionality are and will remain the exclusive property of Learncapes Inc. and its licensors. The Service is protected by copyright, trademark, and other laws of both the United States and foreign countries. Our trademarks and trade dress may not be used in connection with any product or service without the prior written consent of Learncapes Inc.
            </p>
            <p className="mb-4">
              You retain all of your ownership rights in your User Content. By submitting, posting, or displaying User Content on or through the Service, you grant us a worldwide, non-exclusive, royalty-free license to use, copy, reproduce, process, adapt, modify, publish, transmit, display, and distribute such User Content in any and all media or distribution methods.
            </p>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">5. Third-Party Links</h2>
            <p className="mb-4">
              Our Service may contain links to third-party web sites or services that are not owned or controlled by DesignIt. DesignIt has no control over, and assumes no responsibility for, the content, privacy policies, or practices of any third-party web sites or services. You further acknowledge and agree that DesignIt shall not be responsible or liable, directly or indirectly, for any damage or loss caused or alleged to be caused by or in connection with use of or reliance on any such content, goods, or services available on or through any such web sites or services.
            </p>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">6. Disclaimer of Warranties</h2>
            <p className="mb-4">
              Your use of the Service is at your sole risk. The Service is provided on an "AS IS" and "AS AVAILABLE" basis. The Service is provided without warranties of any kind, whether express or implied, including, but not limited to, implied warranties of merchantability, fitness for a particular purpose, non-infringement, or course of performance.
            </p>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">7. Limitation of Liability</h2>
            <p className="mb-4">
              In no event shall DesignIt, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from (i) your access to or use of or inability to access or use the Service; (ii) any conduct or content of any third party on the Service; (iii) any content obtained from the Service; and (iv) unauthorized access, use, or alteration of your transmissions or content, whether based on warranty, contract, tort (including negligence), or any other legal theory, whether or not we have been informed of the possibility of such damage.
            </p>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">8. Changes to Terms</h2>
            <p className="mb-4">
              We reserve the right, at our sole discretion, to modify or replace these Terms at any time. If a revision is material, we will try to provide at least 30 days&apos; notice prior to any new terms taking effect. What constitutes a material change will be determined at our sole discretion.
            </p>

            <h2 className="text-2xl font-bold text-slate-800 mt-8 mb-4">9. Contact Us</h2>
            <p className="mb-4">
              If you have any questions about these Terms, please contact us at:
              <br />
              <a href="mailto:support@idesignits.com" className="text-amber-600 hover:underline font-medium">support@idesignits.com</a>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}