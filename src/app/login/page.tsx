'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      // Log for diagnostics (open browser console on /login in Vercel)
      console.log('signIn result:', { data, error });

      if (error) {
        setMsg(error.message || 'Login failed');
        setLoading(false);
        return;
      }

      // Double‑check we have a session
      const { data: sessionData } = await supabase.auth.getSession();
      console.log('getSession after login:', sessionData);

      // Go to dashboard
      router.push('/dashboard');
    } catch (err: any) {
      console.error(err);
      setMsg(err?.message || 'Unexpected error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="bg-white shadow-lg rounded-xl p-10 max-w-md w-full text-center">
        {/* LOGO */}
        <img
          src={process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '/logo.png'}
          alt="Logo"
          className="mx-auto mb-6 h-24 w-24 object-contain"
        />

        {/* SHOP NAME */}
        <h1 className="text-3xl font-bold text-orange-600 mb-2">
          {process.env.NEXT_PUBLIC_BRAND_NAME || 'Vinayak Hardware'}
        </h1>

        {/* WELCOME */}
        <p className="text-gray-600 mb-4 text-lg">Welcome to Vinayak Hardware</p>

        {/* Error message (if any) */}
        {msg && <p className="mb-3 text-red-600 text-sm">{msg}</p>}

        <form onSubmit={signIn} className="space-y-4 text-left">
          <div>
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              className="input mt-1"
              placeholder="you@example.com"
              value={email}
              onChange={(e)=>setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="text-sm font-medium">Password</label>
            <input
              type="password"
              className="input mt-1"
              placeholder="••••••••"
              value={password}
              onChange={(e)=>setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="w-full bg-orange-600 text-white py-2 rounded-lg font-semibold hover:bg-orange-700 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
