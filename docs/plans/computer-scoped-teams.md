# Separate teams for each computer

Status: staged foundation on `feature/computer-scoped-teams`; not enabled in routes or deployed.

One passkey account may belong to several computers. Team membership, administrator status and ministry responsibility belong to a computer, rather than following the account into every computer. Being an administrator elsewhere, scanning a QR code or joining during a service window cannot implicitly enroll a whole team.

## Added foundation

Migration 0034 adds `role` and nullable `ministry_role` to `station_memberships`. Existing approved nonowners start as members without a ministry responsibility. Legacy account roles remain unchanged for recovery. Existing ownership is an explicit local administrator grant; denied memberships, disconnections and revoked computers are preserved.

`readStationTeamScope` reads one explicit computer/user grant. It denies inactive accounts, inactive owners, revoked computers, disconnections and denied memberships. It never consults account-wide ministry roles or uses a global administrator override. A live approved connection alone does not substitute for lasting membership.

`stationTeamScopeGuard` repeats these conditions, including the captured owner and local role, inside a mutation statement. It protects against stale authorization after a role changes. It is not authentication or a capability check: callers must authenticate the session/operator, check the required local capability, bind the mutation's resource to the captured computer and combine the session/operator lease guard with this predicate in the same statement.

## Rollout work still required

| Area | Required change |
| --- | --- |
| Devices and receivers | List only ownership/approved membership; return local roles/capabilities for the selected computer. |
| Connections and presence | Remove global-admin/setup-window approval shortcuts. Preserve explicit denials and require a local approver. Reapproval must not resurrect a previously denied administrator role. |
| Team directory and administration | Restrict both listing and mutations to the selected computer. Keep profile identity shared, local role changes separate. |
| Native operator proofs | Scope selection, PIN/passkey approval and leases to local membership. Invalidate that computer's proof after local access/role revocation without signing out unrelated computers. |
| Songs and services | Bind reads, edits, comments, readiness and leadership to current computer scope. |
| Tasks and events | Replace global visibility with computer ownership, including attachments and event subscriptions. |
| Groups and shared files | Scope groups, selected members, song links, previews, edits, deletion and object downloads to the computer. Group membership must never grant unrelated computer access. |
| Clients | Add safe computer switching and use the selected computer's capabilities. Clear inaccessible cached data/subscriptions on switching or revocation. |
| Enrollment | Keep a shared account identity, but create only the invited computer's membership. Newly claimed ownership is handled explicitly. |

## Release conditions

Do not deploy this migration as a completed isolation fix. Finish compatible server/client wiring and review role recovery for existing nonowner administrators before activating the new policy. Keep the legacy role data and existing release artifacts intact.

Verification must cover two unrelated computers with different roles for the same identity; unrelated administrators; denial, revocation and disconnection races; attachment/object and event isolation; cached/offline switching; approval/owner recovery; and physical desktop/iPhone/iPad acceptance. Passing the new scope tests alone establishes only the foundation.
