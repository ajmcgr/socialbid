import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Menu, Moon, Sun } from "lucide-react";
import { XIcon } from "../components/XIcon";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { getPublicConfig, unavailablePublicConfig } from "../lib/public-config.functions";
import { getCreatorSession, type CreatorSession } from "../lib/creator.functions";
import { initSupabase, recoverSupabaseSession } from "../integrations/supabase/browser";

const WAKE_RECOVERY_THRESHOLD_MS = 30_000;

function recoveryLog(stage: string, details?: Record<string, unknown>) {
  if (import.meta.env.DEV) console.debug("[social-bid recovery]", stage, details ?? {});
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-6xl font-extrabold">404</h1>
        <p className="mt-3 text-muted-foreground">Nothing here yet.</p>
        <Link to="/" className="btn-ink btn-ink-hover mt-8">
          Go home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-extrabold">This page didn't load.</h1>
        <p className="mt-3 text-sm text-muted-foreground">Try again in a second.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="btn-ink btn-ink-hover"
          >
            Try again
          </button>
          <a href="/" className="btn-outline-ink">
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async () => {
    try {
      return await getPublicConfig();
    } catch (error) {
      // Public Supabase browser config is nonessential to rendering the first
      // document. A transient server-function failure must not turn a normal
      // browser restore into a site-wide SSR 500.
      console.error("root public config unavailable", {
        stage: "root_public_config",
        reason: error instanceof Error ? error.message : "unknown",
      });
      return unavailablePublicConfig;
    }
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Social Bid — How much are you worth on X?" },
      {
        name: "description",
        content:
          "Add your X profile and let sponsors decide what you’re worth. Sponsors compete for the top sponsorship spot on Social Bid.",
      },
      { property: "og:site_name", content: "Social Bid" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "How much are you worth on X?" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap",
      },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
    ],
    scripts: [
      {
        children:
          "try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}",
      },
      { src: "https://www.googletagmanager.com/gtag/js?id=G-3848F2705Y", async: true },
      {
        children:
          "window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', 'G-3848F2705Y');",
      },
      {
        src: "https://analytics.ahrefs.com/analytics.js",
        "data-key": "oIsUcSTyxi09HHhjFi94dQ",
        async: true,
      },
      {
        src: "https://cloud.umami.is/script.js",
        "data-website-id": "4e9c09af-8147-468f-8feb-ed5739250ab1",
        defer: true,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
    setDark(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="inline-flex items-center justify-center p-1 hover:opacity-70"
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

function HamburgerMenu() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open menu"
        aria-expanded={open}
        className="inline-flex items-center justify-center p-1 hover:opacity-70"
      >
        <Menu size={20} />
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-3 w-52 overflow-hidden rounded-2xl bg-card py-2 shadow-[0_10px_40px_rgba(0,0,0,0.14)] ring-1 ring-black/5">
          <Link
            to="/owners"
            onClick={() => setOpen(false)}
            className="block px-5 py-3 text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Sponsors
          </Link>
          <Link
            to="/about"
            onClick={() => setOpen(false)}
            className="block px-5 py-3 text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            About
          </Link>
          <Link
            to="/contact"
            onClick={() => setOpen(false)}
            className="block px-5 py-3 text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Contact
          </Link>
          <Link
            to="/terms"
            onClick={() => setOpen(false)}
            className="block px-5 py-3 text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Terms
          </Link>
          <Link
            to="/privacy"
            onClick={() => setOpen(false)}
            className="block px-5 py-3 text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Privacy
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function SiteHeader() {
  // `undefined` is the unresolved state. Do not render a logged-out CTA until
  // the server-side creator session lookup has completed.
  const [creatorSession, setCreatorSession] = useState<CreatorSession | null | undefined>(
    undefined,
  );
  const locationHref = useRouterState({ select: (state) => state.location.href });

  useEffect(() => {
    let active = true;
    const refreshCreatorSession = () =>
      void getCreatorSession({ data: {} })
        .then((session) => {
          if (active) setCreatorSession(session);
        })
        .catch(() => {
          // A transient wake/reconnect failure must not turn an already-known
          // creator into a logged-out user. On first load we can safely settle
          // to the unauthenticated state; later failures keep the last result
          // until the next recovery attempt succeeds.
          if (active) setCreatorSession((current) => (current === undefined ? null : current));
        });
    refreshCreatorSession();
    window.addEventListener("creator-session-changed", refreshCreatorSession);
    window.addEventListener("social-bid-recover", refreshCreatorSession);
    return () => {
      active = false;
      window.removeEventListener("creator-session-changed", refreshCreatorSession);
      window.removeEventListener("social-bid-recover", refreshCreatorSession);
    };
  }, [locationHref]);

  const creatorCta = creatorSession ? "My Profile" : "Add your profile";

  return (
    <header>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-4">
        <Link to="/" className="flex items-center">
          <img
            src="/social-bid-logo.png"
            alt="Social Bid"
            className="h-10 w-auto scale-[1.12] dark:invert sm:h-14"
          />
        </Link>
        <nav className="flex items-center gap-3 whitespace-nowrap text-xs font-bold sm:gap-6 sm:text-sm sm:font-medium">
          <Link to="/" className="hover:underline">
            Rankings
          </Link>
          <Link to="/faq" className="hover:underline">
            FAQ
          </Link>
          {creatorSession === undefined ? (
            <span aria-hidden="true" className="inline-block h-5 w-[6.5rem]" />
          ) : (
            <Link to="/creator" className="hover:underline">
              {creatorCta}
            </Link>
          )}
          <ThemeToggle />
          <HamburgerMenu />
        </nav>
      </div>
    </header>
  );
}

/**
 * Browser timers and realtime connections are suspended during sleep. Recover
 * only after a meaningful hidden period (or when connectivity returns), then
 * let the existing route loaders and page listeners revalidate their own
 * authoritative data. The custom event avoids duplicate global listeners.
 */
function AppWakeRecovery() {
  const router = useRouter();

  useEffect(() => {
    let hiddenAt = document.hidden ? Date.now() : null;
    let recovering = false;

    const recover = (reason: "visible" | "focus" | "online", hiddenForMs?: number) => {
      if (recovering || !navigator.onLine) return;
      recovering = true;
      recoveryLog("started", { reason, hiddenForMs });

      void (async () => {
        try {
          await recoverSupabaseSession();
          recoveryLog("auth_checked", { reason });
          window.dispatchEvent(new Event("social-bid-recover"));
          await router.invalidate();
          recoveryLog("completed", { reason });
        } catch (error) {
          // Retain normal error boundaries for real failures. A later online,
          // focus, or visibility event can safely make another bounded attempt.
          recoveryLog("failed", {
            reason,
            message: error instanceof Error ? error.message : "unknown",
          });
        } finally {
          recovering = false;
        }
      })();
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        recoveryLog("hidden");
        return;
      }
      const hiddenForMs = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = null;
      recoveryLog("visible", { hiddenForMs });
      if (hiddenForMs >= WAKE_RECOVERY_THRESHOLD_MS) recover("visible", hiddenForMs);
    };

    const onFocus = () => {
      // Some browsers restore a suspended tab with focus before delivering a
      // visibility event. Treat it as a recovery opportunity only if we know
      // the tab was hidden long enough to be stale.
      const hiddenForMs = hiddenAt ? Date.now() - hiddenAt : 0;
      if (hiddenForMs >= WAKE_RECOVERY_THRESHOLD_MS) {
        hiddenAt = null;
        recover("focus", hiddenForMs);
      }
    };

    const onOnline = () => recover("online");

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [router]);

  return null;
}

function SiteFooter() {
  return (
    <footer className="mt-24">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-5 py-6 text-center text-xs text-muted-foreground">
        <a
          href="https://x.com/socialbidco"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 font-medium text-foreground hover:opacity-70"
        >
          <XIcon className="size-3.5" />
          Follow us on X
        </a>
        <span>
          Built with 🫶🏻 by{" "}
          <a
            href="https://x.com/alexmacgregor__"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline"
          >
            Alex
          </a>
          . Inspired by{" "}
          <a
            href="https://x.com/jonathan_wilke"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline"
          >
            Jonathan
          </a>
          .{" "}
          <span className="text-muted-foreground/80">
            Social Bid is not affiliated with or endorsed by X.
          </span>
        </span>
      </div>
    </footer>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const config = Route.useLoaderData();

  if (config) initSupabase(config.supabaseUrl, config.supabaseKey);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-dvh flex-col">
        <AppWakeRecovery />
        <SiteHeader />
        <main className="flex-1">
          <Outlet />
        </main>
        <SiteFooter />
      </div>
    </QueryClientProvider>
  );
}
