# Creator share cards

## Goal
Add a fresh, automatically rendered 1200×1200 Social Bid announcement card for each publicly listed creator, using the marketplace’s existing creator, listing, rank, value, and sponsor data.

## What will change
- Build one reusable share-card component with a square preview and crisp PNG export.
- Use the stored X avatar through a narrowly restricted image proxy so browser download/copy works without any new X API calls.
- Design the card in Social Bid’s black/white, hard-border market style, with distinct unsponsored “Market entry” and sponsored states.
- Add a “Share your profile” section to the creator dashboard with Download image and Share on X actions.
- Add a “Share card” action to each eligible creator in Admin, opening a dialog with Copy image (when supported), Download image, Copy profile link, and Open on X.
- Reuse the canonical marketplace snapshot for rank, current value, current sponsor, starting price, avatar, and profile URL; no new tables or stored duplicate images.

## Edge cases
- Fit or truncate long display names, usernames, and sponsor names without overflowing.
- Render a bold initials fallback when the stored avatar is missing or fails.
- Show opening bid for unsponsored creators and current value/sponsor for sponsored creators.
- Hide unsupported clipboard-image actions while keeping PNG download available everywhere.

## Technical details
- Render to an HTML canvas at exactly 1200×1200, then export with `canvas.toBlob("image/png")`.
- Keep the preview responsive while preserving the fixed square drawing buffer.
- Open X’s standard compose intent with editable default copy and the creator’s Social Bid URL.
- Extend existing creator/admin responses only with fields already produced by the marketplace source.

## Verification
- Run focused unit tests for text fitting, card copy/state selection, filename/profile URL generation, and avatar fallback behavior.
- Verify production build health.
- Exercise creator and admin card controls in Chromium at desktop and mobile widths, including PNG dimensions and clipboard feature detection.
