$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$build = Join-Path $root 'build'
$exe = & (Join-Path $PSScriptRoot 'build.ps1')
$extension = Join-Path $root 'extension'
$version = (Get-Content -Raw -LiteralPath (Join-Path $extension 'manifest.json') | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid extension version.' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
function Write-Package([string]$Archive, [hashtable]$Files) {
    $stream = [IO.File]::Open($Archive, [IO.FileMode]::Create)
    try {
        $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
        try {
            foreach ($name in ($Files.Keys | Sort-Object)) {
                $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                    $zip, $Files[$name], $name, [IO.Compression.CompressionLevel]::Optimal)
            }
        } finally { $zip.Dispose() }
    } finally { $stream.Dispose() }
    Write-Output $Archive
}
$extensionFiles = @{}
foreach ($file in Get-ChildItem -LiteralPath $extension -File) {
    $extensionFiles[$file.Name] = $file.FullName
}
$windowsFiles = @{
    'Install.cmd' = (Join-Path $root 'Install.cmd')
    'Uninstall.cmd' = (Join-Path $root 'Uninstall.cmd')
    'README.md' = (Join-Path $root 'README.md')
    'scripts/install.ps1' = (Join-Path $PSScriptRoot 'install.ps1')
    'build/PhrasePocket.exe' = $exe
    'build/ecdict-bundled.db' = (Join-Path $build 'ecdict-bundled.db')
    'ECDICT-LICENSE.txt' = (Join-Path $root 'desktop\ECDICT-LICENSE.txt')
}
foreach ($name in $extensionFiles.Keys) { $windowsFiles["extension/$name"] = $extensionFiles[$name] }
$sourceFiles = @{}
foreach ($name in @('.gitignore','Install.cmd','Uninstall.cmd','README.md')) {
    $sourceFiles[$name] = Join-Path $root $name
}
$sourceFiles['desktop/ECDICT-LICENSE.txt'] = Join-Path $root 'desktop\ECDICT-LICENSE.txt'
foreach ($dir in @('desktop','extension','scripts','.github')) {
    $path = Join-Path $root $dir
    if (-not (Test-Path -LiteralPath $path)) { continue }
    foreach ($file in Get-ChildItem -LiteralPath $path -Recurse -File -Force) {
        if ($file.Extension -notin @('.cs','.manifest','.js','.mjs','.json','.css','.html','.ps1','.yml')) { continue }
        $name = $file.FullName.Substring($root.Length + 1).Replace('\','/')
        $sourceFiles[$name] = $file.FullName
    }
}

Write-Package (Join-Path $build "PhrasePocket-Extension-$version.zip") $extensionFiles
Write-Package (Join-Path $build "PhrasePocket-Windows-$version.zip") $windowsFiles
Write-Package (Join-Path $build "PhrasePocket-Source-$version.zip") $sourceFiles
