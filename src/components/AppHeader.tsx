'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Role = 'admin' | 'user';

// 🔒 Show only the current page name in the header nav
const SHOW_ONLY_CURRENT = true;
// 🙈 Hide header completely on these routes
const HIDE_ON_PATHS = ['/dashboard', '/login'];

// All possible nav items (we will filter by role & current route)
const NAV = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard' },
  { key: 'invoice',   label: 'Invoice',   href: '/invoice'   },
  { key: 'customers', label: 'Customers', href: '/customers' },
  { key: 'items',     label: 'Items',     href: '/items'     },
  { key: 'stock',     label: 'Stock',     href: '/stock'     },
  { key: 'inventory', label: 'Inventory', href: '/inventory' },
  { key: 'reports',   label: 'Reports',   href: '/reports'   },
] as const;

export default function AppHeader() {
  const pathname = usePathname();

  // Hide the header completely on selected paths (dashboard/login)
  if (HIDE_ON_PATHS.some((p) => pathname.startsWith(p))) {
    return null;
  }

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('user');

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      setEmail(session.user.email ?? '');

      // role from metadata first; fallback to profiles table
      let r = (session.user.user_metadata as any)?.role as Role | undefined;
      if (!r) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .single();
        r = (profile?.role as Role) ?? 'user';
      }
      setRole(r);
    })();
  }, []);

  // Allowed links by role
  const allowedSet = useMemo(() => {
    if (role === 'admin') {
      return new Set(NAV.map((n) => n.key));
    }
    // user → only Invoice (add 'dashboard' here if you want it visible too)
    return new Set(['invoice']);
  }, [role]);

  // Filter the nav by allowed links
  let visibleNav = NAV.filter((n) => allowedSet.has(n.key));

  // Show only the current page in the header (as requested)
  if (SHOW_ONLY_CURRENT) {
    const current = visibleNav.find((n) => pathname.startsWith(n.href));
    visibleNav = current ? [current] : visibleNav.slice(0, 1);
  }

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <header className="w-full bg-orange-600 text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2">
        {/* Brand: link to Dashboard */}
        <Link href="/dashboard" className="flex items-center gap-2">
          <img
            src={process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '/logo.png'}
            alt="logo"
            className="h-7 w-7 rounded object-contain bg-white/90 p-[2px]"
          />
          <span className="font-semibold">
            {process.env.NEXT_PUBLIC_BRAND_NAME || 'Vinayak Hardware'}
          </span>
        </Link>

        {/* Center nav (only the current page name now) */}
        <nav className="flex items-center gap-2 text-sm">
          {visibleNav.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link
                key={n.key}
                href={n.href}
                className={`rounded px-3 py-1.5 ${
                  active ? 'bg-white text-orange-700 font-semibold' : 'hover:bg-white/10'
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        {/* Right side: user email + logout */}
        <div className="flex items-center gap-3">
          {email && (
            <span className="hidden text-sm text-white/90 md:inline-block">{email}</span>
          )}
          <button
            onClick={logout}
            className="rounded bg-white px-3 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-50"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
