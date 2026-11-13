'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { setDemoRole } from '@/app/actions';
import Operator from './Operator';

type Props = { nav: [string, [string, string, number][]][]; studio: string; role: string; roles: string[]; demo: boolean; signOut: ReactNode; engine: 'claude' | 'builtin'; children: ReactNode };

export default function Shell({ nav, studio, role, roles, demo, signOut, engine, children }: Props) {
  const path = usePathname();
  const [open, setOpen] = useState<'nav' | 'agent' | null>(null);
  useEffect(() => setOpen(null), [path]);
  useEffect(() => {
    document.body.classList.add('shell');
    return () => document.body.classList.remove('shell');
  }, []);
  const title = nav.flatMap((g) => g[1]).find((i) => i[0] === path)?.[1] ?? 'SnapFlow';
  return (
    <div className={`app ${open === 'nav' ? 'nav-open' : ''} ${open === 'agent' ? 'agent-open' : ''}`}>
      <nav className="nav" aria-label="Modules">
        <div className="brand"><span className="mark"><i /></span><div><b>SnapFlow</b><small>{studio}</small></div></div>
        <div className="navlist">
          {nav.map(([group, items]) => (
            <div key={group} style={{ display: 'contents' }}>
              <span className="label">{group}</span>
              {items.map(([href, name, n]) => (
                <Link key={href} href={href} aria-current={href === path ? 'page' : undefined}>{name}{n > 0 && <span className="badge num">{n}</span>}</Link>
              ))}
            </div>
          ))}
        </div>
        <div className="navfoot">
          {demo ? (
            <>
              <label className="label" htmlFor="role">Previewing as</label>
              <select id="role" value={role} onChange={(e) => setDemoRole(e.target.value)}>{roles.map((r) => <option key={r}>{r}</option>)}</select>
            </>
          ) : (
            <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">{role}</span>{signOut}</div>
          )}
        </div>
      </nav>
      <div className="main">
        {demo && <div className="banner">Demo mode: sign-in is not configured, so anyone who can reach this address is the Owner.</div>}
        <div className="topbar">
          <button className="btn sm" id="navBtn" onClick={() => setOpen(open === 'nav' ? null : 'nav')}>Menu</button>
          <b>{title}</b>
          <button className="btn sm primary" onClick={() => setOpen('agent')}>Ask SnapFlow</button>
        </div>
        <main className="view"><div className="wrap">{children}</div></main>
      </div>
      <Operator engine={engine} onClose={() => setOpen(null)} onActivity={() => { if (window.innerWidth <= 1180) setOpen('agent'); }} />
      <div className="scrim" onClick={() => setOpen(null)} />
    </div>
  );
}
