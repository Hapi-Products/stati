# Initial source dependency audit

Checked November 3, 2026 against the committed npm lockfile. This records known risks in the imported source; it is not a security certification or a new binary release.

`npm audit --omit=dev` reported zero advisories. The complete audit reported 24 findings: 4 high and 20 moderate, with no critical findings. The runtime-only result does **not** cover the Electron executable: Electron is a development dependency used to build and run the Windows app.

| Affected path | Reachability and disposition |
| --- | --- |
| Electron 44.7.0 | Distributed desktop runtime. The audit reports the eMudhra certificate mitigation advisory, fixed in 44.9.1. Upgrade and validate the desktop before issuing a new Windows binary. The initial public source preserves the preview-39 dependency baseline. |
| Undici 7.30.0 | Transitive Cloudflare development/test/deployment tooling. The audit reports TLS, redirect and denial-of-service advisories fixed in 7.30.1. Review the parent-tool update and lockfile before the next release. It is not bundled into the Worker as an application dependency. |
| `@cloudflare/vitest-plugin` 1.4.0 / nested Zod 4.6.5 | Test tooling; nested Zod is affected by constrained-collection memory exhaustion. The application dependency already pins Zod 4.6.6 or later. Update the test tool with a verified compatible graph. |
| Remaining moderate findings | Development/build tool paths, including inherited parent advisories. Review with the corresponding tool updates; do not use a forced bulk dependency rewrite. |

Review these deferrals before the next binary/deployment batch (target review: November 4, 2026). Publishing source does not resolve these advisories. Do not distribute newly built binaries as security-reviewed based solely on the runtime-only npm audit.

The source secret scan used Gitleaks 8.30.1. Its single initial finding was the fixed synthetic enrollment key in `vitest.config.ts`; that exact test-only line is annotated. The final staged scan reported zero unsuppressed findings. Private environment files, signing keys, local databases, account exports, device captures and generated installers are excluded. Automated scanning does not prove the absence of every secret or vulnerability.
