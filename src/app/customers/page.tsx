'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';
import Protected from '@/components/Protected';

interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  street_name?: string | null;
  village_town?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}

export default function Customers() {
  // --- Role guard state ---
  const [checkingRole, setCheckingRole] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // --- Page data state ---
  const [list, setList] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Form state ---
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    street_name: '',
    village_town: '',
    city: '',
    state: '',
    postal_code: '',
  });

  // ===== 1) ADMIN-ONLY GUARD =====
  useEffect(() => {
    (async () => {
      // Must be signed in
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = '/login';
        return;
      }

      // Role from user_metadata first; fallback to profiles table
      let role: string | undefined = (session.user.user_metadata as any)?.role;
      if (!role) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .single();
        role = profile?.role ?? 'user';
      }

      if (role !== 'admin') {
        // Normal users go to Invoice
        window.location.href = '/invoice';
        return;
      }

      // Admin confirmed
      setIsAdmin(true);
      setCheckingRole(false);
    })();
  }, []);

  // ===== 2) LOAD DATA (only when admin) =====
  const load = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('customers')
        .select(
          'id, first_name, last_name, phone, street_name, village_town, city, state, postal_code'
        )
        .order('created_at', { ascending: false });

      if (error) throw error;
      setList((data || []) as Customer[]);
    } catch (err: any) {
      alert(err.message ?? 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // ===== 3) ADD NEW CUSTOMER =====
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { ...form };
      const { error } = await supabase.from('customers').insert([payload]);
      if (error) throw error;

      // Reset form
      setForm({
        first_name: '',
        last_name: '',
        phone: '',
        street_name: '',
        village_town: '',
        city: '',
        state: '',
        postal_code: '',
      });

      // Reload list
      load();
    } catch (err: any) {
      alert(err.message ?? 'Failed to save customer');
    }
  };

  // While checking role, show a minimal placeholder
  if (checkingRole) {
    return (
      <Protected>
        <div className="card">
          <p>Checking permission…</p>
        </div>
      </Protected>
    );
  }

  // ===== Render page for admin =====
  return (
    <Protected>
      {/* Top toolbar with Back to Dashboard */}
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Customers</h1>

        {/* ✅ Correct Link usage */}
        <Link
          href="/dashboard"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50"
        >
          ← Back to Dashboard
        </Link>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* LEFT: List */}
        <div className="card md:col-span-2">
          {loading ? (
            <p>Loading...</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Street</th>
                  <th>Village/Town</th>
                  <th>City</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td>{c.first_name} {c.last_name}</td>
                    <td>{c.phone || '-'}</td>
                    <td>{c.street_name || '-'}</td>
                    <td>{c.village_town || '-'}</td>
                    <td>{c.city || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* RIGHT: Add form */}
        <div className="card">
          <h2 className="font-semibold mb-2">Add New Customer</h2>
          <form onSubmit={add} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <input
                className="input"
                placeholder="First name"
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                required
              />
              <input
                className="input"
                placeholder="Last name"
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                required
              />
            </div>

            <input
              className="input"
              placeholder="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />

            <div className="grid grid-cols-2 gap-2">
              <input
                className="input"
                placeholder="Street name"
                value={form.street_name}
                onChange={(e) => setForm({ ...form, street_name: e.target.value })}
              />
              <input
                className="input"
                placeholder="Village/Town"
                value={form.village_town}
                onChange={(e) => setForm({ ...form, village_town: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <input
                className="input"
                placeholder="City"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
              <input
                className="input"
                placeholder="State"
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
              />
              <input
                className="input"
                placeholder="ZIP"
                value={form.postal_code}
                onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
              />
            </div>

            <Button type="submit">Save Customer</Button>
          </form>
        </div>
      </div>
    </Protected>
  );
}
