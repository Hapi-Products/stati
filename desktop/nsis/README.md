This directory contains the reviewed `app-builder-lib` uninstaller override.
`SOURCE.json` records the exact upstream version and SHA-256; the focused test
requires every byte to match upstream except the selection marker and the
guard around its global desktop refresh.

`../windows-installer.nsh` changes only the NSIS compiler include search location.
The stock installer and electron-builder uninstaller signing pipeline remain in
use. The `multiUser.nsh` forwarder avoids selecting the unrelated NSIS built-in
`MultiUser.nsh` on case-insensitive filesystems. A compile-time marker check
refuses to build if the reviewed uninstaller was bypassed.

During an update (`--updated`) or a shortcut-preserving uninstall
(`--keep-shortcuts`), this uninstaller skips its global association/icon refresh.
A normal uninstall keeps the upstream refresh. Desktop shortcut creation is
disabled; Start menu links and the stable AppUserModelID remain in stock code.
No Explorer restart, taskbar pin manipulation, or unrelated shortcut cleanup is
performed.

An upgrade from an older release still runs that release's existing uninstaller,
which can refresh the desktop once. The installed replacement governs following
updates. Windows Explorer behavior and native shortcut migration must still be
checked on the target Windows PC; compiling an installer on macOS is not that
device check.
