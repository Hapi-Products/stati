# Stați contributor instructions

- Preserve existing accounts, uploads, drafts, public URLs and published artifacts.
- Keep Windows, web, iPhone/iPad and Android verification scopes distinct. A local test or cross-platform build is not physical-device acceptance or proof of production signing.
- MacBook companion development is authorized again as of November 3, 2026. Prioritize Windows fixes, reuse the shared desktop interface, and distinguish local ad-hoc previews from notarized releases.
- Run checks appropriate to the changed component before publishing. Do not overwrite existing release artifacts.
- Before releasing builds, deploying to production, or installing on a physical device, run `node scripts/check-build-release.mjs` from the current main checkout and stop if the check does not pass. Use that checkout’s `scripts/install-apple-preview.mjs` for physical Apple previews. Local builds, simulator testing, and source or wiki edits may continue.
- Never commit credentials, private keys, enrollment codes, account data or personal screenshots. Use synthetic fixtures.
- Keep service song hashes, ownership checks, authorization and idempotent delivery receipts intact when fixing bugs.
- Use Wrangler for this Cloudflare project because it has `wrangler.jsonc`.
- Review dependency installation scripts before executing them. Use the committed lockfile.

- With each user-visible Stați update, edit the relevant platform or shared guide in `docs/wiki/` and the Updates page in the same change. Record **Updated on** and **Updated by** on each changed page and label preview or unverified behavior accurately. Publish the verified pages to the GitHub Wiki and check the public URLs. Keep new in-app help topics linked to their matching guide.
- For a new iPhone or iPad build, update `AppUpdate.current` and move the previous entry to history before regenerating the Xcode project. Verify the new What’s New entry in the built app.
