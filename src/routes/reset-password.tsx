import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getSupabase } from "@/integrations/supabase/browser";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set Password — SocialBid" },
      { name: "description", content: "Set a new password for your SocialBid account." },
      { property: "og:title", content: "Set Password — SocialBid" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setMsg("Auth is not configured yet.");
      return;
    }
    // Our reset emails carry ?token_hash=...&type=recovery which we exchange
    // for a recovery session here.
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    if (tokenHash) {
      void (async () => {
        const { error } = await sb.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
        if (error) {
          setMsg("This link is invalid or has expired. Request a new one.");
          return;
        }
        setReady(true);
        window.history.replaceState({}, "", "/reset-password");
      })();
      return;
    }
    // Legacy hash-style links.
    const hash = window.location.hash;
    if (hash.includes("type=recovery") || hash.includes("access_token")) {
      setReady(true);
      return;
    }
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    sb.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    setMsg(null);
    const password = String(new FormData(e.currentTarget).get("password"));
    // Recovery session — do NOT send current_password here.
    const { error } = await sb.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      setMsg(error.message);
      return;
    }
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session) {
      setBusy(false);
      setMsg("Your password was updated. Please sign in again.");
      return;
    }
    const { establishCanonicalSession } = await import("@/lib/session-bootstrap.functions");
    const established = await establishCanonicalSession({
      data: { accessToken: session.access_token },
    }).catch(() => ({ ok: false as const }));
    setBusy(false);
    if (!established.ok) {
      setMsg(
        "Your password was updated, but we couldn't finish signing you in. Please sign in again.",
      );
      return;
    }
    window.location.assign("/admin");
  }

  return (
    <div className="mx-auto max-w-md px-5 py-20">
      <h1 className="text-3xl font-extrabold">Set your password</h1>
      {ready ? (
        <form onSubmit={submit} className="panel mt-6 space-y-4 px-5 py-6">
          <div>
            <label className="label-xs" htmlFor="password">
              New password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              className="field mt-1"
            />
          </div>
          {msg && <p className="text-sm font-medium text-destructive">{msg}</p>}
          <button disabled={busy} className="btn-ink btn-ink-hover w-full disabled:opacity-40">
            {busy ? "…" : "Set password"}
          </button>
        </form>
      ) : (
        <div className="panel mt-6 px-5 py-6">
          <p className="text-sm">
            {msg ?? "This link is invalid or has expired. Request a new one from the sign-in page."}
          </p>
          <a href="/auth" className="mt-3 inline-block text-sm underline">
            Back to sign in
          </a>
        </div>
      )}
    </div>
  );
}
