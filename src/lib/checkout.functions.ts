import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  username: z.string().min(1).max(40),
  companyName: z.string().min(1).max(80),
  bioMessage: z.string().trim().min(3).max(100),
  destinationUrl: z.string().min(3).max(400),
  email: z.string().email().max(160),
  xHandle: z.string().max(40).optional().nullable(),
  logoUrl: z.string().max(400).optional().nullable(),
  bidCents: z
    .number()
    .finite()
    .int()
    .positive()
    .refine((value) => value % 100 === 0, "Bid must be a whole-dollar amount."),
  agreed: z.boolean(),
});

export const startCheckout = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data }) => {
    const { admin, baseUrl } = await import("./db.server");
    const { safeDestination, safeLogoUrl } = await import("./validate");
    const { createCheckoutSession } = await import("./stripe.server");
    const { CURRENT_PLACEMENT_FORMAT, validatePlacement } = await import("./placement");
    const db = admin();

    const { resolveCanonicalAccount } = await import("./account.server");
    // The secure first-party SocialBid session is authoritative regardless of
    // whether it was established through X or email authentication.
    const account = await resolveCanonicalAccount(db);

    if (!data.agreed) return { error: "You must accept the terms." };

    const destination = safeDestination(data.destinationUrl);
    if (!destination) return { error: "Destination must be a valid public domain." };
    const logo = safeLogoUrl(data.logoUrl ?? null);

    const { data: creator } = await db
      .from("creators")
      .select("id, user_id, username, social_handle, x_username, x_account_verified, banned")
      .eq("username", data.username.toLowerCase())
      .maybeSingle();
    if (!creator || creator.banned) return { error: "Listing unavailable." };
    if (!creator.x_account_verified) return { error: "This creator has disconnected X." };

    // Self-bidding guard. Resolve the server-only hashed session and compare
    // its canonical user ID; browser-supplied identity fields are never proof.
    if (account?.userId === creator.user_id)
      return { error: "You can't sponsor your own profile." };

    // Legacy advisory checks only; never used as the authoritative decision.
    const norm = (v: string | null | undefined) => (v ?? "").trim().replace(/^@/, "").toLowerCase();
    const buyerHandle = norm(data.xHandle);
    const creatorHandles = [creator.x_username, creator.social_handle, creator.username].map(norm);
    if (buyerHandle && creatorHandles.includes(buyerHandle))
      return { error: "You can't sponsor your own profile." };
    const { data: listing } = await db
      .from("listings")
      .select("id, status, starting_price_cents, minimum_increase_percentage")
      .eq("creator_id", creator.id)
      .maybeSingle();
    if (!listing || listing.status !== "active") return { error: "Listing is not accepting bids." };

    // SERVER-SIDE price. Never trust the browser.
    const { data: required } = await db.rpc("required_price_cents", { _listing_id: listing.id });
    const requiredCents = Number(required);
    if (!Number.isSafeInteger(requiredCents) || requiredCents < 100)
      return { error: "Could not price this takeover." };

    // The browser suggests a bid, but the current server-side minimum is authoritative.
    const amountCents = data.bidCents;
    if (!Number.isSafeInteger(amountCents) || amountCents < requiredCents)
      return { error: `Your bid must be at least $${(requiredCents / 100).toFixed(2)}.` };

    // Buyer is a commercial identity owned by the canonical account, not the
    // account itself. Guests only reuse an equivalent unclaimed identity.
    const email = data.email.trim().toLowerCase();
    const companyName = data.companyName.trim();
    let buyerQuery = db
      .from("buyers")
      .select("id, banned, user_id, company_name")
      .eq("email", email);
    buyerQuery = account
      ? buyerQuery.eq("user_id", account.userId)
      : buyerQuery.is("user_id", null);
    const { data: buyerCandidates, error: buyerLookupError } = await buyerQuery;
    if (buyerLookupError) return { error: "Could not resolve sponsor identity." };
    const normalizeIdentity = (value: string | null | undefined) =>
      (value ?? "").trim().toLocaleLowerCase("en");
    const existingBuyer = (buyerCandidates ?? []).find(
      (candidate) => normalizeIdentity(candidate.company_name) === normalizeIdentity(companyName),
    );
    if (existingBuyer?.banned) return { error: "This account cannot purchase." };
    let buyerId = existingBuyer?.id as string | undefined;
    if (!buyerId) {
      const { data: created, error: createBuyerError } = await db
        .from("buyers")
        .insert({
          email,
          company_name: companyName,
          x_handle: data.xHandle ?? null,
          user_id: account?.userId ?? null,
        })
        .select("id")
        .single();
      buyerId = created?.id;
      if (createBuyerError || !buyerId) {
        let racedQuery = db.from("buyers").select("id, company_name").eq("email", email);
        racedQuery = account
          ? racedQuery.eq("user_id", account.userId)
          : racedQuery.is("user_id", null);
        const raced = await racedQuery;
        buyerId = raced.data?.find(
          (candidate) =>
            normalizeIdentity(candidate.company_name) === normalizeIdentity(companyName),
        )?.id;
      }
      if (!buyerId) return { error: "Could not create sponsor identity." };
    }

    // Website-only placement validation. The creator's X bio length is irrelevant.
    const placement = validatePlacement({
      message: data.bioMessage,
      url: destination,
      retainedChars: 0,
    });
    if (!placement.ok) return { error: placement.error };

    const { data: payment, error: payErr } = await db
      .from("payments")
      .insert({
        listing_id: listing.id,
        buyer_id: buyerId,
        amount_cents: amountCents,
        quoted_min_cents: requiredCents,
        email,
        company_name: data.companyName.trim(),
        bio_message: data.bioMessage.trim(),
        placement_format: CURRENT_PLACEMENT_FORMAT,
        destination_url: destination,
        logo_url: logo,
        x_handle: data.xHandle ?? null,
        initiated_by_user_id: account?.userId ?? null,
        status: "created",
      })
      .select("id")
      .single();
    if (payErr || !payment) return { error: "Could not start checkout." };

    let guestClaimToken: string | null = null;
    if (!account) {
      try {
        const { createGuestBuyerClaim } = await import("./account-claims.server");
        guestClaimToken = await createGuestBuyerClaim(db, String(payment.id), String(buyerId));
      } catch {
        await db.from("payments").update({ status: "failed" }).eq("id", payment.id);
        return { error: "Could not securely prepare guest checkout." };
      }
    }

    const base = baseUrl();
    try {
      const session = await createCheckoutSession({
        amountCents,
        email,
        companyName: data.companyName,
        creatorHandle: creator.social_handle ?? creator.username,
        paymentId: payment.id,
        successUrl: `${base}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${base}/u/${creator.username}?canceled=1`,
      });
      await db
        .from("payments")
        .update({ stripe_session_id: session["id"] as string })
        .eq("id", payment.id);
      await db.from("analytics_events").insert({
        name: "checkout_started",
        listing_id: listing.id,
        props: { amount_cents: amountCents, quoted_min_cents: requiredCents },
      });
      if (guestClaimToken) {
        const { setGuestBuyerClaimCookie } = await import("./account-claims.server");
        setGuestBuyerClaimCookie(guestClaimToken);
      }
      return { url: session["url"] as string, amountCents };
    } catch (e) {
      await db
        .from("payments")
        .update({ status: "failed", admin_notes: String(e) })
        .eq("id", payment.id);
      return { error: "Payment could not be started. Try again." };
    }
  });

/** Called by the success page: confirms/settles a session even if the webhook is delayed. */
export const settleSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ sessionId: z.string().min(5) }).parse(input))
  .handler(async ({ data }) => {
    const { settleCheckoutSession } = await import("./settle.server");
    return settleCheckoutSession(data.sessionId);
  });
