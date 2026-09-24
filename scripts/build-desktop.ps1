$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    npm ci --prefix frontend
    if($LASTEXITCODE -ne 0){throw 'Frontend install failed'}
    npm test --prefix frontend
    if($LASTEXITCODE -ne 0){throw 'Frontend tests failed'}
    npm run build --prefix frontend
    if($LASTEXITCODE -ne 0){throw 'Frontend build failed'}
    & ./backend/gradlew.bat -p backend test bootJar --console=plain
    if($LASTEXITCODE -ne 0){throw 'Backend build failed'}
    npm ci --prefix desktop
    if($LASTEXITCODE -ne 0){throw 'Desktop install failed'}
    & ./scripts/prepare-runtime.ps1
    npm run dist --prefix desktop
    if($LASTEXITCODE -ne 0){throw 'Desktop packaging failed'}
    node ./scripts/smoke-desktop.mjs
    if($LASTEXITCODE -ne 0){throw 'Packaged smoke test failed'}
    $checksums=Get-ChildItem ./release/*.exe | Sort-Object Name | ForEach-Object { ((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())+'  '+$_.Name }
    [IO.File]::WriteAllLines((Join-Path $root 'release/SHA256SUMS.txt'),[string[]]$checksums,[Text.UTF8Encoding]::new($false))
} finally {Pop-Location}
