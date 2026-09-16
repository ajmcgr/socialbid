import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — SocialBid" },
      {
        name: "description",
        content:
          "Sponsor a creator on SocialBid. Your message and tracked link stay in the sponsor spot until somebody pays more.",
      },
      { property: "og:title", content: "SocialBid FAQ" },
      {
        property: "og:description",
        content: "Pay more than the current sponsor to take the sponsorship spot. No deadline.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FAQPage,
});

const faqs: [string, string][] = [
  ["What is SocialBid?", "SocialBid lets people sponsor creator profiles on SocialBid."],
  [
    "How does sponsorship work?",
    "Pay the current price to take the sponsor spot. Your message and link go live immediately, and you unlock a direct connection with the creator in your Inbox.",
  ],
  [
    "What happens when I sponsor someone?",
    "Your sponsorship appears on their SocialBid profile and you unlock a direct connection with them in your Inbox. You keep the sponsorship spot until someone outbids you.",
  ],
  ["Where does my sponsor appear?", "On the creator's profile on SocialBid."],
  [
    "How long does a sponsorship last?",
    "Until somebody pays more. There is no fixed sponsorship period and no deadline.",
  ],
  [
    "What happens if I'm outbid?",
    "Your sponsorship spot passes to the new highest bidder, but your Inbox connection stays open. You can continue messaging the creator.",
  ],
  [
    "Does sponsoring someone guarantee a response or collaboration?",
    "No. Sponsorship unlocks a direct connection, but creators aren't required to reply, post, endorse, follow or provide content. Any collaboration you arrange afterwards is separate from the SocialBid sponsorship.",
  ],
  [
    "When do creators get paid?",
    "Creators keep 80% of every sponsorship. Earnings are held for 7 days after purchase as a standard risk and chargeback window, then paid out automatically to their connected Stripe account. Being outbid during that window doesn't affect a payout you've already earned.",
  ],
  [
    "Do I need to change anything on X?",
    "No. Sponsorships appear on SocialBid only. You do not need to change your X profile or take any action on X.",
  ],
  [
    "How long can my sponsored message be?",
    "Up to 100 characters, plus a separate link. Every placement is published with a \u201CSponsored:\u201D label in front of your message.",
  ],
  [
    "Is a placement labelled as an ad?",
    "Yes. SocialBid generates the \u201CSponsored:\u201D label automatically and buyers can't remove or reword it.",
  ],
  [
    "What isn't allowed in a sponsored message?",
    "Messages must be honest advertising. You can't impersonate the creator or anyone else, and you can't promote adult content, illegal goods, malware, scams or hate speech. We moderate messages and destinations.",
  ],
  ["Can I sponsor my own profile?", "No. Creators can't sponsor or outbid their own sponsor spot."],
  [
    "How do refunds work?",
    "If a placement can't be delivered, or a purchase is cancelled for policy or moderation reasons, the payment is automatically refunded in full to the original payment method. Refunds usually appear within 5-10 business days.",
  ],
  ["Can I change my message or link?", "Contact us and we'll update it, subject to moderation."],
  [
    "What links are not allowed?",
    "Adult content, illegal goods, malware, scams, hate speech, or anything abusive.",
  ],
];

function FAQPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <h1 className="text-[clamp(2.5rem,9vw,4.5rem)] leading-[0.88] font-semibold tracking-[-0.05em]">
        FAQ
      </h1>

      <div className="mt-10 grid gap-6 sm:grid-cols-3">
        {[
          [
            "1. Sponsor",
            "Pay the current price. It is set by the last sponsorship plus a minimum increase.",
          ],
          [
            "2. Get featured",
            "Your \u201CSponsored:\u201D message + tracked link goes live instantly, and a direct Inbox connection unlocks.",
          ],
          [
            "3. Get outbid",
            "Someone takes the sponsor spot, but your Inbox connection with the creator stays open.",
          ],
        ].map(([t, d]) => (
          <div key={t} className="panel px-5 py-6">
            <div className="text-lg font-semibold">{t}</div>
            <p className="mt-2 text-sm text-muted-foreground">{d}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-16 text-2xl font-semibold">Questions</h2>
      <div className="panel mt-4 divide-y-2 divide-border">
        {faqs.map(([q, a]) => (
          <div key={q} className="px-5 py-4">
            <h3 className="font-semibold">{q}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{a}</p>
          </div>
        ))}
      </div>

      <Link to="/" className="btn-ink btn-ink-hover mt-12">
        See creator profiles
      </Link>
    </div>
  );
}
