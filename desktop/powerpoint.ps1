param([Parameter(Mandatory=$true)][string]$InputPath,[Parameter(Mandatory=$true)][string]$OutputDir, [switch]$ExtractLyrics)
$ErrorActionPreference = 'Stop'
if ([IO.Path]::GetExtension($InputPath).ToLowerInvariant() -notin @('.pptx', '.ppt')) { throw 'Choose a PowerPoint file.' }
$powerpoint = $null
$presentation = $null
try {
  $powerpoint = New-Object -ComObject PowerPoint.Application
  $powerpoint.AutomationSecurity = 3
  $presentation = $powerpoint.Presentations.Open($InputPath, -1, 0, 0)
  if ($presentation.Slides.Count -gt 500) { throw 'Choose a presentation with 500 slides or fewer.' }
  if ($ExtractLyrics) {
    $width = [double]$presentation.PageSetup.SlideWidth
    $height = [double]$presentation.PageSetup.SlideHeight
    function Read-LyricShapes($shapes) {
      foreach ($shape in $shapes) {
        if ($shape.Type -eq 6) { Read-LyricShapes $shape.GroupItems; continue }
        if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) {
          $range = $shape.TextFrame.TextRange
          $sizes = @()
          for ($r = 1; $r -le $range.Runs().Count; $r++) {
            $run = $range.Runs($r, 1)
            if ($run.Text.Trim()) { $sizes += [double]$run.Font.Size }
          }
          $size = 0
          if ($sizes.Count) { $size = ($sizes | Measure-Object -Maximum).Maximum }
          [pscustomobject]@{text=$range.Text; fontSize=$size; x=([double]$shape.Left/$width); y=([double]$shape.Top/$height); width=([double]$shape.Width/$width); height=([double]$shape.Height/$height)}
        }
      }
    }
    $slides = @()
    for ($i = 1; $i -le $presentation.Slides.Count; $i++) {
      $page = $presentation.Slides.Item($i)
      $additional = @()
      foreach ($ancestor in @($page.CustomLayout, $page.Master)) {
        $staticShapes = @($ancestor.Shapes | Where-Object { $_.Type -ne 14 })
        $additional += @(Read-LyricShapes $staticShapes)
      }
      $slides += [pscustomobject]@{number=$i; shapes=@(Read-LyricShapes $page.Shapes); additionalTextBoxes=$additional.Count}
    }
    [IO.Directory]::CreateDirectory($OutputDir) | Out-Null
    $json = ConvertTo-Json -InputObject @{slides=$slides} -Depth 10 -Compress
    [IO.File]::WriteAllText((Join-Path $OutputDir 'lyrics.json'), $json, (New-Object Text.UTF8Encoding($false)))
    return
  }
  [IO.Directory]::CreateDirectory($OutputDir) | Out-Null
  for ($i = 1; $i -le $presentation.Slides.Count; $i++) {
    $filename = Join-Path $OutputDir ('Slide-{0:D3}.png' -f $i)
    $presentation.Slides.Item($i).Export($filename, 'PNG', 1920, 1080)
  }
  Write-Output $presentation.Slides.Count
} finally {
  if ($presentation) { try { $presentation.Close() } catch {}; [Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) | Out-Null }
  # PowerPoint may already host an operator presentation. Close only the document
  # opened above; never quit an application instance or terminate POWERPNT.EXE.
  if ($powerpoint) { [Runtime.InteropServices.Marshal]::ReleaseComObject($powerpoint) | Out-Null }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
