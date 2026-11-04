# Desktop service fixes — November 3, 2026

A normal running-order save could introduce a local song before the shared catalog contained its hash. Newly referenced songs now finish catalog publication before the cloud validates the service. Failed catalog publication leaves the saved cache and editor draft intact. Notes-only saves with known references do not rescan the whole library. The server's hash, ownership and revision checks remain unchanged.

Service summaries now reuse the same authoritative plans already fetched for their page, avoiding a second serialized cloud read. This reduces one source of loading delays; it does not claim to eliminate every timeout or retrying legacy import.

Verification: 1,273 desktop tests and typecheck passed. The ProPresenter playlist response still requires inspection on the actual church computer. A loopback URL opened on a different Mac cannot establish that PC's API behavior. Physical Windows acceptance and a new Windows installer remain pending.

Electron was separately patched from 44.7.0 to 44.9.1 for the upstream certificate mitigation. This removes the Electron audit finding; three high and twenty moderate development-tool findings remain under review. The initial dependency-audit document is retained as a dated baseline.
