<#
  Apply committed Prisma migrations to the PRODUCTION database - owner-run only.

  Run from the backend folder, in Windows PowerShell, while the Northflank
  port-forward is open in another window:

      cd C:\codeback\backend
      powershell -ExecutionPolicy Bypass -File .\scripts\prod-migrate.ps1

  (-ExecutionPolicy Bypass applies to that one process only; it changes no
  system setting.)

  The connection string:
    - is typed at a HIDDEN prompt (Read-Host -AsSecureString): never echoed,
      never in PSReadLine history, never written to a file;
    - lives only in this process's environment (DATABASE_URL), which the
      Prisma CLI prefers over backend/.env;
    - is cleared at the end, even on failure or Ctrl+C.

  Runs `prisma migrate deploy` (applies prisma/migrations only - never
  prisma/pending-approval), then `prisma migrate status`. Prisma prints the
  target as host:port and database name, never the password.
#>

$ErrorActionPreference = 'Stop'

if (-not (Test-Path '.\prisma\schema.prisma') -or -not (Test-Path '.\prisma\migrations')) {
  Write-Host 'Run this from the backend folder (the one containing prisma\schema.prisma).' -ForegroundColor Red
  exit 1
}

$secure = Read-Host -Prompt 'Production DATABASE_URL (hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$exitCode = 1
try {
  $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  $bstr = [IntPtr]::Zero
  $secure.Dispose()

  if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL) -or $env:DATABASE_URL -notmatch '^postgres(ql)?://') {
    Write-Host 'That does not look like a postgresql:// connection string. Nothing was run.' -ForegroundColor Red
    exit 1
  }
  # The local dev database (Docker codeback-pg) listens on 55432 - refuse it,
  # so a mis-paste can't "migrate production" against the wrong database.
  if ($env:DATABASE_URL -match '@(localhost|127\.0\.0\.1):55432/') {
    Write-Host 'That is the LOCAL dev database (port 55432). Nothing was run.' -ForegroundColor Red
    exit 1
  }

  $confirm = Read-Host -Prompt 'Type MIGRATE to apply migrations to that database'
  if ($confirm -cne 'MIGRATE') {
    Write-Host 'Cancelled. Nothing was run.'
    exit 1
  }

  Write-Host "`n=== prisma migrate deploy ===" -ForegroundColor Cyan
  & npx prisma migrate deploy
  $deployCode = $LASTEXITCODE

  Write-Host "`n=== prisma migrate status ===" -ForegroundColor Cyan
  & npx prisma migrate status
  $statusCode = $LASTEXITCODE

  if ($deployCode -ne 0) {
    Write-Host "`nmigrate deploy FAILED (exit $deployCode). Do not push; paste the output above." -ForegroundColor Red
  } elseif ($statusCode -ne 0) {
    Write-Host "`nmigrate status reports a problem (exit $statusCode). Paste the output above." -ForegroundColor Yellow
  } else {
    Write-Host "`nDone. Paste the migrate status output." -ForegroundColor Green
  }
  $exitCode = [Math]::Max($deployCode, $statusCode)
}
finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  $confirm = $null
}
exit $exitCode
