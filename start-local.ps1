$ErrorActionPreference='Stop'
$projectRoot=$PSScriptRoot
$backendRoot=Join-Path $projectRoot 'backend'
$frontendRoot=Join-Path $projectRoot 'frontend'
if (-not (Test-Path (Join-Path $backendRoot 'build/libs/effort-lab-0.1.0.jar'))) {throw '먼저 backend에서 .\gradlew.bat bootJar를 실행하세요.'}
if (-not (Test-Path (Join-Path $frontendRoot 'node_modules/vite/bin/vite.js'))) {throw '먼저 frontend에서 npm ci를 실행하세요.'}
$javaBinary=if($env:JAVA_HOME){Join-Path $env:JAVA_HOME 'bin/java.exe'}elseif(Test-Path (Join-Path $env:USERPROFILE '.jdks/openjdk-21.0.1/bin/java.exe')){Join-Path $env:USERPROFILE '.jdks/openjdk-21.0.1/bin/java.exe'}else{'java'}
if(Get-NetTCPConnection -LocalPort 8087 -State Listen -ErrorAction SilentlyContinue){throw '8087 포트가 이미 사용 중입니다.'}
if(Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue){throw '5173 포트가 이미 사용 중입니다.'}
$backendProcess=Start-Process -FilePath $javaBinary -ArgumentList '-jar','build/libs/effort-lab-0.1.0.jar' -WorkingDirectory $backendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $backendRoot 'server.log') -RedirectStandardError (Join-Path $backendRoot 'server.err.log')
$frontendProcess=Start-Process -FilePath 'node' -ArgumentList 'node_modules/vite/bin/vite.js','--host','127.0.0.1' -WorkingDirectory $frontendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $frontendRoot 'vite.log') -RedirectStandardError (Join-Path $frontendRoot 'vite.err.log')
@{backendPid=$backendProcess.Id;frontendPid=$frontendProcess.Id;url='http://127.0.0.1:5173'} | ConvertTo-Json
