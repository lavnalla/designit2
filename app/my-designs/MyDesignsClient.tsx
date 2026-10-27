'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { SUBMITTER_EMAIL_KEY } from '../../src/components/SubmissionModal';

interface Design {
  id: string;
  name: string;
  author: string;
  imageData: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

const STATUS_LABEL: Record<Design['status'], string> = {
  pending: 'In review',
  approved: 'Approved: in the community gallery',
  rejected: 'Not approved',
};

const STATUS_STYLE: Record<Design['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

// Everything the user has submitted with their email, and where each design is in review
export default function MyDesignsClient() {
  const searchParams = useSearchParams();
  const [emailInput, setEmailInput] = useState('');
  const [designs, setDesigns] = useState<Design[] | null>(null);
  // The email the shown designs were loaded with (their links open them in the Studio with it)
  const [loadedEmail, setLoadedEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (email: string) => {
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/submissions?email=${encodeURIComponent(email.trim())}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load your designs.');
      setDesigns(data);
      setLoadedEmail(email.trim());
      try {
        localStorage.setItem(SUBMITTER_EMAIL_KEY, email.trim());
      } catch {
        // (Not remembered: fine)
      }
    } catch (err) {
      setDesigns(null);
      setError(err instanceof Error ? err.message : 'Could not load your designs.');
    } finally {
      setLoading(false);
    }
  }, []);

  // The email from the link (after submitting), else the one remembered on this device
  useEffect(() => {
    let email = searchParams.get('email') ?? '';
    if (!email) {
      try {
        email = localStorage.getItem(SUBMITTER_EMAIL_KEY) ?? '';
      } catch {
        email = '';
      }
    }
    if (email) {
      setEmailInput(email);
      load(email);
    }
  }, [searchParams, load]);

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-800">My Designs</h1>
        <p className="text-slate-500 mt-1">
          Everything you&apos;ve submitted, and where each design is in review.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            load(emailInput);
          }}
          className="mt-6 flex flex-col sm:flex-row gap-3"
        >
          <input
            type="email"
            required
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="The email you submitted with"
            className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none bg-white"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg font-semibold disabled:opacity-50"
          >
            Show my designs
          </button>
        </form>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        {loading && (
          <div className="py-16 flex justify-center text-yellow-500">
            <Loader2 className="animate-spin w-8 h-8" />
          </div>
        )}

        {!loading && designs && designs.length === 0 && (
          <div className="py-16 text-center text-slate-400">
            <p className="font-semibold">No designs submitted with this email yet.</p>
            <Link href="/studio" className="text-sm text-yellow-700 hover:underline">
              Design something in the Studio →
            </Link>
          </div>
        )}

        {!loading && designs && designs.length > 0 && (
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {designs.map((design) => (
              <Link
                key={design.id}
                href={`/studio?design=${encodeURIComponent(design.id)}&email=${encodeURIComponent(loadedEmail)}`}
                title="Open in the Studio"
                className="block bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden hover:shadow-md hover:border-yellow-400 transition-all"
              >
                <div className="aspect-square relative bg-white p-2">
                  <Image src={design.imageData} alt={design.name} fill className="object-contain" unoptimized />
                </div>
                <div className="p-3 border-t border-slate-100 space-y-1">
                  <h3 className="text-sm font-bold text-slate-800 truncate">{design.name}</h3>
                  <p className="text-[11px] text-slate-400">
                    {new Date(design.createdAt).toLocaleDateString()}
                  </p>
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLE[design.status]}`}
                  >
                    {STATUS_LABEL[design.status]}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
