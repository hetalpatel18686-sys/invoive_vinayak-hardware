'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Role = 'admin' | 'user';

export default function DashboardPage() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // 1) Must be logged in
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = '/login';
        return;
      }

      setEmail(session.user.email ?? '');

      // 2) Role from user_metadata first, then from profiles
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
      setLoading(false);
    })();
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const tilesAll = [
    { key: 'invoice',   href: '/invoice',   label: 'Invoice',   icon: '₹'  },
    { key: 'customers', href: '/customers', label: 'Customers', icon: '👥' },
    { key: 'items',     href: '/items',     label: 'Items',     icon: '🧰' },
    { key: 'stock',     href: '/stock',     label: 'Stock',     icon: '📦' },
    { key: 'inventory', href: '/inventory', label: 'Inventory', icon: '🏷️' },
    { key: 'reports',   href: '/reports',   label: 'Reports',   icon: '📊' },
  ];

  const allowed = role === 'admin'
    ? new Set(tilesAll.map(t => t.key))
    : new Set(['invoice']); // user only sees Invoice

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(1200px 600px at 10% 0%, #fff, #f8f8fa 40%, #eef0f6 100%), #f5f6f8',
      display: 'grid',
      placeItems: 'center',
      padding: 16
    }}>
      <div style={{
        width: 'min(920px, 96vw)',
        background: '#fff',
        borderRadius: 16,
        boxShadow: '0 12px 40px rgba(0,0,0,0.06)',
        padding: '28px 24px 22px',
        position: 'relative'
      }}>
        <div style={{ position: 'absolute', top: 16, right: 16 }}>
          <button onClick={logout}
            style={{
              background: '#e96510', color: '#fff', border: 'none',
              padding: '10px 14px', borderRadius: 10, fontWeight: 600,
              boxShadow: '0 6px 14px rgba(233,101,16,0.35)', cursor: 'pointer'
            }}>
            Logout
          </button>
        </div>

        {/* Hero */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          textAlign: 'center', gap: 12, marginTop: 18, marginBottom: 8
        }}>
          <div style={{
            width: 160, height: 160, borderRadius: 22, background: '#fff',
            display: 'grid', placeItems: 'center',
            boxShadow: '0 8px 30px rgba(233,101,16,0.20)',
            position: 'relative', overflow: 'hidden'
          }}>
            {/* soft glow */}
            <div style={{
              position: 'absolute', inset: '-20%',
              background: 'radial-gradient(circle at 50% 50%, rgba(233,101,16,0.28), transparent 60%)',
              animation: 'pulse 4s ease-in-out infinite'
            }} />
            {/* logo from env */}
            <img
              src={process.env.NEXT_PUBLIC_BRAND_LOGO_URL
                || 'https://aomflbebzxvidrjfckov.supabase.co/storage/v1/object/public/logos/Designer.png'}
              alt="Vinayak Hardware"
              style={{ width: '78%', height: '78%', objectFit: 'contain', borderRadius: 12, zIndex: 1 }}
            />
          </div>

          <style jsx global>{`
            @keyframes pulse {
              0%, 100% { transform: scale(1); opacity: .8; }
              50% { transform: scale(1.06); opacity: 1; }
            }
          `}</style>

          <h1 style={{ margin: '6px 0 0', fontSize: 42, color: '#e96510', letterSpacing: .2 }}>
            Vinayak Hardware
          </h1>
          <div style={{ marginTop: 6, color: '#6b7280', fontSize: 18 }}>
            Welcome to Vinayak Hardware
          </div>

          {/* Sanskrit */}
          <div style={{
            marginTop: 8,
            fontFamily: '"Noto Sans Devanagari", Poppins, sans-serif',
            fontSize: 18, lineHeight: 1.6, color: '#333'
          }}>
            वक्रतुण्ड महाकाय सूर्यकोटि समप्रभ ।<br/>
            निर्विघ्नं कुरु मे देव सर्वकार्येषु सर्वदा ॥
          </div>

          <div style={{ marginTop: 6, color: '#6b7280', fontSize: 14 }}>
            {loading ? 'Checking session…' : <>Signed in as <strong>{email}</strong> • Role: <strong>{role}</strong></>}
          </div>
        </div>

        {/* Tiles */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, minmax(0,1fr))',
          gap: 14, marginTop: 26
        }}>
          {tilesAll.map(t => {
            const isAllowed = allowed.has(t.key);
            return (
              <a key={t.key} href={isAllowed ? t.href : '#'}
                 style={{
                   background: 'linear-gradient(180deg, #fff, #fafafa)',
                   border: '1px solid #ececec', borderRadius: 14,
                   padding: 18, textAlign: 'center', textDecoration: 'none',
                   color: 'inherit', pointerEvents: isAllowed ? 'auto' : 'none',
                   opacity: isAllowed ? 1 : .45, position: 'relative'
                 }}>
                <div style={{
                  width: 32, height: 32, margin: '0 auto 6px', borderRadius: 6,
                  background: '#e96510', color: '#fff', display: 'grid', placeItems: 'center',
                  fontSize: 16, fontWeight: 700, boxShadow: '0 6px 14px rgba(233,101,16,0.35)'
                }}>{t.icon}</div>
                <h3 style={{ margin: '6px 0 0', fontSize: 16, fontWeight: 600 }}>{t.label}</h3>
                {!isAllowed && (
                  <span style={{
                    position: 'absolute', top: 8, right: 8,
                    fontSize: 10, color: '#fff', background: '#9ca3af',
                    padding: '2px 6px', borderRadius: 999
                  }}>Locked</span>
                )}
              </a>
            );
          })}
        </div>

        <div style={{ marginTop: 18, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
          Created by <strong>Nimesh Patel</strong>, please contact 8511246143.
        </div>
      </div>
    </div>
  );
}
