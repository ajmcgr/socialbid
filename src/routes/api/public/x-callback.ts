import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/x-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { exchangeCode, fetchXUser, placementPresent, decodeXOAuthState } =
          await import("@/lib/x.server");
        const { admin, baseUrl } = await import("@/lib/db.server");
        const db = admin();
        const base = baseUrl();
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        const fail = (reason: string) =>
          new Response(null, { status: 302, headers: { Location: `/creator?error=${reason}` } });

        // The user pressed "Cancel" on X's consent screen.
        const denied = url.searchParams.get("error");
        if (denied) {
          return fail(denied === "access_denied" ? "x_denied" : "x_callback_error");
        }
        if (!code || !state) return fail("missing_code");

        const { data: row } = await db
          .from("x_oauth_states")
          .select("state, code_verifier, created_at")
          .eq("state", state)
          .maybeSingle();
        if (!row) return fail("bad_state");
        // Single-use state, regardless of what happens next.
        await db.from("x_oauth_states").delete().eq("state", state);
        const age = Date.now() - new Date(row.created_at as string).getTime();
        if (age > 10 * 60 * 1000) return fail("bad_state");
        const oauthState = decodeXOAuthState(String(row.code_verifier));

        let xUser;
        try {
          const token = await exchangeCode(base, code, oauthState.verifier);
          xUser = await fetchXUser(token.access_token);
        } catch (e) {
          console.error("X oauth failed", e);
          return fail("x_auth_failed");
        }

        // X user id is the authoritative identity, never the username.
        const { data: existing } = await db
          .from("creators")
          .select("id, username, x_bio_verified, user_id")
          .eq("x_user_id", xUser.id)
          .maybeSingle();

        // A signed-in Google/email user may explicitly attach one X identity to
        // that same canonical account. Never merge accounts by email, handle or
        // display name; the existing HttpOnly SocialBid session is the proof.
        if (oauthState.linkUserId) {
          const { data: ownedCreator, error: ownedCreatorError } = await db
            .from("creators")
            .select("id, x_user_id")
            .eq("user_id", oauthState.linkUserId)
            .maybeSingle();
          if (ownedCreatorError) {
            console.error("canonical creator lookup failed", { code: ownedCreatorError.code });
            return fail("creator_identity_failed");
          }
          if (ownedCreator && String(ownedCreator.x_user_id ?? "") !== xUser.id) {
            return fail("x_account_conflict");
          }
          if (existing?.user_id && String(existing.user_id) !== oauthState.linkUserId) {
            return fail("x_already_connected");
          }
        }

        const now = new Date().toISOString();
        const profile = {
          x_user_id: xUser.id,
          x_username: xUser.username,
          x_display_name: xUser.name,
          x_profile_image_url: xUser.profile_image_url,
          x_profile_url: `https://x.com/${xUser.username}`,
          x_follower_count: xUser.followers,
          x_account_verified: true,
          x_account_verified_at: now,
          x_bio_snapshot: xUser.description,
          display_name: xUser.name,
          profile_image_url: xUser.profile_image_url,
          social_platform: "x",
          social_handle: xUser.username,
          social_account_id: xUser.id,
          social_profile_url: `https://x.com/${xUser.username}`,
          follower_count: xUser.followers,
          updated_at: now,
        };

        let creatorId = existing?.id as string | undefined;
        let username = existing?.username as string | undefined;
        let userId = (existing?.user_id as string | null) ?? oauthState.linkUserId;

        if (creatorId) {
          const { error: profileError } = await db
            .from("creators")
            .update(profile)
            .eq("id", creatorId);
          if (profileError) {
            console.error("creator profile refresh failed", { code: profileError.code });
            return fail("creator_identity_failed");
          }
        } else {
          username = xUser.username.toLowerCase().replace(/[^a-z0-9_-]/g, "");
          const { data: clash } = await db
            .from("creators")
            .select("id, x_user_id")
            .eq("username", username)
            .maybeSingle();
          // Another Social Bid creator already holds this handle / X account.
          if (clash) return fail(clash.x_user_id ? "x_already_connected" : "handle_taken");

          const { data: created, error } = await db
            .from("creators")
            .insert({
              ...profile,
              username,
              verification_status: "pending",
              user_id: oauthState.linkUserId,
            })
            .select("id")
            .single();
          if (error || !created) {
            console.error("creator insert failed", error);
            return fail("creator_create_failed");
          }
          creatorId = created.id as string;
          await db
            .from("listings")
            .insert({ creator_id: creatorId, slug: username, status: "draft" });
        }

        if (creatorId && oauthState.linkUserId && !existing?.user_id) {
          const { data: boundCreator, error: bindingError } = await db
            .from("creators")
            .update({ user_id: oauthState.linkUserId })
            .eq("id", creatorId)
            .is("user_id", null)
            .select("user_id")
            .maybeSingle();
          if (bindingError) {
            console.error("canonical X identity binding failed", { code: bindingError.code });
            return fail("creator_identity_failed");
          }
          if (!boundCreator && existing) {
            const { data: racedCreator } = await db
              .from("creators")
              .select("user_id")
              .eq("id", creatorId)
              .maybeSingle();
            if (String(racedCreator?.user_id ?? "") !== oauthState.linkUserId) {
              return fail("x_already_connected");
            }
          }
          userId = oauthState.linkUserId;
        }

        // X is the trusted identity proof. Bind it once to an internal user so
        // creator-only server checks never need browser-supplied handles/tokens.
        if (!userId && creatorId) {
          const email = `x-${xUser.id}@creator.socialbid.invalid`;
          const { data: createdUser, error: createUserError } = await db.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: { x_user_id: xUser.id, creator_id: creatorId },
          });
          userId = createdUser.user?.id ?? null;

          // Supabase Admin has no direct email lookup. Only after a duplicate
          // creation response do we page through the server-only user list to
          // recover this one deterministic internal identity from a prior,
          // partially completed callback.
          const duplicateUser =
            createUserError?.code === "email_exists" ||
            createUserError?.code === "user_already_exists" ||
            /already\s+(?:exists|registered)|email.*exists/i.test(createUserError?.message ?? "");
          if (!userId && duplicateUser) {
            try {
              let page = 1;
              for (;;) {
                const { data: users, error: listUsersError } = await db.auth.admin.listUsers({
                  page,
                  perPage: 1000,
                });
                if (listUsersError) throw listUsersError;
                const matchingUser = users.users.find(
                  (candidate) => candidate.email?.toLowerCase() === email,
                );
                if (matchingUser) {
                  userId = matchingUser.id;
                  break;
                }
                if (users.nextPage === null) break;
                page = users.nextPage;
              }
            } catch (error) {
              console.error("creator identity recovery lookup failed", error);
            }
          }

          if (!userId) {
            console.error("creator identity binding failed", createUserError);
            return fail("creator_identity_failed");
          }
          const { data: boundCreator, error: bindingError } = await db
            .from("creators")
            .update({ user_id: userId })
            .eq("id", creatorId)
            .is("user_id", null)
            .select("user_id")
            .maybeSingle();
          if (bindingError) {
            console.error("creator identity binding write failed", bindingError);
            return fail("creator_identity_failed");
          }
          if (!boundCreator) {
            const { data: racedCreator, error: racedError } = await db
              .from("creators")
              .select("user_id")
              .eq("id", creatorId)
              .maybeSingle();
            if (racedError || !racedCreator?.user_id) {
              console.error("creator identity binding race could not be resolved", racedError);
              return fail("creator_identity_failed");
            }
            userId = String(racedCreator.user_id);
          }
        }

        if (!userId) return fail("creator_identity_failed");

        let sessionCookie: string;
        try {
          const { issueCreatorSession } = await import("@/lib/creator-session.server");
          sessionCookie = await issueCreatorSession(db, userId);
        } catch (error) {
          console.error("creator session creation failed", error);
          return fail("creator_identity_failed");
        }

        // Website-only sponsorships: connecting X verifies identity, which is
        // all a listing needs. Nothing has to appear in the creator's X bio.
        const { WEBSITE_ONLY_SPONSORSHIP } = await import("@/lib/placement");
        if (WEBSITE_ONLY_SPONSORSHIP || (username && placementPresent(xUser, username))) {
          await db
            .from("creators")
            .update({
              x_bio_verified: true,
              x_bio_verified_at: now,
              x_bio_verified_method: "api",
            })
            .eq("id", creatorId);
          // Connecting X never publicly lists a creator. The creator must
          // explicitly click "List my profile" in the dashboard. Listings that
          // are already live stay live.
        }

        const location =
          oauthState.next === "/creator"
            ? `/creator?connected=${encodeURIComponent(xUser.username)}`
            : oauthState.next;
        return new Response(null, {
          status: 302,
          headers: {
            Location: location,
            "Set-Cookie": sessionCookie,
          },
        });
      },
    },
  },
});
