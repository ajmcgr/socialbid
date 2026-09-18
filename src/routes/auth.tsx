import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { getSupabase } from "@/integrations/supabase/browser";
import { requestMagicLink } from "@/lib/magic-link.functions";

const safeNext = z.enum(["/admin", "/creator", "/inbox", "/notifications"]);

export const Route = createFileRoute("/auth")({
  validateSearch: z.object({
    next: safeNext.optional().catch(undefined),
    token_hash: z.string().min(20).max(4096).optional().catch(undefined),
    type: z.literal("magiclink").optional().catch(undefined),
    link_token: z.string().min(20).max(200).optional().catch(undefined),
  }),
  head: () => ({
    meta: [
      { title: "Sign In — SocialBid" },
      { name: "description", content: "Sign in to your SocialBid account." },
      { property: "og:title", content: "Sign In — SocialBid" },
      { property: "og:description", content: "Sign in to your SocialBid account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Auth,
});

function Auth() {
  const { next = "/admin", token_hash: tokenHash, type, link_token: linkToken } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const finishing = useRef(false);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setMessage("Sign in is temporarily unavailable. Please try again.");
      return;
    }
    let active = true;
    function linkFailureDestination(error: string) {
      const params = new URLSearchParams({
        google_link: error === "conflict" ? "conflict" : "failed",
      });
      return `/creator?${params.toString()}`;
    }

    async function reportGoogleCallbackFailure(errorCode: string) {
      const safeCode = /^[a-zA-Z0-9_-]{1,80}$/.test(errorCode) ? errorCode : "oauth_error";
      await import("@/lib/account-linking.functions")
        .then(({ reportCanonicalLinkCallbackFailure }) =>
          reportCanonicalLinkCallbackFailure({
            data: { provider: "google", errorCode: safeCode },
          }),
        )
        .catch(() => undefined);
    }

    async function finish(accessToken: string) {
      if (!active || finishing.current) return;
      finishing.current = true;
      setBusy(true);
      const established = linkToken
        ? await import("@/lib/account-linking.functions")
            .then(({ completeCanonicalAccountLink }) =>
              completeCanonicalAccountLink({ data: { accessToken, linkToken } }),
            )
            .catch(() => ({ ok: false as const, error: "failed" as const }))
        : await import("@/lib/session-bootstrap.functions")
            .then(({ establishCanonicalSession }) =>
              establishCanonicalSession({ data: { accessToken } }),
            )
            .catch(() => ({ ok: false as const }));
      if (!active) return;
      if (!established.ok) {
        if (linkToken && type !== "magiclink") {
          const error =
            "error" in established && typeof established.error === "string"
              ? established.error
              : "failed";
          window.location.assign(linkFailureDestination(error));
          return;
        }
        finishing.current = false;
        setBusy(false);
        setMessage(
          "error" in established && established.error === "conflict"
            ? "That sign-in method already belongs to another SocialBid account."
            : linkToken
              ? "We couldn't finish linking that sign-in method. Please try again."
              : "We couldn't finish signing you in. Please try again.",
        );
        return;
      }
      window.location.assign(next);
    }

    async function resolveAuth() {
      if (linkToken && type !== "magiclink") {
        const callbackParams = new URLSearchParams([
          ...new URLSearchParams(window.location.search),
          ...new URLSearchParams(window.location.hash.replace(/^#/, "")),
        ]);
        const callbackError = callbackParams.get("error_code") ?? callbackParams.get("error");
        if (callbackError) {
          await reportGoogleCallbackFailure(callbackError);
          if (active) window.location.assign(linkFailureDestination("failed"));
          return;
        }
      }
      if (tokenHash && type === "magiclink") {
        const { data, error } = await supabase!.auth.verifyOtp({
          token_hash: tokenHash,
          type: "magiclink",
        });
        if (!active) return;
        if (error || !data.session) {
          setMessage("That sign-in link is invalid or has expired. Request a new one.");
          return;
        }
        await finish(data.session.access_token);
        return;
      }
      const { data } = await supabase!.auth.getSession();
      if (data.session) await finish(data.session.access_token);
    }

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) void finish(session.access_token);
    });
    void resolveAuth();
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [linkToken, next, tokenHash, type]);

  async function continueWithGoogle() {
    const supabase = getSupabase();
    if (!supabase) {
      setMessage("Sign in is temporarily unavailable. Please try again.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const redirect = new URL("/auth", window.location.origin);
    redirect.searchParams.set("next", next);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirect.toString() },
    });
    if (error) {
      setBusy(false);
      setMessage("Google sign-in couldn't start. Please try again.");
    }
  }

  async function sendEmailLink() {
    setBusy(true);
    setMessage(null);
    const result = await requestMagicLink({ data: { email, next } }).catch(() => ({
      ok: false as const,
    }));
    setBusy(false);
    if (!result.ok) {
      setMessage("We couldn't send the sign-in email. Please try again in a moment.");
      return;
    }
    setSent(true);
  }

  async function continueWithEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendEmailLink();
  }

  const xHref = `/api/public/x-start?${new URLSearchParams({ next }).toString()}`;

  return (
    <div className="mx-auto max-w-md px-5 py-20">
      <h1 className="text-3xl font-extrabold">Sign in to SocialBid</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Use X, Google, or a secure email link. Add extra sign-in methods later from My Profile.
      </p>
      <div className="panel mt-6 space-y-3 px-5 py-6">
        <a href={xHref} className="btn-ink btn-ink-hover flex w-full justify-center">
          Continue with X
        </a>
        <button
          type="button"
          onClick={continueWithGoogle}
          disabled={busy}
          className="btn-outline-ink w-full justify-center disabled:opacity-40"
        >
          Continue with Google
        </button>
        <div className="flex items-center gap-3 py-2" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          <span className="font-mono text-xs text-muted-foreground">OR</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        {sent ? (
          <div role="status">
            <h2 className="font-extrabold">Check your email</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We sent a one-time SocialBid sign-in link to {email}.
            </p>
            <div className="mt-4 flex gap-4 text-sm">
              <button
                type="button"
                disabled={busy}
                onClick={sendEmailLink}
                className="underline disabled:opacity-40"
              >
                {busy ? "Sending…" : "Resend link"}
              </button>
              <button type="button" onClick={() => setSent(false)} className="underline">
                Use another email
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={continueWithEmail} className="space-y-3">
            <div>
              <label className="label-xs" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="field mt-1"
              />
            </div>
            <button
              disabled={busy}
              className="btn-outline-ink w-full justify-center disabled:opacity-40"
            >
              {busy ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        )}
        {message ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
