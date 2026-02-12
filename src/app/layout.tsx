
import './globals.css'
import NavBar from '@/components/NavBar'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Invoicer',
  description: 'Invoices, items, stock and reports',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-graybg min-h-screen">
        <NavBar />
        <main className="mx-auto max-w-6xl p-4">{children}</main>
      </body>
    </html>
  )
}
