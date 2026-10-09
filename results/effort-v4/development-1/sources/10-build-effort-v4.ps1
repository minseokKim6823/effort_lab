$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Push-Location $repo
try {
    function SourceHashes {
        $hashes = [ordered]@{}
        $files = @(& rg --files backend/src/main backend/build.gradle backend/settings.gradle backend/gradle/wrapper)
        if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate build sources' }
        foreach ($file in ($files | Sort-Object)) {
            $hashes[$file.Replace('\', '/')] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        return $hashes
    }
    $before = SourceHashes
    & .\backend\gradlew.bat -p backend test bootJar --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Candidate build or tests failed' }
    $after = SourceHashes
    if (($before | ConvertTo-Json -Compress) -cne ($after | ConvertTo-Json -Compress)) {
        throw 'Source changed while building'
    }
    $receipt = [ordered]@{
        builtAt = [DateTime]::UtcNow.ToString('o')
        command = 'backend/gradlew.bat -p backend test bootJar --console=plain'
        sourceHashes = $after
        jarSha256 = (Get-FileHash -LiteralPath 'backend/build/libs/effort-lab.jar' -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $target = Join-Path $repo '.tools/effort-v4/candidate-build.json'
    [System.IO.Directory]::CreateDirectory((Split-Path $target -Parent)) | Out-Null
    [System.IO.File]::WriteAllText($target, ($receipt | ConvertTo-Json -Depth 10) + "`n", [System.Text.UTF8Encoding]::new($false))
    Write-Output "BUILD_RECEIPT_SAVED $target"
} finally { Pop-Location }
