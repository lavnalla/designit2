import type { Metadata } from 'next';
import { Suspense } from 'react';
import MyDesignsClient from './MyDesignsClient';

export const metadata: Metadata = {
  title: 'My Designs | DesignIt',
  description: 'The designs you have submitted to DesignIt and where each one is in review.',
  robots: { index: false },
};

export default function MyDesignsPage() {
  return (
    <Suspense>
      <MyDesignsClient />
    </Suspense>
  );
}
