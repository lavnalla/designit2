"use client";

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Studio } from './Studio';

export default function StudioPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // A design to open on the workspace (from the community gallery or My Designs): passed on to the Studio,
  // and taken off the address
  useEffect(() => {
    const design = searchParams.get('design');
    if (!design || typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(
        'designit-studio-design',
        JSON.stringify({ id: design, email: searchParams.get('email') ?? undefined }),
      );
    } catch {
      return;
    }
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('design');
    nextParams.delete('email');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `/studio?${nextQuery}` : '/studio');
  }, [router, searchParams]);

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

  return <Studio onBack={() => router.push('/')} designToOpen={searchParams.get('design')} />;
}