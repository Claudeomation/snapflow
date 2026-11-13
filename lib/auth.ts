import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from './db';
import { ROLES, type Role } from './roles';

export const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;
// Demo mode is an explicit opt-in and never applies once sign-in is configured.
export const demoMode = !clerkEnabled && process.env.DEMO_MODE === '1';

export type Ctx = {
  tenantId: string;
  tenant: { id: string; name: string; slug: string; brandHue: number; autonomy: Record<string, string>; rulesOff: string[] };
  user: { id: string; name: string; email: string };
  role: Role;
  demo: boolean;
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'studio';

async function newTenant(name: string, email: string, clerkId: string | null) {
  const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;
  const tenant = await db.tenant.create({ data: { name: `${name}'s studio`, slug } });
  return db.user.create({ data: { tenantId: tenant.id, email, name, role: 'Owner', clerkId } });
}

export async function requireCtx(): Promise<Ctx> {
  let user: { id: string; tenantId: string; name: string; email: string; role: string } | null = null;
  let roleOverride: string | undefined;

  if (clerkEnabled) {
    const { auth, currentUser } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    if (!userId) redirect('/sign-in');
    user = await db.user.findUnique({ where: { clerkId: userId } });
    if (!user) {
      const cu = await currentUser();
      const email = cu?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? '';
      const name = [cu?.firstName, cu?.lastName].filter(Boolean).join(' ') || email.split('@')[0] || 'Owner';
      // Someone an Owner already added by email joins that studio; anyone else starts a new one.
      const invited = email ? await db.user.findFirst({ where: { email, clerkId: null } }) : null;
      user = invited ? await db.user.update({ where: { id: invited.id }, data: { clerkId: userId, name } }) : await newTenant(name, email, userId);
    }
  } else if (demoMode) {
    user = await db.user.findFirst({ where: { role: 'Owner' }, orderBy: { createdAt: 'asc' } });
    if (!user) user = await newTenant('Demo', 'owner@example.com', null);
    roleOverride = (await cookies()).get('demo-role')?.value;
  } else {
    redirect('/not-configured');
  }

  const t = await db.tenant.findUniqueOrThrow({ where: { id: user!.tenantId } });
  const role = (ROLES as readonly string[]).includes(roleOverride ?? '') ? (roleOverride as Role) : (user!.role as Role);
  return {
    tenantId: t.id,
    tenant: { id: t.id, name: t.name, slug: t.slug, brandHue: t.brandHue, autonomy: (t.autonomy ?? {}) as Record<string, string>, rulesOff: t.rulesOff },
    user: { id: user!.id, name: user!.name, email: user!.email },
    role,
    demo: demoMode,
  };
}
