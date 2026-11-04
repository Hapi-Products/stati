param(
  [Parameter(Mandatory=$true)][string]$ExecutablePath,
  [Parameter(Mandatory=$true)][string]$BackupDirectory
)
$ErrorActionPreference = 'Stop'
$expected = [IO.Path]::GetFullPath($ExecutablePath)
$shell = New-Object -ComObject WScript.Shell
$folders = @([Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('CommonDesktopDirectory')) | Select-Object -Unique
foreach ($folder in $folders) {
  if (-not $folder) { continue }
  foreach ($name in @(('Sta' + [char]0x021b + 'i.lnk'), 'Stati.lnk')) {
    $shortcutPath = Join-Path $folder $name
    if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { continue }
    try {
      $shortcut = $shell.CreateShortcut($shortcutPath)
      if ($shortcut.TargetPath -and [IO.Path]::GetFullPath($shortcut.TargetPath).Equals($expected, [StringComparison]::OrdinalIgnoreCase)) {
        # Move the known legacy alias quietly, preserving it for recovery.
        # Shell recycling can show deletion UI/toasts and refresh every icon.
        [IO.Directory]::CreateDirectory($BackupDirectory) | Out-Null
        $backupPath = Join-Path $BackupDirectory (([Guid]::NewGuid().ToString('N')) + '-' + $name)
        [IO.File]::Move($shortcutPath, $backupPath)
      }
    } catch { throw 'Could not migrate the Stați desktop shortcut. It will be retried on the next launch.' }
  }
}
