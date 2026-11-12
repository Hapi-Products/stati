# Development and distribution

The public repository contains source for the Windows companion, website/backend, native iPhone/iPad development app and Android web wrapper. Its initial source snapshot uses Windows preview 39 and native build 24. See the root README for commands and known verification limits.

## Safe local setup

Install with `npm ci --ignore-scripts`. Worker tests use local Cloudflare bindings and synthetic accounts. Apply local migrations with `npm run db:local`; this must not be replaced with a remote migration command while testing. Deployment commands and account-provisioning tools can modify a real configured instance; inspect their arguments and target first.

For Electron execution, review `node_modules/electron/install.js`, then run that specific installation script. The desktop UI assets are regenerated from locked dependencies and the hash-checked vendored OCR data. They are intentionally absent from Git.

The iOS project has canonical source files and a reproducible generator. Use a matching Xcode toolchain and your own signing team. Simulator sample routes are compiled only for review/debug simulation and are not production authentication or delivery tests. Keep generated products outside the source tree.

## Self-hosting

Create independent Cloudflare resources, replace the placeholder database ID, set the D1/R2/TaskEvents bindings and configure the production domain, `APP_ORIGIN` and `RP_ID` together. Set secrets using Wrangler's secret workflow rather than committing them. Apply all migrations to the intended database. Configure client origins and Android domain association for your instance. The repository contains no production user database or uploaded song library.

Publishing scripts target the original project's existing release locations. Fork maintainers must change publisher destinations and signing identity before using them. Do not republish under the original package identity or overwrite upstream release assets.

## Validation boundaries

Node, Worker and Foundation test results establish only the tested behavior. Physical Windows/PowerPoint/ProPresenter behavior, mobile background delivery, near-device synchronization, battery use and production signing require separate validation. The experimental nearby/offline reader work is not part of the initial released native source snapshot.

Historical personal screenshots, internal runbooks, local credentials, caches and prebuilt installers are excluded from the public tree. Vendor provenance and fixture notices are preserved. A secret scan does not replace an application security audit.


## Maintain the user wiki

Keep source pages in `docs/wiki/` and publish the matching Markdown pages to the [Stați GitHub Wiki](https://github.com/Hapi-Products/stati/wiki). The wiki has its own Git history.

For a user-facing update, change the relevant shared guide or platform page and add an entry to Updates. Set **Updated on** to the edit date and **Updated by** to the person or team that made the edit. Identify the build and its distribution status. Keep a shared procedure on the shared page and link to it from individual devices.

Clone `https://github.com/Hapi-Products/stati.wiki.git` into a separate checkout. Pull the current wiki branch, copy the changed Markdown pages, review the diff for any edits made directly in GitHub, and push the new commit to the wiki's default branch. Open the changed public pages and confirm they render. When adding a help entry inside an app, use the corresponding page's stable wiki URL.
