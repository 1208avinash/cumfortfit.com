$ErrorActionPreference = "Stop"

$expectedHost = "db.dkcjzisqufqgjtrgstch.supabase.co"
if ($env:PGHOST -ne $expectedHost) {
  throw "Refusing to run: PGHOST must be exactly $expectedHost."
}
if (-not [string]::IsNullOrWhiteSpace($env:PGHOSTADDR) -or
    -not [string]::IsNullOrWhiteSpace($env:PGSERVICE)) {
  throw "Refusing to run with PGHOSTADDR or PGSERVICE set; these can redirect the connection."
}
if ($env:PGDATABASE -ne "postgres") {
  throw "Refusing to run: PGDATABASE must be exactly postgres."
}
if ([string]::IsNullOrWhiteSpace($env:PGUSER) -or
    [string]::IsNullOrWhiteSpace($env:PGPASSWORD)) {
  throw "Set PGUSER and PGPASSWORD securely for the staging database connection."
}

$port = 5432
if (-not [string]::IsNullOrWhiteSpace($env:PGPORT)) {
  $parsedPort = 0
  if (-not [int]::TryParse($env:PGPORT, [ref]$parsedPort) -or
      $parsedPort -lt 1 -or $parsedPort -gt 65535) {
    throw "PGPORT must be a valid TCP port."
  }
  $port = $parsedPort
}

if ([string]::IsNullOrWhiteSpace($env:PGSSLROOTCERT) -or
    -not (Test-Path -LiteralPath $env:PGSSLROOTCERT -PathType Leaf)) {
  throw "Set PGSSLROOTCERT to a trusted PostgreSQL server CA certificate file."
}
$env:PGSSLROOTCERT = (Resolve-Path -LiteralPath $env:PGSSLROOTCERT).Path
$env:PGSSLMODE = "verify-full"

$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
  throw "psql was not found. Configure PostgreSQL client tools before running staging tests."
}

$connectionArgs = @(
  "-X", "-h", $expectedHost, "-p", "$port", "-d", "postgres", "-U", $env:PGUSER,
  "-A", "-t", "-v", "ON_ERROR_STOP=1"
)
$identityOutput = & $psql.Source @connectionArgs `
  -c "SELECT current_database();" `
  -c "\conninfo" 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Could not verify the staging database identity and TLS connection; SQL tests were not run."
}
$identityText = $identityOutput -join "`n"
if ($identityText -notmatch "(?m)^postgres\s*$" -or
    $identityText -notmatch [regex]::Escape($expectedHost) -or
    $identityText -notmatch "via SSL") {
  throw "Connected database identity or verified TLS did not match staging; SQL tests were not run."
}

$testFile = Join-Path $PSScriptRoot "011_rls_permission_tests.sql"
& $psql.Source @connectionArgs `
  -v cfp_staging_project_ref=dkcjzisqufqgjtrgstch `
  -f $testFile
if ($LASTEXITCODE -ne 0) {
  throw "Staging RLS permission tests failed (psql exit code $LASTEXITCODE)."
}
