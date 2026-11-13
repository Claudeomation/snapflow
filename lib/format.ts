export const money = (cents: number) => '$' + Math.round(cents / 100).toLocaleString('en-US');

export function today(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
export function dayLabel(d: Date): string {
  const s = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return dayKey(d) === dayKey(today()) ? `Today · ${s}` : s;
}
export const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
