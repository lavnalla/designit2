import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Download Extension',
  description: 'Download the DesignIt browser extension and install it to open web images directly in Studio.',
  alternates: {
    canonical: '/extension-download',
  },
};

export default function ExtensionDownloadPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.16),transparent_24%),linear-gradient(180deg,#fffdfa_0%,#f8fafc_45%,#e2e8f0_100%)] px-6 py-16 text-slate-900">
      <div className="mx-auto max-w-4xl">
        <div className="rounded-[2rem] border border-slate-200 bg-white/90 p-8 shadow-[0_28px_80px_rgba(15,23,42,0.14)] backdrop-blur-sm sm:p-10">
          <p className="text-[11px] font-black uppercase tracking-[0.32em] text-amber-700">DesignIt Extension</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">Download complete. Install it in your browser.</h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600 sm:text-lg">
            This extension adds an <span className="font-black text-slate-900">Open in DesignIt</span> option when you right-click images on the web. Clicking it opens Studio and loads that image into Source automatically.
          </p>

          <div className="mt-6 rounded-[1.5rem] border border-sky-200 bg-sky-50/80 p-5 text-left text-sm leading-6 text-sky-950">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-700">How To Use It</p>
            <p className="mt-2">
              Use the <span className="font-black">browser extension icon</span> when a site blocks normal image right-clicking. The icon starts <span className="font-black">Capture Area</span> mode so you can drag an orange dashed box around the visible product.
            </p>
            <p className="mt-2">
              Use <span className="font-black">right-click on an image</span> only when the site exposes a real image element. That path opens the simpler <span className="font-black">Pick Image</span> flow.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="/designit-studio-extension.zip"
              download
              className="rounded-full border border-sky-400 bg-sky-600 px-6 py-3 text-sm font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-sky-500"
            >
              Download Zip Again
            </a>
            <Link
              href="/studio"
              className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-black uppercase tracking-[0.18em] text-slate-800 transition-colors hover:bg-slate-50"
            >
              Back to Studio
            </Link>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            <section className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-sky-700">Step 1</p>
              <h2 className="mt-2 text-lg font-black text-slate-900">Extract the zip</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Unzip <span className="font-black text-slate-800">designit-studio-extension.zip</span> to a normal folder on your computer.
              </p>
            </section>
            <section className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-sky-700">Step 2</p>
              <h2 className="mt-2 text-lg font-black text-slate-900">Load unpacked</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Open <span className="font-black text-slate-800">chrome://extensions</span> or <span className="font-black text-slate-800">edge://extensions</span>, enable Developer mode, then click <span className="font-black text-slate-800">Load unpacked</span>.
              </p>
            </section>
            <section className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-sky-700">Step 3</p>
              <h2 className="mt-2 text-lg font-black text-slate-900">Choose the right launch</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Click the <span className="font-black text-slate-800">extension icon</span> for blocked pages and drag a capture box. Use <span className="font-black text-slate-800">Open in DesignIt</span> from right-click only when the page allows direct image targeting.
              </p>
            </section>
          </div>

          <div className="mt-10 rounded-[1.5rem] border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
            Select the extracted folder that contains <span className="font-black">manifest.json</span> and <span className="font-black">background.js</span> when the browser asks which extension folder to load.
          </div>
        </div>
      </div>
    </main>
  );
}
