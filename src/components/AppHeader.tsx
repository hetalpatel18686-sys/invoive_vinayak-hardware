'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Role = 'admin' | 'user';

const SHOW_ONLY_CURRENT = true;                // 🔒 Show only the current page link
const HIDE_ON_PATHS = ['/dashboard', '/login']; // 🙈 Hide header completely on these routes

export default function AppHeader() {
  const pathname = usePathname();

  // Hide header on chosen routes
  if (HIDE_ON_PATHS.some(p => pathname.startsWith(p))) {
    return null;
  }

  const [email, setEmail] = useState<string>('');
  const [role, setRole] = useState<Role>('user');

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      setEmail(session.user.email ?? '');

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

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  // Define all possible nav items
  const NAV = useMemo(() => ([
    { key: 'dashboard', label: 'Dashboard', href: '/dashboard' },
    { key: 'invoice',   label: 'Invoice',   href: '/invoice'   },
    { key: 'customers', label: 'Customers', href: '/customers' },
    { key: 'items',     label: 'Items',     href: '/items'     },
    { key: 'stock',     label: 'Stock',     href: '/stock'     },
    { key: 'inventory', label: 'Inventory', href: '/inventory' },
    { key: 'reports',   label: 'Reports',   href: '/reports'   },
  ]), []);

  // Compute which links are allowed for the current role
  const allowedSet = useMemo(() => {
    if (role === 'admin') {
      return new Set(NAV.map(n => n.key));
    }
    // user role → only Invoice (you can add 'dashboard' if you want it visible)
    return new Set(['invoice']);
  }, [role, NAV]);

  // Filter by allowed + (optionally) show only current
  let visibleNav = NAV.filter(n => allowedSet.has(n.key));

  if (SHOW_ONLY_CURRENT) {
    const current = visibleNav.find(n => pathname.startsWith(n.href));
    visibleNav = current ? [current] : visibleNav.slice(0, 1); // fallback to first allowed
  }

  return (
    <header className="w-full bg-orange-600 text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2">
        {/* Brand */}
        /dashboard
          <span className="flex items-center gap-2">
            <img
              src={process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '/logo.png'}
              alt="logo"
              className="h-7 w-7 rounded object-contain bg-white/90 p-[2px]"
            />
            <span className="font-semibold">
              {process.env.NEXT_PUBLIC_BRAND_NAME || 'Vinayak Hardware'}
            </span>
          </span>
        </Link>

        {/* Center nav (only current page link now) */}
        <nav className="flex items-center gap-2 text-sm">
          {visibleNav.map(n => {
            const active = pathname.startsWith(n.href);
            return (
              /{n.href}{n.label}</Link>
            );
          })}
        </nav>

        {/* Right: user + logout */}
        <div className="flex items-center gap-3">
          {email && (
            <span className="hidden text-white/90 md:inline-block text-sm">
              {email}
            </span>
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
