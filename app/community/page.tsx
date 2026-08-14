import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import Image from 'next/image';
import { getApprovedSubmissions } from '../../src/lib/storage';

export const metadata: Metadata = {
  title: 'DesignIt Community Gallery',
  description:
    'Browse approved community creations shared with DesignIt, including fashion, jewelry and design mockups.',
  alternates: {
    canonical: '/community',
  },
};

interface Design {
  id: string;
  name: string;
  author: string;
  imageData: string;
}

export default async function CommunityPage() {
  // Fetch directly from DB instead of API to avoid localhost issues
  const designs = await getApprovedSubmissions();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-gradient-to-r from-yellow-600 via-yellow-500 to-yellow-600 border-b-4 border-[#B87333] sticky top-0 z-10 w-full px-6 py-4 flex items-center justify-between shadow-md">
        <Link 
          href="/" 
          className="flex items-center gap-2 text-white hover:text-yellow-100 transition-colors"
        >
          <ArrowLeft size={20} className="drop-shadow-sm" />
          <span className="font-semibold text-sm drop-shadow-sm">Back to Studio</span>
        </Link>
        <h1 className="text-2xl font-black tracking-tight text-white drop-shadow-md">
          COMMUNITY <span className="text-[#e2e8f0]">GALLERY</span>
        </h1>
        <div className="w-24" /> {/* Spacer */}
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        {designs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <p className="text-xl mb-4 font-bold">No designs approved yet.</p>
            <p className="text-sm">Check back later or submit your own!</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {designs.map((design: any) => (
              <div 
                key={design.id}
                className="group relative bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden hover:shadow-md hover:border-yellow-400 transition-all duration-300"
              >
                <div className="aspect-square w-full relative bg-white overflow-hidden p-2">
                  <Image 
                    src={design.imageData} 
                    alt={design.name}
                    fill
                    className="object-contain group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                
                <div className="p-2 border-t border-slate-100 bg-slate-50">
                  <h3 className="text-xs font-bold text-slate-800 truncate uppercase tracking-wide">
                    {design.name}
                  </h3>
                  <p className="text-[10px] text-slate-500 truncate mt-0.5">
                    by <span className="font-bold text-yellow-600">{design.author}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
