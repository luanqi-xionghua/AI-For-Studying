[CmdletBinding()]
param([switch]$Test, [switch]$Installer)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$python = Join-Path $root '.venv\Scripts\python.exe'
Push-Location $root
try {
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
    . (Join-Path $PSScriptRoot 'freeze.ps1')
    Invoke-KaizhiFreeze $root @('--noconfirm','--onefile','--windowed','--name','KaizhiPython','--add-data','frontend/dist;frontend/dist','--add-data','harness/dist;harness/dist','--paths','.','--hidden-import=win32timezone','--exclude-module=numpy','--exclude-module=matplotlib','--exclude-module=tkinter','backend/main.py')
    if ($Test) {
        foreach ($check in @('--harness-smoke','--smoke')) {
            $probe = Start-Process -FilePath (Join-Path $root 'dist\KaizhiPython.exe') -ArgumentList $check -WindowStyle Hidden -Wait -PassThru
            if ($probe.ExitCode -ne 0) { throw "Packaged smoke check $check failed ($($probe.ExitCode))" }
            Write-Output "Packaged smoke check $check passed"
        }
    }
    if ($Installer) {
        & makensis.exe /V2 scripts/installer.nsi
        if ($LASTEXITCODE) { throw 'NSIS packaging failed' }
    }
} finally { Pop-Location }
