
'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';
import Protected from '@/components/Protected';

interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  street_name?: string | null;   // NEW
  village_town?: string | null;  // NEW
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}

export default function Customers() {
  const [list, setList] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state (no email; new street_name & village_town)
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

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('customers')
      .select('id, first_name, last_name, phone, street_name, village_town, city, state, postal_code')
      .order('created_at', { ascending: false });
    if (!error && data) setList(data as Customer[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...form };
    const { error } = await supabase.from('customers').insert([payload]);
    if (!error) {
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
      load();
    } else {
      alert(error.message);
    }
  };

  return (
    <Protected>
      <div className="grid md:grid-cols-3 gap-4">
        {/* LEFT: List */}
        <div className="card md:col-span-2">
          <h1 className="text-xl font-semibold mb-3">Customers</h1>
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
