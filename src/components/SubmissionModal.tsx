"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, Loader2 } from 'lucide-react';

interface SubmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  getDesignImage: () => Promise<string | null>;
}

// The submitter's email, remembered on this device so it's filled in next time (and "My designs" knows it)
export const SUBMITTER_EMAIL_KEY = 'designit-submitter-email';
// Designs are sent at most this many pixels on their longer side
const MAX_SIDE = 1200;

// The design image, shrunk to fit MAX_SIDE if it's bigger (smaller uploads, quicker galleries)
async function shrink(dataUrl: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not read the design image'));
    el.src = dataUrl;
  });
  const fit = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  if (fit >= 1) return dataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * fit);
  canvas.height = Math.round(img.naturalHeight * fit);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export function SubmissionModal({ isOpen, onClose, getDesignImage }: SubmissionModalProps) {
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    try {
      const saved = localStorage.getItem(SUBMITTER_EMAIL_KEY);
      if (saved) setEmail((current) => current || saved);
    } catch {
      // (Storage unavailable: the user types it)
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const close = () => {
    onClose();
    setSuccess(false);
    setError(null);
    setName('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const designImage = await getDesignImage();
      if (!designImage) {
        throw new Error('There is nothing on the workspace to submit yet.');
      }
      const imageData = await shrink(designImage);

      const response = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, author, email, imageData }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || 'Submission failed. Please try again.');
      }

      try {
        localStorage.setItem(SUBMITTER_EMAIL_KEY, email.trim());
      } catch {
        // (Not remembered: fine)
      }
      setSuccess(true);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to submit design. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-2xl p-6 relative">
        <button
          onClick={close}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
          aria-label="Close"
        >
          <X size={24} />
        </button>

        <h2 className="text-2xl font-bold text-slate-800 mb-2">Submit Design</h2>
        <p className="text-slate-500 mb-6">
          Send your design for review. Once approved it&apos;s shown in the community gallery.
        </p>

        {success ? (
          <div className="bg-green-50 text-green-700 p-4 rounded-lg text-center space-y-2">
            <p className="font-semibold">Successfully submitted!</p>
            <p className="text-sm">Your design is pending approval.</p>
            <Link
              href={`/my-designs?email=${encodeURIComponent(email.trim())}`}
              className="inline-block text-sm font-semibold text-yellow-700 hover:underline"
            >
              See all my designs →
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Design Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                placeholder="e.g. Summer Floral Dress"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Your Name
              </label>
              <input
                type="text"
                required
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                placeholder="e.g. Jane Doe"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Your Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                placeholder="you@example.com"
              />
              <p className="mt-1 text-xs text-slate-400">
                Your designs are saved under this email: see them any time in My Designs. It&apos;s not shown publicly.
              </p>
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg font-semibold shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="animate-spin" size={20} />}
              {loading ? 'Submitting...' : 'Submit Design'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
