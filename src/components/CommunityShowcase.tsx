"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart, Loader2 } from 'lucide-react';
import Image from 'next/image';

interface Design {
  id: string;
  name: string;
  author: string;
  imageData: string;
}

export function CommunityShowcase() {
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/submissions')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setDesigns(data.slice(0, 6)); // Show top 6
        }
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="w-full py-20 flex justify-center text-yellow-500">
      <Loader2 className="animate-spin w-8 h-8" />
    </div>
  );

  if (designs.length === 0) return null;

  return (
    <section className="w-full border-t border-slate-200 bg-white px-4 py-4 sm:px-6">
      <div className="max-w-[1000px] mx-auto text-center">
        <div className="flex flex-col items-center mb-4">
          <h2 className="text-lg font-bold mb-0.5 text-slate-800">Community Creations</h2>
          <Link href="/community" className="text-yellow-600 text-[10px] font-bold hover:underline">
            View All →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-6">
          {designs.map((design) => (
            <div key={design.id} className="group relative bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 border border-slate-200">
              <div className="aspect-square relative overflow-hidden bg-white">
                <Image 
                  src={design.imageData} 
                  alt={design.name}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              <div className="p-2 text-left">
                <h3 className="font-bold text-xs mb-0.5 text-slate-800 truncate">{design.name}</h3>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[10px] truncate">by {design.author}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
