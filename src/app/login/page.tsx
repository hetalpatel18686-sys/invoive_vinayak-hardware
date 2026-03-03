
'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const signIn = async (e: any) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      alert(error.message);
    } else {
      window.location.href = '/customers'; // after login
    }

    setLoading(false);
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

        {/* WELCOME MESSAGE */}
        <p className="text-gray-600 mb-8 text-lg">Welcome to Vinayak Hardware</p>

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
            className="w-full bg-orange-600 text-white py-2 rounded-lg font-semibold hover:bg-orange-700"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

        </form>
      </div>
    </div>
  );
}
