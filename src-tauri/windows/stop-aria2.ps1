param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir
)

$ErrorActionPreference = "Stop"
$targetPath = [System.IO.Path]::GetFullPath((Join-Path $InstallDir "aria2c.exe"))

try {
  $processes = @(
    Get-CimInstance -ClassName Win32_Process -Filter "Name = 'aria2c.exe'" |
      Where-Object {
        $_.ExecutablePath -and [System.String]::Equals(
          [System.IO.Path]::GetFullPath($_.ExecutablePath),
          $targetPath,
          [System.StringComparison]::OrdinalIgnoreCase
        )
      }
  )

  foreach ($process in $processes) {
    $processId = [int]$process.ProcessId
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
    }
    catch {
      if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
        throw
      }
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
      if ([DateTime]::UtcNow -ge $deadline) {
        throw "aria2c.exe (PID $processId) did not stop within 15 seconds."
      }
      Start-Sleep -Milliseconds 100
    }
  }

  exit 0
}
catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
