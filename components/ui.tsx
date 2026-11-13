'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type ReactNode } from 'react';
import { acceptPose, addMember, createRecord, dismiss, importRoster, recordPose, removeMember, runActions, saveDraft, saveStudio, type Kind } from '@/app/actions';
import type { Action } from '@/lib/ops';
import { askOperatorFromPage, reportRun } from './Operator';

/** Runs operations on click. The click is the approval; the result is shown in the operator panel. */
export function OpButton({ actions, title, children, className = 'btn sm' }: { actions: Action[]; title: string; children: ReactNode; className?: string }) {
  const [pending, start] = useTransition();
  return <button className={className} disabled={pending} onClick={() => start(async () => reportRun(title, await runActions(actions)))}>{pending ? 'Working…' : children}</button>;
}

export function AskButton({ q, children }: { q: string; children: ReactNode }) {
  return <button className="btn sm" onClick={() => askOperatorFromPage(q)}>{children}</button>;
}

export function DismissButton({ k }: { k: string }) {
  const [pending, start] = useTransition();
  return <button className="btn sm ghost" disabled={pending} onClick={() => start(() => dismiss(k))}>Dismiss</button>;
}

export function Toggle({ on, label, action, title }: { on: boolean; label: string; action: Action; title: string }) {
  const [pending, start] = useTransition();
  return <button className="switch" role="switch" aria-checked={on} aria-label={label} disabled={pending} onClick={() => start(async () => reportRun(title, await runActions([action])))} />;
}

export function Segmented({ value, options, area }: { value: string; options: [string, string][]; area: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="seg" role="group" aria-label={`${area} autonomy`}>
      {options.map(([k, name]) => <button key={k} aria-pressed={value === k} disabled={pending} onClick={() => start(async () => reportRun(`Set ${area} to ${name}`, await runActions([{ op: 'set_autonomy', id: area, value: k }])))}>{name}</button>)}
    </div>
  );
}

export type Field = { name: string; label: string; type?: 'text' | 'number' | 'date' | 'email' | 'textarea' | 'select'; options?: [string, string][]; required?: boolean; placeholder?: string };

export function NewRecord({ kind, title, fields, button }: { kind: Kind; title: string; fields: Field[]; button?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <>
      <button className="btn" onClick={() => { setError(''); ref.current?.showModal(); }}>{button ?? title}</button>
      <dialog ref={ref}>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v)]));
          start(async () => {
            const r = await createRecord(kind, data);
            if (r.ok) { form.reset(); ref.current?.close(); } else setError(r.error);
          });
        }}>
          <h2>{title}</h2>
          {fields.map((f) => (
            <label key={f.name}>{f.label}
              {f.type === 'select' ? <select name={f.name} required={f.required}>{f.options!.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
                : f.type === 'textarea' ? <textarea name={f.name} rows={4} required={f.required} placeholder={f.placeholder} />
                : <input name={f.name} type={f.type ?? 'text'} required={f.required} placeholder={f.placeholder} step={f.type === 'number' ? 'any' : undefined} min={f.type === 'number' ? 0 : undefined} />}
            </label>
          ))}
          {error && <p className="err">{error}</p>}
          <div className="row"><button className="btn primary" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button><button type="button" className="btn ghost" onClick={() => ref.current?.close()}>Cancel</button></div>
        </form>
      </dialog>
    </>
  );
}

export function RosterImport({ schoolId }: { schoolId: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  return (
    <>
      <button className="btn sm" onClick={() => { setMsg(''); ref.current?.showModal(); }}>Import roster</button>
      <dialog ref={ref}>
        <form className="form" onSubmit={(e) => { e.preventDefault(); const csv = String(new FormData(e.currentTarget).get('csv') ?? ''); start(async () => setMsg((await importRoster(schoolId, csv)).message)); }}>
          <h2>Import roster</h2>
          <label>One student per line: name, homeroom, parent email<textarea name="csv" rows={8} required placeholder={'Ava Bennett, Rm 12, parent@example.com'} /></label>
          {msg && <p className="muted">{msg}</p>}
          <div className="row"><button className="btn primary" disabled={pending}>{pending ? 'Importing…' : 'Import'}</button><button type="button" className="btn ghost" onClick={() => ref.current?.close()}>Close</button></div>
        </form>
      </dialog>
    </>
  );
}

export function DraftEditor({ ticketId, draft, disabled }: { ticketId: string; draft: string; disabled: boolean }) {
  const [saved, setSaved] = useState(true);
  return (
    <>
      <textarea key={ticketId + draft.length} className="inp" id={`draft-${ticketId}`} defaultValue={draft} disabled={disabled} aria-label="Drafted reply" placeholder="No reply drafted yet." onChange={() => setSaved(false)} onBlur={async (e) => { await saveDraft(ticketId, e.target.value); setSaved(true); }} />
      {!saved && <span className="faint">Saves when you click outside the box</span>}
    </>
  );
}

export function CaptureControls({ shootId, studentId, taken, best }: { shootId: string; studentId: string; taken: number; best: number | null }) {
  const [pending, start] = useTransition();
  const flags = ['', 'Eyes closed', 'Glare', 'Head turned', 'Out of focus'];
  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <div className="row" style={{ justifyContent: 'center' }}>
        {flags.map((f) => <button key={f} className={f ? 'btn sm' : 'btn primary'} disabled={pending || taken >= 3} onClick={() => start(() => recordPose(shootId, studentId, f))}>{f ? `Flag: ${f}` : `Record pose ${Math.min(taken + 1, 3)} as good`}</button>)}
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn" disabled={pending || best === null} onClick={() => start(() => acceptPose(shootId, studentId, best))}>Accept pose {best ?? ''}</button>
        <button className="btn ghost" disabled={pending || !taken} onClick={() => start(() => acceptPose(shootId, studentId, null))}>Clear poses</button>
      </div>
    </div>
  );
}

export function StudioForm({ name, brandHue, canEdit }: { name: string; brandHue: number; canEdit: boolean }) {
  const [hue, setHue] = useState(brandHue);
  const [pending, start] = useTransition();
  const hues: [number, string][] = [[262, 'Iris'], [205, 'Lake'], [160, 'Spruce'], [25, 'Clay'], [340, 'Berry']];
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const n = String(new FormData(e.currentTarget).get('name')); start(() => saveStudio({ name: n, brandHue: String(hue) })); }}>
      <label>Studio name<input name="name" defaultValue={name} required disabled={!canEdit} /></label>
      <span className="label">Brand color</span>
      <div className="row">{hues.map(([h, n]) => <button type="button" key={h} className="btn sm" disabled={!canEdit} style={hue === h ? { borderColor: 'var(--accent)' } : undefined} onClick={() => setHue(h)}><span className="dot" style={{ background: `oklch(.62 .16 ${h})`, display: 'inline-block', marginRight: 6 }} />{n}</button>)}</div>
      {canEdit && <div><button className="btn primary" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button></div>}
    </form>
  );
}

export function MemberForm({ roles }: { roles: string[] }) {
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const d = Object.fromEntries(new FormData(form)) as { name: string; email: string; role: string }; start(async () => { const r = await addMember(d); if (r.ok) { form.reset(); setError(''); } else setError(r.error ?? ''); }); }}>
      <div className="field"><input name="name" placeholder="Name" aria-label="Name" required /><input name="email" type="email" placeholder="Email" aria-label="Email" required /></div>
      <div className="field"><select name="role" className="inp" aria-label="Role">{roles.map((r) => <option key={r}>{r}</option>)}</select><button className="btn primary" disabled={pending}>Add person</button></div>
      {error && <p className="err">{error}</p>}
    </form>
  );
}

export function RemoveMember({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return <button className="btn sm ghost" disabled={pending} onClick={() => start(async () => { await removeMember(id); router.refresh(); })}>Remove</button>;
}
