## Faster Services on Windows

- Services opens while templates and ProPresenter playlist status load separately.
- Creating or updating a service uses the server response directly, and overlapping service reads share one request.
- If a service request finishes after the slow-loading message appears, the list recovers automatically.
- The companion Worker change lets archive and restore retain historical song references when the live catalog changes. This part requires the matching backend rollout.

Unsigned Windows x64 preview. Local packaging and automated checks cover the installer and service workflows. Physical Windows and ProPresenter verification are pending.
