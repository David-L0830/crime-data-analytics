// Checkpoint 2 scaffolding — NOT yet used by AuthContext / the live login
// flow. This hook exists so Checkpoint 4 (login migration) can wire it into
// AuthContext without having to design the session-listener plumbing at the
// same time as the actual credential-flow cutover.
//
// Tracks the Supabase Auth session and reacts to the four events the
// migration spec calls out: SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED,
// INITIAL_SESSION (see supabase.auth.onAuthStateChange docs).
import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

export function useSupabaseSession() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      // No Supabase project configured yet — stay in a resolved, signed-out
      // state rather than hanging in `loading` forever. This is the
      // expected state for the rest of this migration until Checkpoint 4.
      setLoading(false);
      return undefined;
    }

    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setSession(data.session);
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      // event is one of: SIGNED_IN | SIGNED_OUT | TOKEN_REFRESHED |
      // INITIAL_SESSION | PASSWORD_RECOVERY | USER_UPDATED
      if (cancelled) return;
      setSession(newSession);
      if (event === 'INITIAL_SESSION') setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return {
    session,
    supabaseUser: session?.user ?? null,
    accessToken: session?.access_token ?? null,
    loading,
  };
}
