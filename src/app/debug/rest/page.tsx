'use client';

import { useEffect, useState } from 'react';

type Row = { id: string; sku: string | null };

export default function RestDebug() {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '(missing)';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '(missing)';

  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [rows, setRows] = useState<Row[]>([]);
  const [errorText, setErrorText] = useState<string>('');
  const [httpInfo, setHttpInfo] =
    useState<{ ok: boolean; status: number; statusText: string } | null>(null);

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

      const url = `${supaUrl}/rest/v1/items?select=id,sku&limit=5`;

      const res = await fetch(url, {
        headers: {
          apikey: anon,
          Authorization: `Bearer ${anon}`,
        },
      });

      setHttpInfo({
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
      });

      const textBody = await res.text();
      let body: any = null;
      try {
        body = JSON.parse(textBody);
      } catch {
        body = textBody;
      }

      if (!res.ok) {
        setErrorText(
          typeof body === 'string'
            ? body
            : body?.message || `HTTP ${res.status} ${res.statusText}`
        );
      } else {
        setRows(Array.isArray(body) ? (body as Row[]) : []);
      }
    } catch (e: any) {
      setErrorText(`Fetch threw: ${e?.message || String(e)}`);
    } finally {
      setStatus('done');
    }
  };

  return (
    <div className="card">
      <h1 className="text-xl font-semibold mb-3">Supabase REST Debug</h1>

      <p><b>NEXT_PUBLIC_SUPABASE_URL:</b> {supaUrl}</p>
      <p>
        <b>NEXT_PUBLIC_SUPABASE_ANON_KEY (first 12):</b>{' '}
        {anon === '(missing)' ? '(missing)' : anon.slice(0, 12) + '…'}
      </p>

      <button className="btn mt-3" onClick={testRest}>
        Test REST /items
      </button>

      {status !== 'idle' && (
        <div className="mt-4 text-sm p-3 border rounded">
          {httpInfo && (
            <p>
              <b>HTTP:</b> {httpInfo.status} {httpInfo.statusText} (ok:{' '}
              {String(httpInfo.ok)})
            </p>
          )}
          {errorText && <p className="text-red-600">Error: {errorText}</p>}

          {!errorText && rows.length > 0 && (
            <>
              <p>
                Rows returned: <b>{rows.length}</b>
              </p>
              <ul className="list-disc ml-5">
                {rows.map((r) => (
                  <li key={r.id}>
                    {r.id} — {r.sku}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
