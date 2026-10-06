$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    $releaseVersion=(Get-Content -Raw ./desktop/package.json | ConvertFrom-Json).version
    $frontendVersion=(Get-Content -Raw ./frontend/package.json | ConvertFrom-Json).version
    $backendVersion=[regex]::Match((Get-Content -Raw ./backend/build.gradle),"(?m)^version = '([^']+)'").Groups[1].Value
    if($releaseVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -or $frontendVersion -ne $releaseVersion -or $backendVersion -ne $releaseVersion) {
        throw 'Backend, frontend and desktop versions must agree'
    }
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
    $artifactNames=@("Effort-Lab-Setup-$releaseVersion-x64.exe","Effort-Lab-$releaseVersion-portable-x64.exe")
    $checksums=foreach($artifactName in ($artifactNames | Sort-Object)) {
        $artifactPath=Join-Path $root "release/$artifactName"
        if(-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)){throw "Missing release artifact: $artifactName"}
        ((Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant())+'  '+$artifactName
    }
    [IO.File]::WriteAllLines((Join-Path $root 'release/SHA256SUMS.txt'),[string[]]$checksums,[Text.UTF8Encoding]::new($false))
} finally {Pop-Location}
