# Fix admin session restoration

## Changes
- Preserve compatible previously saved sign-in sessions when the browser auth client initializes.
- Make `/admin` resolve the saved session once, then react only to real sign-in and sign-out events so an empty startup event cannot overwrite a valid session.
- Keep the existing server-side admin-role check unchanged.

## Validation
- Verify signed-out users still receive a sign-in prompt.
- Verify a restored signed-in session reaches the admin-role check and loads admin data.
- Run the focused checks and confirm the preview build is healthy.
