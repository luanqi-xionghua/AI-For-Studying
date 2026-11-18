[CmdletBinding()]
param([switch]$Test)
# 一键构建开智 Windows 安装包：frontend/ 构建网页资源，backend/ 编译 Rust 并用 NSIS 打包。
# 加 -Test 会先跑前端单元测试和 Rust 测试。需要先运行 scripts\build-host.ps1 编译 Codex 小助手。
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$frontend = Join-Path $repoRoot 'frontend'
# 可选：开发机上放在仓库外的便携 Rust / VS 工具链（不存在时使用系统已安装的工具链）。
$taskToolchain = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '..\..\tmp\phydog-toolchain'))
if (Test-Path -LiteralPath (Join-Path $taskToolchain 'cargo\bin\cargo.exe')) {
    $env:CARGO_HOME = Join-Path $taskToolchain 'cargo'
    $env:RUSTUP_HOME = Join-Path $taskToolchain 'rustup'
    $env:PATH = (Join-Path $taskToolchain 'cargo\bin') + ';' + $env:PATH
}
$taskVs = Join-Path $taskToolchain 'vs'
$taskDevShell = Join-Path $taskVs 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll'
if (Test-Path -LiteralPath $taskDevShell) {
    Import-Module -Name $taskDevShell
    Enter-VsDevShell -VsInstallPath $taskVs -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
}
Push-Location $frontend
try {
    if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) { throw 'Install the Rust MSVC toolchain before building.' }
    if ($Test) {
        & npm.cmd test
        if ($LASTEXITCODE -ne 0) { throw 'AI tests failed.' }
        & cargo.exe test --manifest-path ..\backend\Cargo.toml
        if ($LASTEXITCODE -ne 0) { throw 'Native tests failed.' }
    }
    & npm.cmd run desktop:build
    if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
} finally { Pop-Location }
