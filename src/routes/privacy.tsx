import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — SocialBid" },
      {
        name: "description",
        content: "What SocialBid collects, why, and how click tracking works.",
      },
      { property: "og:title", content: "Privacy Policy — SocialBid" },
      { property: "og:description", content: "What we collect and how click tracking works." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <article className="mx-auto max-w-2xl space-y-4 px-5 py-14 text-sm leading-relaxed">
      <h1 className="text-3xl font-extrabold">Privacy Policy</h1>
      <p>
        We collect the email, company name, and destination URL you provide at checkout so we can
        deliver your sponsorship and contact you when you're outbid.
      </p>
      <p>
        When someone follows a sponsor link we record the timestamp, referrer, and a one-way hash of
        the visitor's IP address and user agent. We use the hash only to estimate unique clicks; we
        cannot reverse it and we do not store raw IP addresses.
      </p>
      <p>Payments are handled by Stripe under their privacy policy. We never see card details.</p>
      <p>Email to buyers and creators is sent through Resend.</p>
      <p>Email us to request deletion of your buyer record.</p>
    </article>
  ),
});
