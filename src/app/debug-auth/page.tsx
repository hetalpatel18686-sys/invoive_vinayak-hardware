'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function DebugAuthPage() {
  const [session, setSession] = useState<any>(null);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      setSession(sessionData?.session ?? null);

      const { data: userData } = await supabase.auth.getUser();
      setUser(userData?.user ?? null);
    })();
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h1>Debug Auth</h1>
      <pre style={{ whiteSpace: 'pre-wrap', background: '#f7f7f7', padding: 12 }}>
        {JSON.stringify({ session, user }, null, 2)}
      </pre>
      <p>Tip: Open DevTools console for extra logs from the login page.</p>
    </div>
  );
}
