'use client';

import { useRef, useState, useTransition } from 'react';
import { newIngestKey, previewImport, runImport, type ImportPreview } from '@/app/actions';
import { reportRun } from './Operator';

const FIELDS: [string, string][] = [['accessCode', 'Access code'], ['studentName', 'Student name'], ['firstName', 'First name'], ['lastName', 'Last name'], ['orderRef', 'Order number'], ['status', 'Order status'], ['package', 'Product or package'], ['amount', 'Amount'], ['parentEmail', 'Parent email']];

/** Upload a storefront order export, confirm which column is which, see what will change, then import. */
export function ImportOrders({ galleryId, label }: { galleryId: string; label: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [csv, setCsv] = useState('');
  const [file, setFile] = useState('');
  const [pv, setPv] = useState<Extract<ImportPreview, { ok: true }> | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [addMissing, setAddMissing] = useState(false);
  const [amountIs, setAmountIs] = useState<'order' | 'line'>('order');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const preview = (text: string, m: Record<string, string> | null, add: boolean, amt: 'order' | 'line') => start(async () => {
    const r = await previewImport(galleryId, text, m, add, amt);
    if (!r.ok) { setError(r.error); setPv(null); return; }
    setError(''); setPv(r); setMapping(r.mapping as Record<string, string>);
  });
  const reset = () => { setCsv(''); setFile(''); setPv(null); setMapping({}); setError(''); setAddMissing(false); setAmountIs('order'); };
  const canMatch = !!(mapping.accessCode || mapping.studentName || mapping.firstName || mapping.lastName);

  return (
    <>
      <button className="btn sm" onClick={() => { reset(); ref.current?.showModal(); }}>Import orders</button>
      <dialog ref={ref} style={{ width: 'min(620px, calc(100% - 32px))' }}>
        <div className="form">
          <h2>Import orders: {label}</h2>
          <p className="muted">Export this job&apos;s orders from your storefront as a CSV file and choose it here. Students who are not in the file are left as they are.</p>
          <label>Order export file
            <input id={`file-${galleryId}`} type="file" accept=".csv,.tsv,.txt,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 8_000_000) { setError('That file is larger than 8 MB. Export one job at a time.'); return; } const text = await f.text(); setCsv(text); setFile(f.name); preview(text, null, addMissing, amountIs); }} />
          </label>
          {pv && (
            <>
              <span className="label">Which column is which</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
                {FIELDS.map(([k, name]) => (
                  <label key={k}>{name}
                    <select value={mapping[k] ?? ''} onChange={(e) => { const m = { ...mapping, [k]: e.target.value }; if (!e.target.value) delete m[k]; setMapping(m); preview(csv, m, addMissing, amountIs); }}>
                      <option value="">Not in this file</option>
                      {pv.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={amountIs === 'line'} onChange={(e) => { const v = e.target.checked ? 'line' : 'order'; setAmountIs(v); preview(csv, mapping, addMissing, v); }} /> The file has one row per item, and the amount is the item price (add rows up per order)</label>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={addMissing} onChange={(e) => { setAddMissing(e.target.checked); preview(csv, mapping, e.target.checked, amountIs); }} /> Add students who are in the file but not on the roster</label>
              <div className="card" style={{ background: 'var(--bg)' }}>
                {canMatch ? <><b>{pv.rows} rows. {pv.students} students will be updated{pv.wouldAdd ? `, ${pv.wouldAdd} added to the roster` : ''}.</b>
                  {pv.unmatched > 0 && <p className="muted" style={{ marginTop: 4 }}>{pv.unmatched} {pv.unmatched === 1 ? 'row matches' : 'rows match'} no student and will be logged as exceptions{pv.unmatchedSample.length ? `: ${pv.unmatchedSample.slice(0, 4).join('; ')}${pv.unmatched > 4 ? '…' : ''}` : ''}</p>}</>
                  : <b>Choose the column that holds the access code or the student name.</b>}
              </div>
            </>
          )}
          {error && <p className="err">{error}</p>}
          <div className="row">
            <button className="btn primary" disabled={pending || !pv || !canMatch || pv.students === 0} onClick={() => start(async () => { const r = await runImport(galleryId, csv, mapping, addMissing, amountIs, file); if (!r.ok) { setError(r.error); return; } reportRun(`Import orders: ${label}`, r.result); ref.current?.close(); })}>{pending ? 'Working…' : 'Import'}</button>
            <button className="btn ghost" onClick={() => ref.current?.close()}>Cancel</button>
          </div>
        </div>
      </dialog>
    </>
  );
}

export function IngestKey({ hasKey }: { hasKey: boolean }) {
  const [key, setKey] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="stack" style={{ gap: 8 }}>
      {key ? <><p>Copy this key now. It is not shown again.</p><input className="inp mono" readOnly value={key} aria-label="Ingest key" onFocus={(e) => e.currentTarget.select()} /></>
        : <p className="muted">{hasKey ? 'A key exists. Creating a new one stops the old one working.' : 'No key yet.'}</p>}
      <div><button className="btn sm" disabled={pending} onClick={() => start(async () => setKey(await newIngestKey()))}>{hasKey || key ? 'Create a new key' : 'Create a key'}</button></div>
    </div>
  );
}
