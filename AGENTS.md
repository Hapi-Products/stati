# Stați contributor instructions

- Preserve existing accounts, uploads, drafts, public URLs and published artifacts.
- Keep Windows, web, iPhone/iPad and Android verification scopes distinct. A local test or cross-platform build is not physical-device acceptance or proof of production signing.
- Mac application development is paused.
- Run checks appropriate to the changed component before publishing. Do not overwrite existing release artifacts.
- Never commit credentials, private keys, enrollment codes, account data or personal screenshots. Use synthetic fixtures.
- Keep service song hashes, ownership checks, authorization and idempotent delivery receipts intact when fixing bugs.
- Use Wrangler for this Cloudflare project because it has `wrangler.jsonc`.
- Review dependency installation scripts before executing them. Use the committed lockfile.
