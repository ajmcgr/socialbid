# Standardize the SocialBid brand name

## Scope
- Audit all case variants of the brand across product copy, metadata, generated shares, emails, and supporting public documentation.
- Change customer-visible `Social Bid` references to `SocialBid` while preserving lowercase domains, URLs, routes, code identifiers, database names, and historical migrations.
- Leave creator-authored data and archived plans untouched, documenting any remaining exact matches.

## Verification
- Re-scan exact and lowercase variants after edits.
- Confirm every `socialbid.co` URL and API/route path remains unchanged.
- Run the share-card tests, full tests, typecheck, lint, and production build.
- Report changed files, the exact replacement count, remaining occurrences with reasons, and any ambiguity.

## Technical details
- Apply edits only to files classified as containing public product copy or tests that assert that copy.
- Do not alter business logic, schemas, migrations, identifiers, or behavior.
