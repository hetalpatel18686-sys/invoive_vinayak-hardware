
'use client';
import { useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function Home() {
  useEffect(() => {
    // If already signed in, send to your default landing page (e.g., /customers)
    // If not signed in, send to /login
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        window.location.href = '/customers'; // change to /items or /reports if you prefer
      } else {
        window.location.href = '/login';
      }
    });
  }, []);

  return null; // nothing visible on /
}
