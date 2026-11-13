# Service build hold

Updated November 12, 2026 by Codex for Stați.

Before publishing an installer or deploying the Worker, the release tools require a fresh positive answer from the production build-status endpoint. Do not publish or install when the answer is negative or unavailable. Keep local builds and simulator verification separate from releases.

The Worker holds releases during a configured church service, while a nonarchived plan is selected on a paired computer, or while a Stați administrator has paused builds from iPhone Send. A manual resume cannot clear a service hold. Clear a selected plan with **None · Lyrics only** on the computer after service. A hold does not affect file sending. Check again on a new attempt; the tool does not automatically publish when a hold clears.

Use the guarded commands for GitHub previews, test downloads, production deployment, and physical Apple preview installs. Desktop in-app updates check before shutting down the receiver. Other distribution channels and already-installed older desktop apps cannot be controlled by these scripts.

## First deployment

The old production Worker has no status endpoint, so the normal guard blocks until the endpoint is installed. For the first deployment only, verify that it is outside the current production church schedule, that the production database has no nonarchived selected service on a paired computer with an active owner, and that the manual pause setting is clear. Recheck immediately before deploying. If any condition is unknown or blocked, defer. Verify the endpoint responds with a valid current decision before using the guarded install or publish scripts. No database migration is required. The manual pause is stored in the existing settings table and its changes are recorded in the audit log.
