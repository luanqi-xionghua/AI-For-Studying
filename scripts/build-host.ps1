[CmdletBinding()]
param()
# 编译 Codex 本机小助手 PdfCopilotHost.exe（开智桌面版与浏览器扩展共用）。
# 源码：backend/native-host/*.cs   产物：backend/native-host/bin/PdfCopilotHost.exe
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$hostSource = Join-Path $projectRoot 'backend\native-host'
$outputRoot = Join-Path $hostSource 'bin'
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compilerPath)) { throw '.NET Framework 4.x compiler was not found. Build this helper on Windows.' }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$outputExe = Join-Path $outputRoot 'PdfCopilotHost.exe'
$sourceFiles = @(Get-ChildItem -LiteralPath $hostSource -Filter '*.cs' -File | ForEach-Object { $_.FullName })
& $compilerPath '/nologo' '/optimize+' '/target:exe' '/platform:anycpu' '/reference:System.Web.Extensions.dll' "/out:$outputExe" @sourceFiles
if ($LASTEXITCODE -ne 0) { throw 'Native helper compilation failed.' }
& $outputExe '--self-test'
if ($LASTEXITCODE -ne 0) { throw 'Native helper self-test failed.' }
Write-Host "Built $outputExe"
