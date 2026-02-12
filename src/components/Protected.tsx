'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function Protected({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    const check = async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;

      if (!data.user) {
        // Not logged in → go to /login
        window.location.replace('/login');
      } else {
        setReady(true);
      }
    };

    check();

    // Re-check on focus/visibility (stops back-button leaks after logout)
    const onShow = () => check();
    window.addEventListener('focus', onShow);
    document.addEventListener('visibilitychange', onShow);

    return () => {
      active = false;
      window.removeEventListener('focus', onShow);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, []);

  // Block rendering until we confirm the session
  if (!ready) return null;
  return <>{children}</>;
}
