import { SPONSOR_PREFIX } from "./placement";
import { baseUrl } from "./db.server";
import { isDeliverableEmail } from "./validate";

const FROM = "SocialBid <alex@socialbid.co>";
// Use the actual PNG artwork with its white canvas. The similarly named
// `social-bid-logo.png` is a transparent WebP file, which some email clients
// composite against a dark surface.
const LOGO_URL = `${baseUrl()}/socialbid-logo.png`;

type SendOptions = { idempotencyKey?: string; throwOnFailure?: boolean; replyTo?: string };
export type EmailSendResult = { sent: true; providerId: string | null };

async function send(
  to: string,
  subject: string,
  html: string,
  options: SendOptions = {},
): Promise<EmailSendResult | { sent: false }> {
  const key = process.env["RESEND_API_KEY"];
  if (!key || !isDeliverableEmail(to)) {
    const error = new Error(
      !key ? "RESEND_API_KEY is not configured" : "email recipient is missing or invalid",
    );
    if (options.throwOnFailure) throw error;
    console.error("resend skipped", { reason: !key ? "not_configured" : "invalid_recipient" });
    return { sent: false };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject,
        html,
        ...(options.replyTo && isDeliverableEmail(options.replyTo)
          ? { reply_to: options.replyTo }
          : {}),
      }),
    });
    const body = (await response.json().catch(() => null)) as {
      id?: unknown;
      message?: unknown;
      name?: unknown;
    } | null;
    if (!response.ok) {
      const providerMessage =
        typeof body?.message === "string"
          ? body.message
          : typeof body?.name === "string"
            ? body.name
            : "no provider message";
      throw new Error(`Resend returned HTTP ${response.status}: ${providerMessage}`);
    }
    return { sent: true, providerId: typeof body?.id === "string" ? body.id : null };
  } catch (e) {
    console.error("resend failed", e);
    if (options.throwOnFailure) throw e;
    return { sent: false };
  }
}

const money = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

function shell(
  body: string,
  footNote = "You received this because you sponsored a creator on SocialBid.",
) {
  return `<div style="background:#f6f7f9;padding:40px 16px;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e8eb;border-radius:4px">
    <tr><td align="center" bgcolor="#ffffff" style="background:#ffffff;padding:36px 32px;border-bottom:1px solid #e6e8eb">
      <img src="${LOGO_URL}" alt="SocialBid" width="180" height="67" style="display:block;width:180px;height:67px;max-width:100%;border:0;outline:none;text-decoration:none" />
    </td></tr>
    <tr><td style="padding:40px 40px 44px;color:#1c1f23;font-size:17px;line-height:1.6">
      ${body}
    </td></tr>
    <tr><td align="center" style="padding:24px 32px;border-top:1px solid #e6e8eb;color:#8b9096;font-size:14px">
      ${footNote}
    </td></tr>
  </table>
</div>`;
}

function h1(text: string) {
  return `<h1 style="font-size:30px;line-height:1.2;font-weight:600;letter-spacing:-0.02em;margin:0 0 20px;color:#111418">${text}</h1>`;
}

function p(text: string) {
  return `<p style="margin:0 0 20px;color:#3c4149;font-size:17px;line-height:1.6">${text}</p>`;
}

function facts(rows: Array<[string, string]>) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f6f7f9;border:1px solid #e6e8eb;border-radius:6px;padding:0;margin:0 0 28px;width:100%">
    <tr><td style="padding:20px 22px">
      ${rows
        .map(
          ([k, v]) =>
            `<div style="font-size:16px;line-height:2;color:#3c4149"><span style="color:#8b9096">${k}</span> &nbsp;<b style="color:#111418">${v}</b></div>`,
        )
        .join("")}
    </td></tr>
  </table>`;
}

function button(href: string, label: string) {
  return `<a href="${href}" style="display:inline-block;background:#206dcb;color:#ffffff;text-decoration:none;padding:14px 26px;font-weight:600;font-size:16px;border-radius:6px">${label}</a>`;
}

function textLink(href: string, label: string) {
  return `<div style="margin-top:20px"><a href="${href}" style="color:#206dcb;text-decoration:none;font-size:16px">${label}</a></div>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character]!;
  });
}

export async function sendContactEmail(o: {
  name: string;
  email: string;
  subject: string | null;
  message: string;
  idempotencyKey: string;
}) {
  const subject = o.subject?.trim() || "New enquiry";
  const content = [
    ["Name", o.name],
    ["Email", o.email],
    ["Subject", subject],
  ] as Array<[string, string]>;
  return send(
    "alex@socialbid.co",
    `SocialBid contact: ${subject}`,
    shell(
      `${h1("New contact enquiry")}${facts(
        content.map(([label, value]) => [label, escapeHtml(value)]),
      )}<p style="margin:0;color:#3c4149;font-size:17px;line-height:1.6;white-space:pre-wrap">${escapeHtml(o.message)}</p>`,
      "This message was sent from the SocialBid contact form.",
    ),
    { idempotencyKey: o.idempotencyKey, replyTo: o.email, throwOnFailure: true },
  );
}

export function humanDuration(from: string, to: string) {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export async function sendWinnerEmail(o: {
  to: string;
  handle: string;
  username: string;
  amountCents: number;
  destination: string;
  company: string;
  ownershipId: string;
  globalRank?: number | null;
  idempotencyKey?: string;
  throwOnFailure?: boolean;
}) {
  const link = `${baseUrl()}/u/${o.username}`;
  const share = `${baseUrl()}/own/${o.ownershipId}`;
  const tweet = `https://x.com/intent/post?text=${encodeURIComponent(
    `I just sponsored @${o.handle} on SocialBid for ${money(o.amountCents)}.`,
  )}&url=${encodeURIComponent(share)}`;
  return send(
    o.to,
    o.globalRank === 1 ? `You hold the #1 sponsorship on SocialBid.` : `You sponsor @${o.handle}.`,
    shell(`
      ${h1(o.globalRank === 1 ? "You hold the #1 sponsorship." : "Your sponsorship is live \u{1F389}")}
      ${p(`Your payment went through — <b>${o.company}</b> now sponsors <b>@${o.handle}</b> on SocialBid, and the spot stays yours until somebody pays more.`)}
      ${facts([
        ["You paid", money(o.amountCents)],
        ...(o.globalRank
          ? ([["Global rank", `#${o.globalRank} most valuable`]] as Array<[string, string]>)
          : []),
        ["Your startup", o.company],
        ["Destination", o.destination],
        ["Status", "Current sponsor"],
      ])}
      ${button(link, "View your profile \u2192")}
      ${textLink(tweet, "Share it on X \u2192")}
    `),
    {
      ...(o.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : {}),
      ...(o.throwOnFailure !== undefined ? { throwOnFailure: o.throwOnFailure } : {}),
    },
  );
}

export async function sendOutbidEmail(o: {
  to: string;
  handle: string;
  username: string;
  paidCents: number;
  newPriceCents: number;
  duration: string;
  clicks: number;
  lostNumberOne?: boolean;
  newOwner?: string;
  takeoverAmountCents?: number;
}) {
  const link = `${baseUrl()}/u/${o.username}`;
  await send(
    o.to,
    o.lostNumberOne ? "You lost the #1 sponsorship." : "You've been outbid.",
    shell(`
      ${h1(o.lostNumberOne ? "You lost the #1 sponsorship." : "Someone paid more")}
      ${p(
        o.lostNumberOne
          ? `<b>${o.newOwner ?? "Someone"}</b> just took the #1 sponsorship for @${o.handle} at ${money(o.takeoverAmountCents ?? 0)}. You can take #1 back at any time.`
          : `Your sponsor spot on <b>@${o.handle}</b>'s SocialBid profile was just taken. You can take it back at the new price at any time.`,
      )}
      ${facts([
        ["You paid", money(o.paidCents)],
        ["New price", money(o.newPriceCents)],
        ["You sponsored for", o.duration],
        ["Clicks received", o.clicks.toLocaleString()],
      ])}
      ${button(link, `Take it back \u2014 ${money(o.newPriceCents)}`)}
    `),
  );
}

/* ------------------------------------------- lifecycle / money notifications */

const REFUND_COPY: Record<string, { title: string; body: string }> = {
  creator_failed_to_activate: {
    title: "Sponsorship couldn't go live",
    body: "Your sponsorship couldn't go live, so your payment has been refunded.",
  },
  outbid_before_activation: {
    title: "Someone paid first",
    body: "Another buyer took the spot before your sponsorship went live, so your payment has been refunded.",
  },
  creator_removed_active_placement: {
    title: "Placement was removed",
    body: "Your sponsored placement was removed from SocialBid, so your payment has been refunded.",
  },
  concurrent_purchase_conflict: {
    title: "Your purchase couldn't be completed",
    body: "Another payment landed first and took the slot, so your payment has been refunded.",
  },
};

export async function sendRefundEmail(o: { to: string; amountCents: number; reason: string }) {
  const copy = REFUND_COPY[o.reason] ?? REFUND_COPY["creator_failed_to_activate"]!;
  await send(
    o.to,
    copy.title,
    shell(`
      ${h1(copy.title)}
      ${p(copy.body)}
      ${facts([
        ["Refunded", money(o.amountCents)],
        ["Status", "Refund issued"],
      ])}
      ${p("Your bank or card provider may take additional time to show the refund.")}
      ${button(baseUrl(), "Browse profiles \u2192")}
    `),
  );
}

export async function sendBuyerAwaitingActivationEmail(o: {
  to: string;
  handle: string;
  amountCents: number;
  message: string | null;
  destination: string;
}) {
  await send(
    o.to,
    "Your sponsorship is live on SocialBid",
    shell(`
      ${h1("Purchase successful")}
      ${p(`You sponsored <b>@${o.handle}</b> on SocialBid. Your placement is published on SocialBid only.`)}
      ${facts([
        ["You paid", money(o.amountCents)],
        ["Your placement", o.message ? `${SPONSOR_PREFIX} ${o.message}` : "\u2014"],
        ["Your link", o.destination],
        ["Status", "Live on SocialBid"],
      ])}
    `),
  );
}

export async function sendCreatorActionRequiredEmail(o: {
  to: string;
  amountCents: number;
  message: string | null;
  destination: string;
  deadline: string;
}) {
  await send(
    o.to,
    "New sponsor on your SocialBid profile",
    shell(
      `
      ${h1("You have a new sponsor")}
      ${p("Somebody just sponsored your SocialBid profile. Their message and link are live now.")}
      ${facts([
        ["Sponsorship", money(o.amountCents)],
        ["Sponsored message", o.message ? `${SPONSOR_PREFIX} ${o.message}` : "\u2014"],
        ["Destination", o.destination],
        ["Status", "Live on SocialBid"],
      ])}
      ${button(`${baseUrl()}/creator`, "Open your dashboard \u2192")}
    `,
      "You received this because you added your profile to SocialBid.",
    ),
  );
}

export async function sendPlacementVerifiedEmail(o: {
  to: string;
  audience: "buyer" | "creator";
  handle: string;
  eligibleDate?: string | null;
  idempotencyKey?: string;
  throwOnFailure?: boolean;
}) {
  const buyer = o.audience === "buyer";
  return send(
    o.to,
    buyer ? "Your sponsorship is live" : "Your profile has a new sponsor",
    shell(`
      ${h1(buyer ? "Your sponsorship is live" : "Your profile has a new sponsor")}
      ${p(
        buyer
          ? `Your sponsored spot on <b>@${o.handle}</b>'s SocialBid profile is active. It's yours until somebody pays more.`
          : `The sponsorship is live on your SocialBid profile.${
              o.eligibleDate ? ` Eligible for payout after ${o.eligibleDate}.` : ""
            }`,
      )}
      ${button(`${baseUrl()}/u/${o.handle}`, "View the profile \u2192")}
    `),
    {
      ...(o.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : {}),
      ...(o.throwOnFailure !== undefined ? { throwOnFailure: o.throwOnFailure } : {}),
    },
  );
}

export async function sendListingSuspendedEmail(o: { to: string; reason: string }) {
  await send(
    o.to,
    "Your profile is suspended",
    shell(
      `
      ${h1("Profile suspended")}
      ${p(`Your SocialBid profile was suspended (${o.reason}). Open your dashboard for details.`)}
      ${button(`${baseUrl()}/creator`, "Open your dashboard \u2192")}
    `,
      "You received this because you added your profile to SocialBid.",
    ),
  );
}

export async function sendPlacementMismatchWarningEmail(o: { to: string; reason: string }) {
  await send(
    o.to,
    "Action needed: your sponsored placement doesn't match",
    shell(
      `
      ${h1("Review your sponsored placement")}
      ${p(`Your SocialBid placement needs review (${o.reason}). Open your dashboard for details.`)}
      ${button(`${baseUrl()}/creator`, "Open your dashboard \u2192")}
    `,
      "You received this because you added your profile to SocialBid.",
    ),
  );
}

export async function sendPayoutReleasedEmail(o: { to: string; amountCents: number }) {
  await send(
    o.to,
    "Your payout is on its way",
    shell(
      `
      ${h1("Payout released")}
      ${p("We've sent your earnings to your connected Stripe account. Your bank may take additional time to show it.")}
      ${facts([["Amount", money(o.amountCents)]])}
      ${button(`${baseUrl()}/creator`, "Open your dashboard \u2192")}
    `,
      "You received this because you added your profile to SocialBid.",
    ),
  );
}

export async function sendListingActivationReminderEmail(o: {
  to: string;
  displayName: string;
  startingPriceCents: number;
  idempotencyKey: string;
}) {
  return send(
    o.to,
    "Your SocialBid profile isn't live yet",
    shell(
      `
      ${h1("One click and you're live")}
      ${p(`Hi ${o.displayName} — your X account is connected, but your profile still isn't showing in the SocialBid rankings, so sponsors can't sponsor you yet.`)}
      ${facts([["Opening sponsorship price", money(o.startingPriceCents)]])}
      ${button(`${baseUrl()}/creator`, "Add my profile \u2192")}
      ${p("Nothing changes on X. Sponsorships only appear on SocialBid, and you keep 80% of every sponsorship.")}
    `,
      "You received this because you connected your X account to SocialBid.",
    ),
    { idempotencyKey: o.idempotencyKey },
  );
}

export async function sendPayoutSetupReminderEmail(o: {
  to: string;
  amountCents: number;
  idempotencyKey: string;
}) {
  return send(
    o.to,
    "You have earnings waiting — connect your payout account",
    shell(
      `
      ${h1("Your earnings are waiting")}
      ${p("You've earned money from sponsorships on SocialBid, but we can't send it until your payout account is connected. It takes about two minutes.")}
      ${facts([["Waiting to be paid", money(o.amountCents)]])}
      ${button(`${baseUrl()}/creator`, "Connect payouts \u2192")}
      ${p("Once connected, held payouts are released automatically after their standard 7-day hold.")}
    `,
      "You received this because you added your profile to SocialBid.",
    ),
    { idempotencyKey: o.idempotencyKey },
  );
}

export async function sendMagicLinkEmail(o: {
  to: string;
  actionLink: string;
  idempotencyKey: string;
}) {
  return send(
    o.to,
    "Sign in to SocialBid",
    shell(
      `
      ${h1("Sign in to SocialBid")}
      ${p("Use this secure one-time link to sign in. It expires soon and can only be used once.")}
      ${button(o.actionLink, "Sign in to SocialBid \u2192")}
      ${p("If you didn't request this link, you can ignore this email.")}
    `,
      "You received this because a passwordless sign-in was requested for SocialBid.",
    ),
    { idempotencyKey: o.idempotencyKey, throwOnFailure: true },
  );
}

export async function sendSignInMethodLinkEmail(o: {
  to: string;
  actionLink: string;
  idempotencyKey: string;
}) {
  return send(
    o.to,
    "Confirm your SocialBid sign-in email",
    shell(
      `
      ${h1("Confirm your sign-in email")}
      ${p("Use this secure one-time link to add this email as a sign-in method for your existing SocialBid account.")}
      ${button(o.actionLink, "Confirm email \u2192")}
      ${p("This link expires in 30 minutes. If you didn't request it, you can ignore this email.")}
    `,
      "You received this because an email sign-in method was requested for SocialBid.",
    ),
    { idempotencyKey: o.idempotencyKey, throwOnFailure: true },
  );
}

export async function sendBuyerRecoveryEmail(o: {
  to: string;
  company: string;
  actionLink: string;
  idempotencyKey: string;
}) {
  return send(
    o.to,
    "Recover your SocialBid sponsorships",
    shell(
      `
      ${h1("Confirm your sponsorship history")}
      ${p(`Use this one-time link to attach <b>${escapeHtml(o.company)}</b> and its eligible sponsorship conversations to the SocialBid account that requested recovery.`)}
      ${button(o.actionLink, "Recover sponsorships \u2192")}
      ${p("This link expires in 30 minutes. If you didn't request it, you can ignore this email.")}
    `,
      "You received this because sponsorship recovery was requested on SocialBid.",
    ),
    { idempotencyKey: o.idempotencyKey, throwOnFailure: true },
  );
}
