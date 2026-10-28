import { useState, type FormEvent, type ReactNode } from 'react';
import { Laptop } from 'lucide-react';
import { friendlyError, supabase, supabaseConfigured } from '../lib/supabase';
import { Button, Field, Input, Notice } from '../components/ui';

export function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh grid place-items-center px-4 py-10 bg-[radial-gradient(1200px_500px_at_50%_-10%,#121c45_0%,transparent_70%)]">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <div className="size-10 rounded-xl bg-navy-800 border border-white/10 text-accent grid place-items-center"><Laptop className="size-5" aria-hidden /></div>
          <div className="leading-tight">
            <div className="font-extrabold tracking-wide">PASTI Assets</div>
            <div className="text-[12px] text-muted">IT Asset Register · Aurion Solar</div>
          </div>
        </div>
        <div className="card p-6">
          <h1 className="text-lg font-bold">{title}</h1>
          <p className="text-muted text-[13px] mt-1 mb-5">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null);
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError(/invalid/i.test(err.message) ? 'Incorrect email or password.' : friendlyError(err));
  }

  async function forgot() {
    setError(null); setInfo(null);
    if (!email.trim()) { setError('Type your email address first, then click "Forgot password?".'); return; }
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/set-password` });
    if (err) setError(friendlyError(err));
    else setInfo('If that address has an account, a link to set a new password is on its way. Check your inbox.');
  }

  return (
    <AuthFrame title="Sign in" subtitle="Use the account IT created for you.">
      {!supabaseConfigured && <div className="mb-4"><Notice tone="danger">The app is not connected to its database yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README).</Notice></div>}
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && <Notice tone="danger">{error}</Notice>}
        {info && <Notice tone="ok">{info}</Notice>}
        <Field label="Email" htmlFor="email" required>
          <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password" required>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" loading={busy} className="w-full mt-1">Sign in</Button>
        <button type="button" onClick={() => void forgot()} className="text-[13px] text-primary hover:underline self-center">Forgot password?</button>
      </form>
    </AuthFrame>
  );
}

export function SetPassword() {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (p1.length < 10) { setError('Use at least 10 characters.'); return; }
    if (p1 !== p2) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: p1 });
    setBusy(false);
    if (err) setError(/session/i.test(err.message) ? 'This link has expired. Ask an administrator to send a new invitation, or use "Forgot password?".' : friendlyError(err));
    else setDone(true);
  }

  return (
    <AuthFrame title="Set your password" subtitle="Choose a password for your PASTI Assets account.">
      {done ? (
        <div className="flex flex-col gap-4">
          <Notice tone="ok">Password saved.</Notice>
          <a href="/" className="text-center text-primary hover:underline">Continue to the app</a>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="New password" htmlFor="p1" required hint="At least 10 characters.">
            <Input id="p1" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} />
          </Field>
          <Field label="Type it again" htmlFor="p2" required>
            <Input id="p2" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" loading={busy} className="w-full">Save password</Button>
        </form>
      )}
    </AuthFrame>
  );
}

export function NoAccess({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <AuthFrame title="Waiting for approval" subtitle={`You are signed in as ${email}.`}>
      <p className="text-ink-2 text-[13.5px] mb-5">
        Your account exists but has not been given access yet. Ask an IT administrator to set your role
        (Viewer, Editor or Administrator) on the Settings page, then reload this page.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => location.reload()} variant="primary" className="flex-1">Reload</Button>
        <Button onClick={onSignOut} className="flex-1">Sign out</Button>
      </div>
    </AuthFrame>
  );
}
