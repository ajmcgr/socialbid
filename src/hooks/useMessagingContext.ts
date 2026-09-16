import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { getMessagingContext } from "@/lib/inbox.functions";

type MessagingContext = Awaited<ReturnType<typeof getMessagingContext>>;

export function useMessagingContext() {
  const loadContext = useServerFn(getMessagingContext);
  const [context, setContext] = useState<MessagingContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const token = null;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadContext({
        data: {
          token,
          actorKind: null,
        },
      });
      setContext(result);
    } catch {
      setError("This page couldn't load. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [loadContext, token]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await loadContext({ data: { token, actorKind: null } });
        if (active) {
          setContext(result);
          setError(null);
        }
      } catch {
        if (active) setError("This page couldn't load. Please try again.");
      } finally {
        if (active) setLoading(false);
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
    loading,
    refresh,
  };
}
