param(
    [ValidateSet('Chrome', 'Edge', 'Both')][string]$Browser = 'Both',
    [switch]$Uninstall,
    [switch]$NoLaunch
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$name = 'com.phrasepocket.desktop'
$manifest = Join-Path $root "build\$name.json"
$exe = Join-Path $root 'build\PhrasePocket.exe'
$registryPaths = @()
if ($Browser -ne 'Edge') { $registryPaths += "Software\Google\Chrome\NativeMessagingHosts\$name" }
if ($Browser -ne 'Chrome') { $registryPaths += "Software\Microsoft\Edge\NativeMessagingHosts\$name" }
if ($Uninstall) {
    foreach ($path in $registryPaths) {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path)
        if ($null -eq $key) { continue }
        try { $ours = $key.GetValue('') -eq $manifest } finally { $key.Dispose() }
        if ($ours) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($path, $false) }
    }
    Write-Output 'Removed this copy of the browser bridge. Local collections were kept.'
    return
}
$dictionary = Join-Path $root 'build\ecdict-bundled.db'
if (-not (Test-Path -LiteralPath $exe) -or -not (Test-Path -LiteralPath $dictionary)) {
    $buildScript = Join-Path $PSScriptRoot 'build.ps1'
    if (-not (Test-Path -LiteralPath $buildScript)) { throw 'Please extract the complete Windows archive, including its build folder.' }
    & $buildScript | Out-Null
}
$data = [ordered]@{
    name = $name
    description = 'Phrase Pocket desktop bridge'
    path = $exe
    type = 'stdio'
    allowed_origins = @('chrome-extension://jhioomhdcaphdijkhegcbakheknicgdc/')
}
[IO.File]::WriteAllText($manifest, ($data | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
foreach ($path in $registryPaths) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($path)
    try { $key.SetValue('', $manifest, [Microsoft.Win32.RegistryValueKind]::String) }
    finally { $key.Dispose() }
}
if (-not $NoLaunch) { Start-Process -FilePath $exe -WindowStyle Normal }
Write-Output 'Desktop bridge registered. Load the extension folder in chrome://extensions or edge://extensions.'
Write-Output (Join-Path $root 'extension')
