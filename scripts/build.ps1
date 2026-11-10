$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root 'build'
$null = New-Item -ItemType Directory -Force -Path $output
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
if (-not (Test-Path -LiteralPath (Join-Path $framework 'csc.exe'))) {
    $framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319'
}
$compiler = Join-Path $framework 'csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework compiler was not found.' }
$sources = @(Get-ChildItem -LiteralPath (Join-Path $root 'desktop') -Filter '*.cs' -File | ForEach-Object FullName)
$exe = Join-Path $output 'PhrasePocket.exe'
$manifest = Join-Path $root 'desktop\app.manifest'
$lexicon = Join-Path $root 'extension\lexicon.json'
$arguments = @('/nologo', '/target:winexe', '/optimize+', '/codepage:65001',
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll',
    "/win32manifest:$manifest", "/resource:$lexicon,PhrasePocket.Lexicon.json", "/out:$exe") + $sources
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw "Build failed ($LASTEXITCODE)." }
Write-Output $exe
