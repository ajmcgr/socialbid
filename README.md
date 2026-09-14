# SocialBid

SocialBid is a marketplace for creator sponsorships at [socialbid.co](https://socialbid.co).

Creators connect X to confirm their identity and add a public profile. Sponsors bid for the
disclosed sponsorship spot on that creator's SocialBid page. The current sponsor keeps the spot
until somebody pays more.

Sponsorship appears on SocialBid only. Nothing is posted to X, and creators never need to take
an action on X after connecting their account.

## Product rules

- Creators receive 80% of a completed sponsorship and SocialBid retains 20%.
- Creator payouts are held for seven days before release.
- A new bid replaces the current sponsor without changing historical sponsorship or click records.
- Guest sponsorship is supported.
- X is used for identity and public profile data only; the application has no X write actions.

## Development

```bash
npm install
npm run dev
```

Run checks before deployment:

```bash
npm run lint
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

## Production configuration

Set `APP_BASE_URL=https://socialbid.co`. The public routes used by external services are:

- X OAuth callback: `https://socialbid.co/api/public/x-callback`
- Stripe webhook: `https://socialbid.co/api/public/stripe-webhook`
- Payout release cron: `POST https://socialbid.co/api/public/release-payouts`

The legacy `bmb_*` cookie, local-storage, Stripe metadata, and idempotency-key identifiers are
intentionally retained for compatibility with existing sessions, payments, and payouts.
