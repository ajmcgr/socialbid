# Bio-first Market Entry share copy

## What will change
- Update the existing five Market Entry templates so a stored creator bio is always the first paragraph.
- Keep five randomized variations, changing only the status and sponsorship language after the bio.
- Use the existing global rank in the rank-specific variation; use “Who wants the spot? 👀” when no rank is available.
- Preserve the current non-bio openings as fallbacks only when no stored bio exists.

## Safety and limits
- Reuse the stored X bio already passed to creator and admin share cards; make no X API requests.
- Normalize whitespace without rewriting wording.
- Truncate only the bio, at a safe boundary with an ellipsis, so the required handle, bid, CTA, and profile URL remain intact.
- Keep the existing random-per-click and X URL-encoding behavior.

## Verification
- Expand generator tests across all five templates for normal, short, long, multiline, emoji, @mention, URL, and missing bios.
- Assert bio-first ordering, exact wording preservation, dynamic bids and rank fallback, paragraph spacing, and the X character limit.
- Run focused tests and confirm the preview build remains clean.
