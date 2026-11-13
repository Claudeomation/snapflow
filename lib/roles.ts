export const ROLES = ['Owner', 'Admin', 'Sales rep', 'Photographer', 'Support', 'Accounting'] as const;
export type Role = (typeof ROLES)[number];

export const AREAS = ['Scheduling', 'Sales', 'Contracts', 'Orders', 'Support', 'Accounting'] as const;
export type Area = (typeof AREAS)[number] | 'Settings';

export const LEVELS = { suggest: 'Suggest only', ask: 'Ask before sending', auto: 'Run on its own' } as const;
export type Level = keyof typeof LEVELS;

export const NAV: [string, [string, string][]][] = [
  ['Today', [['/', 'Briefing']]],
  ['Grow', [['/pipeline', 'Pipeline'], ['/contracts', 'Contracts']]],
  ['Operate', [['/schools', 'Schools'], ['/schedule', 'Schedule'], ['/capture', 'Capture']]],
  ['Deliver', [['/orders', 'Orders'], ['/support', 'Support']]],
  ['Run the business', [['/accounting', 'Accounting'], ['/analytics', 'Analytics'], ['/automations', 'Automations']]],
  ['Account', [['/settings', 'Settings'], ['/activity', 'Activity']]],
];

// Which screens each role can open. Owner sees everything.
const PAGES: Record<Role, string[] | null> = {
  Owner: null,
  Admin: ['/', '/pipeline', '/contracts', '/schools', '/schedule', '/capture', '/orders', '/support', '/accounting', '/analytics', '/automations', '/activity'],
  'Sales rep': ['/', '/pipeline', '/contracts', '/schools', '/analytics', '/activity'],
  Photographer: ['/', '/schools', '/schedule', '/capture', '/activity'],
  Support: ['/', '/schools', '/orders', '/support', '/analytics', '/activity'],
  Accounting: ['/', '/schools', '/orders', '/accounting', '/analytics', '/activity'],
};
export const canOpen = (role: Role, path: string) => !PAGES[role] || PAGES[role]!.includes(path);

// Which roles may change things in each area.
const WRITE: Record<Area, Role[]> = {
  Scheduling: ['Owner', 'Admin', 'Photographer'],
  Sales: ['Owner', 'Admin', 'Sales rep'],
  Contracts: ['Owner', 'Admin', 'Sales rep'],
  Orders: ['Owner', 'Admin', 'Support', 'Accounting'],
  Support: ['Owner', 'Admin', 'Support'],
  Accounting: ['Owner', 'Accounting'],
  Settings: ['Owner', 'Admin'],
};
export const canAct = (role: Role, area: Area) => WRITE[area].includes(role);
export const AREA_PAGE: Record<Area, string> = { Scheduling: '/schedule', Sales: '/pipeline', Contracts: '/contracts', Orders: '/orders', Support: '/support', Accounting: '/accounting', Settings: '/settings' };
