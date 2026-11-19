[CmdletBinding()]
param([switch]$Test, [switch]$Installer, [switch]$Release)
# 构建阅迁星穹 Windows 版。
#   -Test       先跑前后端测试，打包后实际启动 EXE 做 --harness-smoke 与 --smoke
#   -Installer  另用 NSIS 生成安装包 dist\YueqianXingqiong-<版本>-setup.exe
#   -Release    含 -Installer，并在 dist\release\ 放好发布用的安装包、便携版和 SHA256SUMS.txt
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$python = Join-Path $root '.venv\Scripts\python.exe'
$app = 'YueqianXingqiong'
if ($Release) { $Installer = $true }
Push-Location $root
try {
    $version = [regex]::Match((Get-Content -Raw -Encoding UTF8 'backend\__init__.py'), 'VERSION = "([0-9]+\.[0-9]+\.[0-9]+)"').Groups[1].Value
    if (-not $version) { throw 'VERSION not found in backend\__init__.py' }
    Write-Output "Building $app $version"
    & npm.cmd --prefix harness ci --no-fund --no-audit
    if ($LASTEXITCODE) { throw 'Harness dependency installation failed' }
    & node harness/build.mjs
    if ($LASTEXITCODE) { throw 'Harness build failed' }
    & npm.cmd --prefix frontend run build
    if ($LASTEXITCODE) { throw 'Frontend build failed' }
    if ($Test) {
        & $python -m unittest discover -s backend/tests -t . -v
        if ($LASTEXITCODE) { throw 'Python tests failed' }
        & npm.cmd --prefix frontend test
        if ($LASTEXITCODE) { throw 'Frontend tests failed' }
    }
    & $python scripts/make-version-info.py build/version-info.txt
    if ($LASTEXITCODE) { throw 'Version resource generation failed' }
    . (Join-Path $PSScriptRoot 'freeze.ps1')
    Invoke-KaizhiFreeze $root @('--noconfirm','--onedir','--contents-directory',"$app.runtime",'--windowed','--name',$app,'--icon','frontend/public/app.ico','--version-file','build/version-info.txt','--add-data','frontend/dist;frontend/dist','--add-data','harness/dist;harness/dist','--paths','.','--hidden-import=win32timezone','--exclude-module=numpy','--exclude-module=matplotlib','--exclude-module=tkinter','backend/main.py')
    $bundle = Join-Path $root "dist\$app"
    $exe = Join-Path $bundle "$app.exe"
    Copy-Item LICENSE (Join-Path $bundle "LICENSE.txt")
    Copy-Item THIRD_PARTY_NOTICES.md -Destination $bundle
    # Ownership marker for installer upgrades; never treat an arbitrary folder as our runtime.
    Set-Content -LiteralPath (Join-Path $bundle "$app.runtime\.yueqian-runtime") -Value $app -Encoding ascii
    if ($Test) {
        foreach ($check in @('--harness-smoke','--smoke')) {
            $probe = Start-Process -FilePath $exe -ArgumentList $check -WindowStyle Hidden -Wait -PassThru
            if ($probe.ExitCode -ne 0) { throw "Packaged smoke check $check failed ($($probe.ExitCode))" }
            Write-Output "Packaged smoke check $check passed"
        }
    }
    if ($Installer) {
        # winget 安装的 NSIS 不一定在 PATH 里：再看默认安装位置。
        $makensis = Get-Command makensis.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
        if (-not $makensis) {
            $makensis = @("${env:ProgramFiles(x86)}\NSIS\makensis.exe", "$env:ProgramFiles\NSIS\makensis.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
        }
        if (-not $makensis) { throw 'makensis.exe not found: install NSIS (winget install NSIS.NSIS --source winget)' }
        & $makensis /V2 "/DVERSION=$version" scripts/installer.nsi
        if ($LASTEXITCODE) { throw 'NSIS packaging failed' }
        Write-Output "Installer: dist\$app-$version-setup.exe"
    }
    if ($Release) {
        # 发布附件名必须是 ASCII（GitHub 会把中文改成点号），也是应用内更新器认的名字。
        $out = Join-Path $root 'dist\release'
        New-Item -ItemType Directory -Force $out | Out-Null
        # Keep unrelated files intact; do not leave obsolete release binaries for upload.
        Get-ChildItem -LiteralPath $out -File | Where-Object { $_.Name -match '^YueqianXingqiong-[0-9.]+-(setup\.exe|portable\.(exe|zip))$' } | ForEach-Object { Remove-Item -LiteralPath $_.FullName }
        Copy-Item (Join-Path $root "dist\$app-$version-setup.exe") $out
        $zip = Join-Path $out "$app-$version-portable.zip"
        # Include the containing folder and dotfiles; extract once, then run its EXE in place.
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip }
        [IO.Compression.ZipFile]::CreateFromDirectory($bundle, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
        $sums = Get-Item $zip,(Join-Path $out "$app-$version-setup.exe") | Sort-Object Name | ForEach-Object { '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name }
        # LF 换行：sha256sum -c（Git Bash、WSL、Linux）遇到 CRLF 会读错文件名。
        [IO.File]::WriteAllText((Join-Path $out 'SHA256SUMS.txt'), (($sums -join "`n") + "`n"))
        Write-Output "Release files in dist\release:"
        $sums | Write-Output
    }
} finally { Pop-Location }
