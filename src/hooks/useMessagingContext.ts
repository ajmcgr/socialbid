import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/integrations/supabase/browser";
import { getMessagingContext } from "@/lib/inbox.functions";

type MessagingContext = Awaited<ReturnType<typeof getMessagingContext>>;

export function useMessagingContext() {
  const loadContext = useServerFn(getMessagingContext);
  const [context, setContext] = useState<MessagingContext | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (nextToken?: string | null) => {
      try {
        const result = await loadContext({
          data: {
            token: nextToken === undefined ? token : nextToken,
            actorKind: null,
          },
        });
        setContext(result);
        setError(null);
      } catch {
        setError("This page couldn't load. Please try again.");
      }
    },
    [loadContext, token],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const sb = getSupabase();
      const session = sb ? (await sb.auth.getSession()).data.session : null;
      if (!active) return;
      const accessToken = session?.access_token ?? null;
      setToken(accessToken);
      try {
        const result = await loadContext({ data: { token: accessToken, actorKind: null } });
        if (active) setContext(result);
      } catch {
        if (active) setError("This page couldn't load. Please try again.");
      }
    })();
    return () => {
      active = false;
    };
  }, [loadContext]);

  return {
    context,
    token,
    error,
    refresh,
  };
}
