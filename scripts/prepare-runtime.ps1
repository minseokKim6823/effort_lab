$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $root 'desktop/runtime'
$cache = Join-Path $root '.tools/runtime'
New-Item -ItemType Directory -Force $runtime,$cache | Out-Null
$manifest = Get-Content (Join-Path $root 'desktop/runtime-manifest.json') -Raw | ConvertFrom-Json
$archive = Join-Path $cache $manifest.file
if (!(Test-Path $archive) -or (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256) {
    Invoke-WebRequest -Uri $manifest.url -OutFile $archive -UseBasicParsing
}
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256) { throw 'Java runtime checksum mismatch' }
if (!(Test-Path (Join-Path $runtime 'java/bin/java.exe'))) {
    $expanded=Join-Path $cache 'expanded'
    Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force
    $jdk=Get-ChildItem $expanded -Directory | Select-Object -First 1
    Copy-Item -LiteralPath $jdk.FullName -Destination (Join-Path $runtime 'java') -Recurse
}
Copy-Item -LiteralPath (Join-Path $root 'desktop/runtime-manifest.json') -Destination $runtime
& (Join-Path $runtime 'java/bin/java.exe') -version
if ($LASTEXITCODE -ne 0) { throw 'Java runtime validation failed' }
