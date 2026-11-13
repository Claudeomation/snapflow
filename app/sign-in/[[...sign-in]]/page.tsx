import { redirect } from 'next/navigation';
import { clerkEnabled } from '@/lib/auth';

export default async function SignInPage() {
  if (!clerkEnabled) redirect('/');
  const { SignIn } = await import('@clerk/nextjs');
  return <div className="plain" style={{ alignItems: 'center' }}><SignIn /></div>;
}
