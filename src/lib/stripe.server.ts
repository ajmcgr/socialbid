const STRIPE_API = "https://api.stripe.com/v1";

async function socialBidWebhookSecret(): Promise<string | null> {
  const configured = process.env["STRIPE_WEBHOOK_SECRET_SOCIAL_BID"]?.trim();
  if (configured) return configured;

  try {
    const { admin } = await import("./db.server");
    const { data, error } = await admin().rpc("get_social_bid_webhook_secret");
    if (error) throw new Error(error.message);
    const vaultSecret = typeof data === "string" ? data.trim() : "";
    return vaultSecret || null;
  } catch (error) {
    console.error("Social Bid webhook Vault configuration lookup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function form(params: Record<string, string | number | undefined>): string {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") body.append(k, String(v));
  }
  return body.toString();
}

async function stripe(path: string, body?: string, method = "POST") {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env["STRIPE_SECRET_KEY"]!}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ?? null,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = json["error"] as { message?: string } | undefined;
    throw new Error(err?.message || `Stripe error ${res.status}`);
  }
  return json;
}

export async function createCheckoutSession(opts: {
  amountCents: number;
  email: string;
  companyName: string;
  creatorHandle: string;
  paymentId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  return stripe(
    "/checkout/sessions",
    form({
      mode: "payment",
      "line_items[0][quantity]": 1,
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": opts.amountCents,
      "line_items[0][price_data][product_data][name]": `Sponsor @${opts.creatorHandle} on SocialBid`,
      "line_items[0][price_data][product_data][description]":
        "Your sponsor spot stays live until someone pays more.",
      customer_email: opts.email,
      "metadata[payment_id]": opts.paymentId,
      "payment_intent_data[metadata][payment_id]": opts.paymentId,
      allow_promotion_codes: "true",
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
    }),
  );
}

export async function retrieveSession(id: string) {
  return stripe(`/checkout/sessions/${id}`, undefined, "GET");
}

/**
 * Refunds a charge. The idempotency key is derived from our payment id, so a
 * retry (job re-run or admin double-click) can never create a second refund.
 */
export async function refundPaymentIntent(
  paymentIntent: string,
  opts?: { idempotencyKey?: string; reason?: string; paymentId?: string },
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env["STRIPE_SECRET_KEY"]!}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const res = await fetch(`${STRIPE_API}/refunds`, {
    method: "POST",
    headers,
    body: form({
      payment_intent: paymentIntent,
      ...(opts?.reason ? { "metadata[buymybio_reason]": opts.reason } : {}),
      ...(opts?.paymentId ? { "metadata[payment_id]": opts.paymentId } : {}),
    }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = json["error"] as { message?: string; code?: string } | undefined;
    // Already refunded in Stripe: treat as success so state converges.
    if (err?.code === "charge_already_refunded") return { id: null, status: "succeeded" };
    throw new Error(err?.message || `Stripe refund error ${res.status}`);
  }
  if (json["status"] === "failed") {
    throw new Error(`Stripe refund failed: ${String(json["failure_reason"] ?? "unknown")}`);
  }
  return json;
}

/** Verifies a Stripe webhook signature using Web Crypto (Workers-safe). */
export async function verifyStripeSignature(payload: string, header: string | null) {
  const secret = await socialBidWebhookSecret();
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET_SOCIAL_BID is not configured");
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)];
    }),
  ) as Record<string, string>;
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  if (diff !== 0) return false;
  // reject events older than 5 minutes
  return Math.abs(Date.now() / 1000 - Number(t)) < 300;
}

/* ------------------------------------------------------------------ Connect */

/** Creates an Express connected account for a creator payout destination. */
export async function createConnectAccount(opts: { email?: string | null; username: string }) {
  return stripe(
    "/accounts",
    form({
      type: "express",
      "capabilities[transfers][requested]": "true",
      "business_profile[name]": `SocialBid — ${opts.username}`,
      "business_profile[product_description]":
        "Sponsored placement on a SocialBid creator profile",
      "metadata[buymybio_username]": opts.username,
      ...(opts.email ? { email: opts.email } : {}),
    }),
  );
}

/** Hosted onboarding/refresh link for a connected account. */
export async function createAccountLink(accountId: string, base: string) {
  return stripe(
    "/account_links",
    form({
      account: accountId,
      refresh_url: `${base}/creator?stripe=refresh`,
      return_url: `${base}/creator?stripe=return`,
      type: "account_onboarding",
    }),
  );
}

export async function retrieveAccount(accountId: string) {
  return stripe(`/accounts/${accountId}`, undefined, "GET");
}

/** Express dashboard link so a creator can see their own payouts. */
export async function createLoginLink(accountId: string) {
  return stripe(`/accounts/${accountId}/login_links`);
}

export async function retrievePaymentIntent(id: string) {
  return stripe(`/payment_intents/${id}`, undefined, "GET");
}

/** Transfers held funds to a connected account. Idempotent per payout id. */
export async function createTransfer(opts: {
  amountCents: number;
  destination: string;
  sourceTransaction?: string | null;
  payoutId: string;
  paymentId: string;
}) {
  const res = await fetch(`${STRIPE_API}/transfers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env["STRIPE_SECRET_KEY"]!}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `bmb_payout_${opts.payoutId}`,
    },
    body: form({
      amount: opts.amountCents,
      currency: "usd",
      destination: opts.destination,
      transfer_group: `bmb_${opts.paymentId}`,
      "metadata[payout_id]": opts.payoutId,
      "metadata[payment_id]": opts.paymentId,
      ...(opts.sourceTransaction ? { source_transaction: opts.sourceTransaction } : {}),
    }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = json["error"] as { message?: string } | undefined;
    throw new Error(err?.message || `Stripe transfer error ${res.status}`);
  }
  return json;
}
