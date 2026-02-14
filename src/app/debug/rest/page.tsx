'use client';

import { useEffect, useState } from 'react';

type Row = { id: string; sku: string | null };

export default function RestDebug() {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '(missing)';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '(missing)';

  const [status, setStatus] = useState<'idle'|'loading'|'done'>('idle');
  const [rows, setRows] = useState<Row[]>([]);
  const [errorText, setErrorText] = useState<string>('');
  const [httpInfo, setHttpInfo] = useState<{ok:boolean; status:number; statusText:string} | null>(null);

  const testRest = async () => {
    setStatus('loading');
    setErrorText('');
    setRows([]);
    setHttpInfo(null);

    try {
      if (!supaUrl.startsWith('https://') || !supaUrl.includes('.supabase.co')) {
        setErrorText(`Runtime URL looks wrong: "${supaUrl}"`);
        setStatus('done');
        return;
      }
      if (anon === '(missing)') {
        setErrorText('Runtime anon key is missing.');
        setStatus('done');
        return;
      }

      const url = `${supaUrl}/rest/v1/items?select=id,sku&limit=5`;
      const res = await fetch(url, {
        headers: {
          apikey: anon,
          Authorization: `Bearer ${anon}`,
        },
      });

      setHttpInfo({ ok: res.ok, status: res.status, statusText: res.statusText });

      // Supabase REST returns JSON both on success and failure (with an error JSON)
      const bodyText = await res.text();
      let body: any = null;
      try { body = JSON.parse(bodyText); } catch { /* leave as text */ }

      if (!res.ok) {
        setErrorText(typeof body === 'string'
          ? `HTTP ${res.status} ${res.statusText} — ${body}`
          : `HTTP ${res.status} ${res.statusText} — ${body?.message || bodyText}`);
      } else {
        setRows(Array.isArray(body) ? body as Row[] : []);
      }
    } catch (e: any) {
      setErrorText(`Fetch threw: ${e?.message || String(e)}`);
    } finally {
      setStatus('done');
    }
  };

  useEffect(() => { /* don’t auto-run; press the button */ }, []);

  const keyPreview = anon === '(missing)' ? '(missing)' : anon.slice(0, 12) + '…';

  return (
    <div className="card">
      <h1 className="text-xl font-semibold mb-3">Supabase REST Debug</h1>

      <div className="space-y-2 text-sm">
        <div><b>NEXT_PUBLIC_SUPABASE_URL</b>: <code>{supaUrl}</code></div>
        <div><b>NEXT_PUBLIC_SUPABASE_ANON_KEY</b> (first 12): <code>{keyPreview}</code></div>
        <button className="btn mt-2" onClick={testRest}>Test REST /items</button>

        {status !== 'idle' && (
          <div className="mt-3 p-2 rounded border text-sm">
            <div>Status: <b>{status}</b></div>
            {httpInfo && (
              <div>HTTP: <b>{httpInfo.status}</b> {httpInfo.statusText} (ok: {String(httpInfo.ok)})</div>
            )}
            {errorText && <div className="text-red-600 mt-2">Error: {errorText}</div>}
            {!errorText && rows.length > 0 && (
              <div className="mt-2">
                <div>Rows returned: <b>{rows.length}</b></div>
                <ul className="list-disc ml-5">
                  {rows.map(r => <li key={r.id}><code>{r.id}</code> — {r.sku}</li>)}
                </ul>
              </div>
            )}
            {!errorText && rows.length === 0 && status === 'done' && (
              <div className="mt-2">No rows (table empty or policies blocking).</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
