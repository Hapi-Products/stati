param([Parameter(Mandatory=$true)][string]$ExecutablePath)
$ErrorActionPreference = 'Stop'
try {
  $signature = Get-AuthenticodeSignature -LiteralPath $ExecutablePath
  if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) { throw 'Invalid executable signature' }
  [ordered]@{
    status = 'Valid'
    subject = $signature.SignerCertificate.Subject
    name = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  } | ConvertTo-Json -Compress
  exit 0
} catch { exit 1 }
