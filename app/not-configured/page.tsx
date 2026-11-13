export default function NotConfigured() {
  return (
    <div className="plain">
      <h1>Sign-in is not set up</h1>
      <p className="muted">SnapFlow needs Clerk keys before anyone can sign in. Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY, then reload. To try the app without sign-in on your own machine, set DEMO_MODE=1.</p>
    </div>
  );
}
