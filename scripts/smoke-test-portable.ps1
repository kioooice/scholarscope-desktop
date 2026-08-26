[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PortableExe,

  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $PortableExe -PathType Leaf)) {
  throw "Portable executable was not found: $PortableExe"
}

$resolvedExe = (Resolve-Path -LiteralPath $PortableExe).Path
$portableDirectory = Split-Path -Parent $resolvedExe
$process = Start-Process -FilePath $resolvedExe -WorkingDirectory $portableDirectory -PassThru
$ready = $false
$exitCode = $null
$lastStatus = $null
$lastProbeError = $null

function Write-EngineLogDiagnostics {
  $logPaths = [System.Collections.Generic.List[string]]::new()
  if ($env:LOCALAPPDATA) {
    $logPaths.Add((Join-Path $env:LOCALAPPDATA "com.scholarscope.desktop\internal-engine.log"))
    $logPaths.Add((Join-Path $env:LOCALAPPDATA "ScholarScope\internal-engine.log"))
    try {
      Get-ChildItem -Path $env:LOCALAPPDATA -Filter "internal-engine.log" -File -Recurse -Depth 4 -ErrorAction SilentlyContinue |
        ForEach-Object { $logPaths.Add($_.FullName) }
    } catch {
      # Diagnostics must not hide the original smoke-test failure.
    }
  }

  $logs = $logPaths |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Sort-Object -Unique |
    ForEach-Object { Get-Item -LiteralPath $_ -ErrorAction SilentlyContinue } |
    Sort-Object LastWriteTime -Descending

  if (-not $logs) {
    Write-Host "No internal-engine.log was found under LOCALAPPDATA."
    return
  }

  foreach ($log in @($logs | Select-Object -First 3)) {
    Write-Host "--- internal engine log: $($log.FullName) ---"
    Get-Content -LiteralPath $log.FullName -Tail 120 -ErrorAction SilentlyContinue |
      ForEach-Object { Write-Host $_ }
  }
}

try {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.HasExited) {
      $exitCode = $process.ExitCode
      break
    }
    try {
      $status = Invoke-RestMethod -Uri "http://127.0.0.1:5181/api/status" -TimeoutSec 2
      $lastStatus = $status
      if ($status.status -eq "ok" -and $status.engine.status -eq "ready") {
        Write-Host "Portable internal engine is ready."
        $ready = $true
        break
      }
    } catch {
      $lastProbeError = $_.Exception.Message
    }
  } while ((Get-Date) -lt $deadline)
} finally {
  $process.Refresh()
  if (-not $process.HasExited) {
    & taskkill.exe /PID $process.Id /T /F | Out-Null
  }
}

if (-not $ready) {
  if ($null -ne $exitCode) {
    Write-EngineLogDiagnostics
    throw "Portable app exited before its internal engine became ready (exit code $exitCode)."
  }

  if ($lastStatus) {
    Write-Host ("Last engine status: " + ($lastStatus | ConvertTo-Json -Compress -Depth 6))
  }
  if ($lastProbeError) {
    Write-Host "Last status probe error: $lastProbeError"
  }
  Write-EngineLogDiagnostics
  throw "Portable app did not make its internal engine ready within $TimeoutSeconds seconds."
}
