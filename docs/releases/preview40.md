## More reliable service saves and loading

- New local songs added to a running order finish sharing their catalog references before the service is saved. A failed catalog upload preserves the draft and previous cached service.
- Notes-only autosaves with unchanged songs avoid rescanning the library.
- Service status uses the same authoritative running order as the page, removing a duplicate queued cloud read.
- The desktop runtime includes Electron 44.9.1's certificate mitigation.

This is an unsigned Windows preview. Existing preview39 artifacts remain unchanged. Physical Windows and church ProPresenter acceptance are still required. The reported ProPresenter playlist-list error is not claimed fixed; its actual API response must be inspected on the computer running ProPresenter. No server hash, ownership, revision or playlist recovery guard has been removed.
