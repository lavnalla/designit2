import type { Metadata } from 'next';
import StudioPageClient from '../../src/components/StudioPageClient';

export const metadata: Metadata = {
  title: 'Studio',
  description: 'Open the interactive DesignIt studio for browser-based clothing, jewelry, and vector design workflows.',
  alternates: {
    canonical: '/studio',
  },
};

export default function StudioPage() {
  return <StudioPageClient />;
}