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

      if (error) {
        setMsg(error.message || 'Login failed');
        setLoading(false);
        return;
      }

      router.push('/dashboard');
    } catch (err: any) {
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
          className="mx-auto mb-4 h-24 w-24 object-contain"
        />

        {/* --- SANSKRIT SHLOKA (added here) --- */}
        <div className="text-gray-800 text-lg leading-relaxed font-[Noto Sans Devanagari] mb-4">
          वक्रतुण्ड महाकाय सूर्यकोटि समप्रभ । <br />
          निर्विघ्नं कुरु मे देव सर्वकार्येषु सर्वदा ॥
        </div>

        {/* SHOP NAME */}
        <h1 className="text-3xl font-bold text-orange-600 mb-2">
          {process.env.NEXT_PUBLIC_BRAND_NAME || 'Vinayak Hardware'}
        </h1>

        {/* REMOVED: “Welcome to Vinayak Hardware” */}
        {/* (line completely removed as per your request) */}

        {/* Error message */}
        {msg && <p className="mb-3 text-red-600 text-sm">{msg}</p>}

        {/* FORM */}
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
