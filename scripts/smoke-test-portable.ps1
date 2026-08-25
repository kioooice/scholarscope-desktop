[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PortableExe,

  [int]$TimeoutSeconds = 25
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $PortableExe -PathType Leaf)) {
  throw "Portable executable was not found: $PortableExe"
}

$process = Start-Process -FilePath $PortableExe -PassThru
$ready = $false

try {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 500
    try {
      $status = Invoke-RestMethod -Uri "http://127.0.0.1:5181/api/status" -TimeoutSec 2
      if ($status.status -eq "ok" -and $status.engine.status -eq "ready") {
        Write-Host "Portable internal engine is ready."
        $ready = $true
        break
      }
    } catch {
      # The desktop process needs a moment to initialize its bundled runtime.
    }
  } while ((Get-Date) -lt $deadline)
} finally {
  if (-not $process.HasExited) {
    & taskkill.exe /PID $process.Id /T /F | Out-Null
  }
}

if (-not $ready) {
  throw "Portable app did not make its internal engine ready within $TimeoutSeconds seconds."
}
