# Initial public source verification

November 3, 2026. The public copy was installed from its committed npm lockfile with dependency scripts disabled.

| Check | Result |
| --- | --- |
| TypeScript typecheck | Passed |
| Node desktop tests | 1,269 passed |
| Worker/backend tests | 749 passed across 46 files |
| Native Foundation tests | 97 passed across 33 suites |
| Website production asset build | Passed |
| Windows companion UI asset build | Passed |
| Staged-source secret scan | Zero unsuppressed findings; fixed synthetic test key narrowly annotated |
| npm runtime dependency audit | Zero advisories; Electron is excluded from this particular view |
| Complete npm audit | 24 advisories recorded in `dependency-audit.md` |

The initial authentication test harness needed module resolution for newer TypeScript imports, an isolated live-event transport stub, and its old closed-screen heading updated to the existing invite-code heading. Its passkey, guest, mobile-code and account-navigation checks remain enabled. No production authentication behavior was changed for source publication.

The native tree is the canonical build-24 source. The iOS project and assets preserve that build's source hashes, apart from added public documentation. The initial import does not include the unfinished build-25 nearby transport work or historical duplicate source files.

No Windows installer, Android binary, signed native app or production deployment was created by source publication. Physical Windows/ProPresenter 7.11 behavior, device battery use and a comprehensive application security audit remain separate checks. Existing released artifacts are preserved.
