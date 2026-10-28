[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Low')]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifestPath = Join-Path $PSScriptRoot 'aria2-next-release.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

if ($manifest.version -notmatch '^\d+\.\d+\.\d+$' -or $manifest.tag -ne "v$($manifest.version)") {
    throw 'The aria2-next release manifest has an inconsistent version or tag.'
}
if ($manifest.asset -ne "aria2-next-$($manifest.version)-windows-x86_64.exe") {
    throw 'The aria2-next manifest does not name the expected Windows x86_64 asset.'
}
if ($manifest.sha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'The aria2-next manifest does not contain a valid lowercase SHA-256 digest.'
}

$releaseRoot = "$($manifest.repository)/releases/download/$($manifest.tag)"
$licenseRoot = "$($manifest.repository)/raw/$($manifest.tag)"
$binaryUrl = "$releaseRoot/$($manifest.asset)"
$checksumsUrl = "$releaseRoot/$($manifest.checksumAsset)"
$copyingUrl = "$licenseRoot/COPYING"
$opensslUrl = "$licenseRoot/docs/licenses/OPENSSL.md"
$binaryTarget = Join-Path $repoRoot 'src-tauri/binaries/aria2c-x86_64-pc-windows-msvc.exe'
$licenseTarget = Join-Path $repoRoot 'src-tauri/licenses/aria2-next'

if (-not $PSCmdlet.ShouldProcess($binaryTarget, "Download, verify and stage aria2-next $($manifest.version)")) {
    return
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "helios-aria2-next-$($manifest.version)-$([guid]::NewGuid().ToString('N'))"
[System.IO.Directory]::CreateDirectory($tempRoot) | Out-Null
$downloadedBinary = Join-Path $tempRoot $manifest.asset
$checksumsFile = Join-Path $tempRoot $manifest.checksumAsset
$copyingFile = Join-Path $tempRoot 'COPYING'
$opensslFile = Join-Path $tempRoot 'LICENSE.OpenSSL.md'

Invoke-WebRequest -Uri $checksumsUrl -OutFile $checksumsFile
$checksumLines = @(Get-Content -LiteralPath $checksumsFile | Where-Object {
    $_ -match ('^([a-fA-F0-9]{64})\s+\*?' + [regex]::Escape($manifest.asset) + '$')
})
if ($checksumLines.Count -ne 1) {
    throw "The official checksum file does not contain exactly one entry for $($manifest.asset)."
}
$publishedHash = ([regex]::Match($checksumLines[0], '^[a-fA-F0-9]{64}')).Value.ToLowerInvariant()
if ($publishedHash -ne $manifest.sha256) {
    throw "Pinned digest disagrees with the official checksum file: $publishedHash"
}

Invoke-WebRequest -Uri $binaryUrl -OutFile $downloadedBinary
$actualHash = (Get-FileHash -LiteralPath $downloadedBinary -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $manifest.sha256) {
    throw "aria2-next executable SHA-256 mismatch: $actualHash"
}

Invoke-WebRequest -Uri $copyingUrl -OutFile $copyingFile
Invoke-WebRequest -Uri $opensslUrl -OutFile $opensslFile
$copyingText = Get-Content -LiteralPath $copyingFile -Raw
$opensslText = Get-Content -LiteralPath $opensslFile -Raw
if ($copyingText -notmatch 'GNU GENERAL PUBLIC LICENSE' -or $opensslText -notmatch 'OpenSSL') {
    throw 'Required upstream GPL or OpenSSL linking-exception text is missing.'
}

$oldBinary = Join-Path $tempRoot 'aria2c-previous.exe'
if (Test-Path -LiteralPath $binaryTarget) {
    Copy-Item -LiteralPath $binaryTarget -Destination $oldBinary
}
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $binaryTarget)) | Out-Null
[System.IO.Directory]::CreateDirectory($licenseTarget) | Out-Null
Copy-Item -LiteralPath $downloadedBinary -Destination $binaryTarget -Force
Copy-Item -LiteralPath $copyingFile -Destination (Join-Path $licenseTarget 'COPYING') -Force
Copy-Item -LiteralPath $opensslFile -Destination (Join-Path $licenseTarget 'LICENSE.OpenSSL.md') -Force
Write-Host "Staged aria2-next $($manifest.version); SHA-256 $actualHash"
if (Test-Path -LiteralPath $oldBinary) {
    Write-Host "Previous local sidecar preserved at $oldBinary"
}
Write-Host "Verified release files retained at $tempRoot"
