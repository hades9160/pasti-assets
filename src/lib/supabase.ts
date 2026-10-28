import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

// The anon key is public by design; Row Level Security decides what each
// signed-in user can see or change. Never put the service-role key here.
export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Turn a Supabase / Postgres error into a sentence for the person on screen. */
export function friendlyError(err: unknown): string {
  const e = err as { message?: string; code?: string; details?: string } | null;
  const msg = e?.message ?? String(err);
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return 'Could not reach the server. Check your internet connection and try again.';
  }
  if (e?.code === '23505' || /duplicate key/i.test(msg)) {
    if (/serial/i.test(msg)) return 'That serial number is already registered. Search for it on the register — the same unit must not be encoded twice.';
    if (/employees_name/i.test(msg)) return 'An employee with that name already exists.';
    if (/employees_no/i.test(msg)) return 'That Employee ID is already used by someone else.';
    if (/departments_name|device_types_name|list_items/i.test(msg)) return 'That name is already on the list.';
    if (/device_types_code/i.test(msg)) return 'That type code is already used.';
    if (/badges_one_active/i.test(msg)) return 'This device already has an active badge.';
    return 'That record already exists.';
  }
  if (e?.code === '23503' || /foreign key/i.test(msg)) {
    return 'This record is still used elsewhere (for example by an asset or a badge), so it cannot be removed.';
  }
  if (e?.code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'Your account is not allowed to do that. Ask an administrator if you need access.';
  }
  if (/JWT|session/i.test(msg) && /expired|invalid/i.test(msg)) return 'Your session expired. Please sign in again.';
  // Messages raised by our own database functions are already written for people.
  return msg.replace(/^ERROR:\s*/, '');
}
