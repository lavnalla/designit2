"use client";

import { useRouter } from 'next/navigation';
import { Studio } from './Studio';

export default function StudioPageClient() {
  const router = useRouter();

  return <Studio onBack={() => router.push('/')} />;
}