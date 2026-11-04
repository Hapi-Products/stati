## One workspace, a compact library, and simpler planning

- Prepare, Library and Services now open inside the main Windows window. Editor drafts stay available while navigating and restore on reopening; switching profiles clears the previous person's in-memory workspace.
- The rebuilt song library starts with compact rows, small real slide thumbnails and a selected-song preview. Original songs and named group versions remain separate. Search, version selection, favorites where permitted, and a distinct grid view remain available; language and folder filters are removed.
- The website shares the new neutral layout, with compact phone rows, familiar bottom navigation and status/refresh beside the profile. Online, offline and blocked access have distinct indicators.
- Services support dragging library songs into the running order and reordering with the same pointer handles. Keyboard/menu and add-button alternatives remain available. Date/time fields handle native input and change events, preserve partial edits locally and save only a valid complete schedule. A service editor replaces the index while open, and new-service forms close after creation.
- Tasks use collapsible status sections. Dropping on a closed section changes status without expanding it. Details autosave; status uses a selector, urgent uses an icon, and author information includes the available profile photo or initials. Authors and administrators can remove tasks and comments with Undo.
- Mobile team roles use an accessible full-size native selector over a compact icon. Account controls are spaced consistently; computer rows use small icon actions and the account ID moves to the bottom.
- Only administrators rename computers. Disconnecting a computer in Account removes that person's access, preserving the station and other members' access. Server checks cover session expiry, role changes and concurrent requests.
- Every active role can create new slides from an authenticated Windows profile. Existing-song editing and synchronization retain their separate permissions. Phone slide creation remains unavailable.
- Song requests can contain typed lyrics or supported files for operator review. Typed lyrics use the same immutable upload intent, checksum and receipt-reconciliation path as other files. Clearing completed upload history hides that person's history without deleting saved files or interrupting pending delivery/retry.
- PowerPoint tools are accessible beside Switch User. The home screen shows linked-song attention rather than a long history; pair lists and recent changes are collapsed. Conversion remains manual and confirmed. Native errors retain their useful explanation without Electron IPC boilerplate.
- The ProPresenter playlist reader no longer requires unused group-heading identifiers, while concrete playlist names/UUIDs and ownership checks remain strict. The connection check now also reads the playlist list. Unsupported responses stop with a useful message; no playlist is replaced to work around a schema error.

### Preservation and acceptance

The published Preview 37 and the pre-rebuild unfinished source are preserved separately. Previously published installers remain unchanged.

Local automated suites and browser checks cover isolated data, API behavior, draft recovery, date/time persistence, service drag/reordering, task autosave and reversible deletion. They do not establish physical Windows/PowerPoint/ProPresenter 7.11 or phone/iPad acceptance. The original playlist-tree error still needs confirmation against the church PC's real response. Audio Playback handoff remains a reviewed manual import; prepared files are not reported as imported automatically.

This is an unsigned Windows preview. Production signing and physical equipment/output routing remain separate acceptance gates. Mac development and the proposed fourth output remain paused. Shared group files remain the tablet scope.
