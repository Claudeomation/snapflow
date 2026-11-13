import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';

const enabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;
const clerk = enabled ? clerkMiddleware() : null;

// Pages decide who may see them (lib/auth.ts); this only gives Clerk its session context.
export default function proxy(req: NextRequest, ev: NextFetchEvent) {
  return clerk ? clerk(req, ev) : NextResponse.next();
}

export const config = { matcher: ['/((?!_next|.*\\.(?:css|js|png|jpg|svg|ico|woff2?)$).*)'] };
