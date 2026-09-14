import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { getSupabase } from "@/integrations/supabase/browser";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign In — SocialBid" },
      { name: "description", content: "Sign in to manage your SocialBid profile." },
      { property: "og:title", content: "Sign In — SocialBid" },
      { property: "og:description", content: "Sign in to manage your profile." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Auth,
});

function Auth() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) {
      setMsg("Auth is not configured yet.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    if (mode === "reset") {
      const { requestPasswordReset } = await import("@/lib/auth-emails.functions");
      const result = await requestPasswordReset({ data: { email } });
      setBusy(false);
      setMsg(
        result.ok
          ? "A new SocialBid password email is on its way. Use the newest email only."
          : "We couldn't send the password email. Please try again in a moment.",
      );
      return;
    }
    const { data, error } =
      mode === "in"
        ? await sb.auth.signInWithPassword({ email, password })
        : await sb.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin + "/admin" },
          });
    setBusy(false);
    if (error) setMsg(error.message);
    else if (mode === "up") setMsg("Check your email to confirm your account.");
    else if (!data.session) setMsg("Please confirm your email, then sign in again.");
    else navigate({ to: "/admin", replace: true });
  }

  return (
    <div className="mx-auto max-w-md px-5 py-20">
      <h1 className="text-3xl font-extrabold">
        {mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Set your password"}
      </h1>
      <form onSubmit={submit} className="panel mt-6 space-y-4 px-5 py-6">
        <div>
          <label className="label-xs" htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" required className="field mt-1" />
        </div>
        {mode !== "reset" && (
          <div>
            <label className="label-xs" htmlFor="password">
              Password
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
        )}
        {msg && (
          <p
            className={`text-sm font-medium ${msg.startsWith("Check your email") || msg.startsWith("A new SocialBid") ? "" : "text-destructive"}`}
          >
            {msg}
          </p>
        )}
        <button disabled={busy} className="btn-ink btn-ink-hover w-full disabled:opacity-40">
          {busy
            ? "…"
            : mode === "in"
              ? "Sign in"
              : mode === "up"
                ? "Sign up"
                : "Email me a password link"}
        </button>
      </form>
      <div className="mt-4 flex gap-4 text-sm">
        <button onClick={() => setMode(mode === "in" ? "up" : "in")} className="underline">
          {mode === "in" ? "Need an account?" : "Already have an account?"}
        </button>
        {mode === "in" && (
          <button onClick={() => setMode("reset")} className="underline">
            Never set a password?
          </button>
        )}
      </div>
    </div>
  );
}
