// src/app/estimate/new/page.tsx
import { Suspense } from 'react';
import EstimateClient from './EstimateClient';

export const dynamic = 'force-dynamic'; // fixes static export / CSR bailout issues

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Loading estimate…</div>}>
      <EstimateClient />
    </Suspense>
  );
}
