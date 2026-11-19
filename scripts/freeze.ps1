# PyInstaller searches PATH for DLLs. Do not ship codecs or CRT shims from an
# unrelated SDK, which can shadow Windows ICU and prevent QtCore from loading.
function Invoke-KaizhiFreeze([string]$Root, [string[]]$Options) {
    $saved = $env:Path
    try {
        $scripts = Join-Path $Root '.venv\Scripts'
        $env:Path = @($scripts, "$env:WINDIR\System32", $env:WINDIR) -join ';'
        & (Join-Path $scripts 'python.exe') -m PyInstaller --workpath build/freeze-windows @Options
        if ($LASTEXITCODE) { throw 'Python packaging failed' }
    } finally { $env:Path = $saved }
}
