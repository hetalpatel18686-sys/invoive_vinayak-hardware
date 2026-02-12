
'use client';
import { useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function Home() {
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        window.location.href = '/customers'; // landing page *after* login
      } else {
        window.location.href = '/login';     // force login first
      }
    });
  }, []);
  return null;
}
