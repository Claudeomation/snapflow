import { redirect } from 'next/navigation';
import { requireCtx, type Ctx } from './auth';
import { canOpen } from './roles';

/** For pages: the signed-in context, or a redirect to the briefing if this role cannot open the screen. */
export async function page(path: string): Promise<Ctx> {
  const c = await requireCtx();
  if (!canOpen(c.role, path)) redirect('/');
  return c;
}
