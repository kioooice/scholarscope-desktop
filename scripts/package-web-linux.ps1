[CmdletBinding()]
param(
  [string]$OutputPath = (Join-Path (Get-Location) "ScholarScope-web-linux-x64.zip")
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$stageRoot = Join-Path $env:TEMP ("scholarscope-web-stage-" + [guid]::NewGuid().ToString("N"))
$appStage = Join-Path $stageRoot "app"
$runtimeStage = Join-Path $stageRoot "runtime"
$dataStage = Join-Path $stageRoot "data"
$nodeArchive = Join-Path $env:TEMP ("node-linux-x64-" + [guid]::NewGuid().ToString("N") + ".tar.gz")
$nodeExtract = Join-Path $env:TEMP ("node-linux-x64-" + [guid]::NewGuid().ToString("N"))

try {
  Write-Host "Building the web frontend..."
  & npm run build --prefix $repoRoot
  if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }

  New-Item -ItemType Directory -Force -Path $appStage, $runtimeStage, $dataStage | Out-Null
  Copy-Item -LiteralPath (Join-Path $repoRoot "apps\desktop\server.mjs") -Destination (Join-Path $appStage "server.mjs")
  Copy-Item -LiteralPath (Join-Path $repoRoot "apps\desktop\dist") -Destination (Join-Path $appStage "dist") -Recurse
  New-Item -ItemType Directory -Force -Path (Join-Path $appStage "engine") | Out-Null
  Copy-Item -LiteralPath (Join-Path $repoRoot "resources\engine\worker.py") -Destination (Join-Path $appStage "engine\worker.py")

  $deployRoot = Join-Path $repoRoot "deploy\web"
  $rootFiles = @(
    "start.sh",
    "stop.sh",
    "status.sh",
    "install-service.sh",
    "scholarscope-web.service",
    "config.env.example",
    "openresty-proxy.conf.example",
    "404.html",
    "README-deploy.md"
  )
  foreach ($file in $rootFiles) {
    Copy-Item -LiteralPath (Join-Path $deployRoot $file) -Destination (Join-Path $stageRoot $file)
  }
  Copy-Item -LiteralPath (Join-Path $repoRoot "LICENSE") -Destination (Join-Path $stageRoot "LICENSE")
  Copy-Item -LiteralPath (Join-Path $repoRoot "NOTICE") -Destination (Join-Path $stageRoot "NOTICE")

  Set-Content -LiteralPath (Join-Path $runtimeStage "README.txt") -Value @(
    "The package includes Node.js v24.14.0 for Linux x64.",
    "The start script creates runtime/python on first launch."
  ) -Encoding utf8
  Set-Content -LiteralPath (Join-Path $dataStage "README.txt") -Value @(
    "ScholarScope runtime data, temporary PDFs, logs, and the PID file are stored here.",
    "Keep this directory writable by the account that runs the service."
  ) -Encoding utf8

  Write-Host "Downloading the Linux Node.js runtime..."
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v24.14.0/node-v24.14.0-linux-x64.tar.gz" -OutFile $nodeArchive
  New-Item -ItemType Directory -Force -Path $nodeExtract | Out-Null
  & tar.exe -xzf $nodeArchive -C $nodeExtract
  if ($LASTEXITCODE -ne 0) { throw "Linux Node.js archive extraction failed." }
  $nodeBinary = Get-ChildItem -Path $nodeExtract -Filter "node" -File -Recurse | Select-Object -First 1
  if (-not $nodeBinary) { throw "Linux Node.js executable was not found in the archive." }
  New-Item -ItemType Directory -Force -Path (Join-Path $runtimeStage "node\bin") | Out-Null
  Copy-Item -LiteralPath $nodeBinary.FullName -Destination (Join-Path $runtimeStage "node\bin\node")

  $outputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputFullPath) | Out-Null
  if (Test-Path -LiteralPath $outputFullPath) {
    Remove-Item -LiteralPath $outputFullPath -Force
  }
  Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $outputFullPath -CompressionLevel Optimal
  Write-Host "Created: $outputFullPath"
  Write-Host ((Get-Item -LiteralPath $outputFullPath).Length.ToString() + " bytes")
}
finally {
  if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
  }
  if (Test-Path -LiteralPath $nodeArchive) {
    Remove-Item -LiteralPath $nodeArchive -Force
  }
  if (Test-Path -LiteralPath $nodeExtract) {
    Remove-Item -LiteralPath $nodeExtract -Recurse -Force
  }
}
