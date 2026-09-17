import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const establishSessionIn = z.object({
  accessToken: z.string().min(20).max(4096),
});

/**
 * Converts a server-verified Supabase login into Social Bid's existing
 * first-party HttpOnly session. No client-supplied user id is trusted.
 */
export const establishCanonicalSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => establishSessionIn.parse(input))
  .handler(async ({ data }) => {
    const [{ admin }, { issueCreatorSession }, { setResponseHeader }] = await Promise.all([
      import("./db.server"),
      import("./creator-session.server"),
      import("@tanstack/react-start/server"),
    ]);
    const db = admin();
    const {
      data: { user },
      error,
    } = await db.auth.getUser(data.accessToken);
    if (error || !user) return { ok: false as const };

    const cookie = await issueCreatorSession(db, user.id);
    setResponseHeader("Set-Cookie", cookie);
    return { ok: true as const };
  });

/** Revokes only SocialBid's first-party sessions and clears its HttpOnly cookie. */
export const signOutCanonicalSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({}).parse(input))
  .handler(async () => {
    const [{ admin }, sessionModule, { setResponseHeader }] = await Promise.all([
      import("./db.server"),
      import("./creator-session.server"),
      import("@tanstack/react-start/server"),
    ]);
    const db = admin();
    const session = await sessionModule.resolveCreatorSession(db);
    if (session) await sessionModule.revokeCreatorSessions(db, session.userId);
    setResponseHeader("Set-Cookie", sessionModule.clearCreatorSessionCookie());
    return { ok: true as const };
  });
