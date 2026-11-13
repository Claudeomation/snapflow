import type { ReactNode } from 'react';

export const Head = ({ title, sub, children }: { title: string; sub: string; children?: ReactNode }) => (
  <div className="head"><div><h1>{title}</h1><p>{sub}</p></div><div className="row">{children}</div></div>
);
export const Insight = ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
  <div className="insight"><span className="dot" /><p>{children}</p>{action}</div>
);
export const Pill = ({ children, tone = '' }: { children: ReactNode; tone?: '' | 'ok' | 'warn' | 'bad' | 'ai' }) => <span className={`pill ${tone}`}>{children}</span>;
export const Bar = ({ value, tone = '' }: { value: number; tone?: '' | 'ok' | 'warn' | 'bad' }) => (
  <div className={`bar ${tone}`}><i style={{ width: `${Math.max(2, Math.min(100, value))}%` }} /></div>
);
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Section = ({ title, sub, right, children }: { title: string; sub?: string; right?: ReactNode; children: ReactNode }) => (
  <div className="card flush"><div className="item"><div className="body"><h2>{title}</h2>{sub && <small>{sub}</small>}</div>{right && <div className="acts">{right}</div>}</div>{children}</div>
);
