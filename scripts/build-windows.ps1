[CmdletBinding()]
param([switch]$Test, [switch]$Installer)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$python = Join-Path $root '.venv\Scripts\python.exe'
Push-Location $root
try {
    & npm.cmd --prefix frontend run build
    if ($LASTEXITCODE) { throw 'Frontend build failed' }
    if ($Test) {
        & $python -m unittest discover -s tests -v
        if ($LASTEXITCODE) { throw 'Python tests failed' }
        & npm.cmd --prefix frontend test
        if ($LASTEXITCODE) { throw 'Frontend tests failed' }
    }
    . (Join-Path $PSScriptRoot 'freeze.ps1')
    Invoke-KaizhiFreeze $root @('--noconfirm','--onefile','--windowed','--name','KaizhiPython','--add-data','frontend/dist;frontend/dist','--hidden-import=win32timezone','--exclude-module=numpy','--exclude-module=matplotlib','--exclude-module=tkinter','run.py')
    if ($Installer) {
        & makensis.exe /V2 scripts/installer.nsi
        if ($LASTEXITCODE) { throw 'NSIS packaging failed' }
    }
} finally { Pop-Location }
