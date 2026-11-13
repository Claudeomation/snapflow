'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { askOperator, runActions, undo, type RunResult } from '@/app/actions';
import type { Step } from '@/lib/ops';

type Plan = { steps: Step[]; status: 'proposed' | 'running' | 'done' | 'cancelled' | 'undone'; runId?: string };
type Msg = { role: 'user' | 'ai'; text: string; plan?: Plan };

const CHIPS: Record<string, string[]> = {
  '/': ['What needs my attention today?', 'Approve everything that stays internal'],
  '/pipeline': ['Which deal should I work first?'],
  '/contracts': ['Which contracts end soon?'],
  '/schedule': ['Assign all open shoots', 'Who is free on the next open day?'],
  '/orders': ['Which galleries are behind last year?'],
  '/support': ['Send all drafted replies', 'Which ticket is most urgent?'],
  '/accounting': ['Chase overdue invoices'],
  '/analytics': ['Which schools are behind last year?'],
};

/** Buttons anywhere in the app report their runs here so every change shows up in one place. */
export const reportRun = (title: string, res: RunResult): void => { window.dispatchEvent(new CustomEvent('snapflow:run', { detail: { title, res } })); };
export const askOperatorFromPage = (q: string): void => { window.dispatchEvent(new CustomEvent('snapflow:ask', { detail: q })); };

export default function Operator({ engine, onClose, onActivity }: { engine: 'claude' | 'builtin'; onClose: () => void; onActivity: () => void }) {
  const [chat, setChat] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const path = usePathname();
  const router = useRouter();
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const chatRef = useRef(chat);
  chatRef.current = chat;

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chat, busy]);

  const push = (m: Msg) => setChat((c) => [...c, m]);
  const patch = (plan: Plan, next: Partial<Plan>) => setChat((c) => c.map((m) => (m.plan === plan ? { ...m, plan: { ...plan, ...next } } : m)));

  async function run(plan: Plan) {
    setBusy(true);
    patch(plan, { status: 'running' });
    try {
      const res = await runActions(plan.steps.map((s) => s.action));
      setChat((c) => c.map((m) => (m.plan && m.plan.steps === plan.steps ? { ...m, plan: { steps: res.steps, status: 'done', runId: res.runId } } : m)));
      router.refresh();
    } catch {
      setChat((c) => c.map((m) => (m.plan && m.plan.steps === plan.steps ? { ...m, plan: { ...m.plan, status: 'cancelled' } } : m)));
      push({ role: 'ai', text: 'That did not go through. Nothing was changed.' });
    }
    setBusy(false);
  }

  async function ask(q: string) {
    q = q.trim();
    if (!q || busy) return;
    onActivity();
    const history = chatRef.current.filter((m) => m.text).slice(-6).map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.text }));
    while (history.length && history[0].role !== 'user') history.shift();
    push({ role: 'user', text: q });
    setBusy(true);
    try {
      const r = await askOperator(q, history, path);
      const plan: Plan | undefined = r.steps.length ? { steps: r.steps, status: 'proposed' } : undefined;
      push({ role: 'ai', text: r.say, plan });
      if (r.goto && r.goto !== path) router.push(r.goto);
      setBusy(false);
      if (plan && !plan.steps.some((s) => s.needsOK)) await run(plan);
    } catch {
      push({ role: 'ai', text: 'Something went wrong reaching the operator. Nothing was changed.' });
      setBusy(false);
    }
  }

  useEffect(() => {
    const onRun = (e: Event) => {
      const { title, res } = (e as CustomEvent<{ title: string; res: RunResult }>).detail;
      setChat((c) => [...c, { role: 'user', text: title }, { role: 'ai', text: '', plan: { steps: res.steps, status: 'done', runId: res.runId } }]);
      onActivity();
    };
    const onAsk = (e: Event) => ask((e as CustomEvent<string>).detail);
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onActivity(); input.current?.focus(); } };
    window.addEventListener('snapflow:run', onRun);
    window.addEventListener('snapflow:ask', onAsk);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('snapflow:run', onRun); window.removeEventListener('snapflow:ask', onAsk); window.removeEventListener('keydown', onKey); };
  });

  async function undoPlan(plan: Plan) {
    if (!plan.runId || busy) return;
    setBusy(true);
    const msg = await undo(plan.runId);
    patch(plan, { status: 'undone' });
    push({ role: 'ai', text: msg });
    router.refresh();
    setBusy(false);
  }

  const label = { proposed: 'Waiting for you', running: 'Running', done: 'Done', cancelled: 'Cancelled', undone: 'Undone' };
  return (
    <aside className="agent" aria-label="SnapFlow operator">
      <header>
        <span className={`orb ${busy ? 'busy' : ''}`} />
        <h2>Operator</h2>
        <span className={`pill ${engine === 'claude' ? 'ok' : ''}`} title={engine === 'claude' ? '' : 'No Claude API key is configured, so the operator understands a fixed set of requests.'}>{engine === 'claude' ? 'Claude connected' : 'Built-in commands'}</span>
        <button className="btn sm ghost onlysm" onClick={onClose}>Close</button>
      </header>
      <div className="msgs">
        {!chat.length && <div className="msg ai"><b>Tell me what you want done.</b>{'\n'}I show the plan, ask before anything goes out to a school or parent, and log every step so you can undo it.</div>}
        {chat.map((m, i) => m.role === 'user' ? <div key={i} className="msg user">{m.text}</div> : (
          <div key={i} style={{ display: 'contents' }}>
            {m.text && <div className="msg ai">{m.text}</div>}
            {m.plan && (
              <div className="plan">
                <div className="ph"><span className="label">Plan · {m.plan.steps.length} {m.plan.steps.length === 1 ? 'step' : 'steps'}</span><span className={`pill ${m.plan.status === 'done' ? 'ok' : m.plan.status === 'proposed' ? 'warn' : ''}`}>{label[m.plan.status]}</span></div>
                <ol>{m.plan.steps.map((s, j) => (
                  <li key={j} className={m.plan!.status === 'running' ? 'run' : s.ok === true ? 'done' : s.ok === false || m.plan!.status === 'cancelled' ? 'skip' : ''}><span className="st" /><span>{s.label}{s.note && <small style={s.ok === false ? { color: 'var(--bad)', textDecoration: 'none' } : undefined}>{s.note}</small>}</span></li>
                ))}</ol>
                {m.plan.status === 'proposed' && <div className="pf"><button className="btn sm primary" disabled={busy} onClick={() => run(m.plan!)}>Run plan</button><button className="btn sm ghost" onClick={() => patch(m.plan!, { status: 'cancelled' })}>Cancel</button></div>}
                {m.plan.status === 'done' && m.plan.steps.some((s) => s.ok) && <div className="pf"><button className="btn sm ghost" disabled={busy} onClick={() => undoPlan(m.plan!)}>Undo</button></div>}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg ai muted">Working…</div>}
        <div ref={end} />
      </div>
      <div className="chips">{(CHIPS[path] ?? []).map((c) => <button key={c} className="chip" onClick={() => ask(c)}>{c}</button>)}</div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); const q = text; setText(''); ask(q); }}>
        <textarea ref={input} id="ask" rows={1} value={text} placeholder="Tell SnapFlow what to do…" aria-label="Tell SnapFlow what to do" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
        <button className="btn primary" disabled={busy}>Send</button>
      </form>
    </aside>
  );
}
