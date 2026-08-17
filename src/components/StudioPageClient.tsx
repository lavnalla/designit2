"use client";

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Studio } from './Studio';

export default function StudioPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const source = searchParams.get('source');
    if (!source || typeof window === 'undefined') {
      return;
    }

    const isImageSource = /^https?:\/\//i.test(source)
      || source.startsWith('data:image/')
      || source.startsWith('/')
      || source.startsWith('./')
      || source.startsWith('../');

    if (!isImageSource) {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete('source');
      const nextQuery = nextParams.toString();
      router.replace(nextQuery ? `/studio?${nextQuery}` : '/studio');
      return;
    }

    const normalizedSource = /^https?:\/\//i.test(source)
      ? `/api/source-image?url=${encodeURIComponent(source)}`
      : source;

    try {
      window.sessionStorage.setItem('designit-studio-source-image', normalizedSource);
    } catch {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('source');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `/studio?${nextQuery}` : '/studio');
  }, [router, searchParams]);

  return <Studio onBack={() => router.push('/')} />;
}