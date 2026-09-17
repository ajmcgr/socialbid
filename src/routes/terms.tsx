import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — SocialBid" },
      {
        name: "description",
        content: "The rules for sponsoring creator profiles on SocialBid.",
      },
      { property: "og:title", content: "Terms of Service — SocialBid" },
      { property: "og:description", content: "The rules for sponsoring creator profiles." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <article className="mx-auto max-w-2xl space-y-4 px-5 py-14 text-sm leading-relaxed">
      <h1 className="text-3xl font-extrabold">Terms of Service</h1>
      <p>
        SocialBid lets buyers purchase a <b>disclosed sponsor spot</b> on a creator's SocialBid
        profile. Your message and tracked link remain on that profile until another buyer pays more.
        There is no minimum sponsorship period or guaranteed duration.
      </p>
      <p>
        Sponsorships are displayed and managed on SocialBid only. Nothing is published on X, and
        creators do not need to take any action on X.
      </p>
      <p>
        Every placement is labelled “Sponsored”. Buyers may not remove, alter or obscure that label,
        and a placement without it is treated as non-compliant.
      </p>
      <p>
        Sponsored messages must be honest advertising. You may not impersonate the creator, Social
        Bid or any other person or brand, or misrepresent the placement as a personal endorsement.
      </p>
      <p>
        Placements must comply with applicable advertising rules. SocialBid may suspend a profile or
        cancel a placement that breaches those rules.
      </p>
      <p>SocialBid is not affiliated with or endorsed by X.</p>
      <p>
        All payments are final except where two payments race for the same takeover; the losing
        payment is refunded in full and automatically.
      </p>
      <p>
        Messages and destinations are moderated. Adult content, illegal goods or services, malware,
        phishing, scams, and hate speech are prohibited and will be disabled without refund.
      </p>
      <p>
        Creators may pause a profile or reject a destination. If a profile is permanently removed
        while your sponsorship is active, you'll receive a pro-rated refund at our discretion.
      </p>
      <p>Payments are processed by Stripe. We never store card details.</p>
    </article>
  ),
});
