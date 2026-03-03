import type { Metadata } from 'next';
import './globals.css';

// ⬇️ Use the new header that hides on /dashboard and /login,
// and shows only the current page link on other routes.
import AppHeader from '@/components/AppHeader';

export const metadata: Metadata = {
  title: 'Invoicer',
  description: 'Invoices, items, stock and reports',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* You can keep your custom bg color class if you prefer: bg-graybg */}
      <body className="bg-gray-100 min-h-screen">
        {/* Header renders nothing on /dashboard and /login */}
        <AppHeader />

        {/* Main content container */}
        <main className="mx-auto max-w-6xl p-4">
          {children}
        </main>
      </body>
    </html>
  );
}
