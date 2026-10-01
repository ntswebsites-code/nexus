<#
.SYNOPSIS
  Builds the UAT release tarball from a git ref: committed files only, no node_modules, .next,
  dist, .env*, secrets or tsbuildinfo. Output: <OutDir>\<Release>.tar.gz plus .sha256 and
  .manifest.txt (deploy/deploy.sh verifies the .sha256 when it sits next to the tarball).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools/uat/pack-release.ps1 -Ref uat-rc1
  powershell -ExecutionPolicy Bypass -File tools/uat/pack-release.ps1 -Ref dev -Release uat-rc1-rehearsal -OutDir C:\temp\rel
#>
param(
  [Parameter(Mandatory = $true)][string]$Ref,
  [string]$Release,
  [string]$OutDir = (Join-Path $env:TEMP 'nexus-release')
)
$ErrorActionPreference = 'Stop'
if (-not $Release) { $Release = $Ref -replace '^refs/(tags|heads)/', '' }
if ($Release -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$' -or $Release -eq 'latest') {
  throw "Release name '$Release' is not valid (letters, digits, . _ -; not 'latest')."
}

$root = (git rev-parse --show-toplevel).Trim()
Set-Location $root
$commit = (git rev-parse --verify "$Ref^{commit}").Trim()
if ($LASTEXITCODE -ne 0 -or -not $commit) { throw "Unknown git ref '$Ref'." }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$out = Join-Path $OutDir "$Release.tar.gz"
if (Test-Path $out) { Remove-Item $out -Force }

$excludes = @(
  ':(exclude,glob)**/node_modules/**',
  ':(exclude,glob)**/.next/**',
  ':(exclude,glob)**/dist/**',
  ':(exclude,glob)**/.env',
  ':(exclude,glob)**/.env.*',
  ':(exclude,glob)**/secrets/**',
  ':(exclude,glob)**/*.tsbuildinfo',
  ':(exclude,glob)**/*.sql.gz'
)
# core.autocrlf=false: archive the blobs exactly as committed (LF), so the host scripts run.
git -c core.autocrlf=false -c core.eol=lf archive --format=tar.gz -o $out $commit -- . @excludes
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }

$files = & tar -tzf $out
if ($LASTEXITCODE -ne 0) { throw 'tar could not list the archive' }
$forbidden = $files | Where-Object {
  ($_ -notmatch '\.example$') -and
  ($_ -match '(^|/)\.env(\.[^/]*)?$|(^|/)secrets(/|$)|(^|/)node_modules/|(^|/)\.next/|(^|/)dist/|\.tsbuildinfo$')
}
if ($forbidden) {
  Remove-Item $out -Force
  throw "Archive would contain forbidden paths:`n$($forbidden -join "`n")"
}

$hash = (Get-FileHash -Algorithm SHA256 $out).Hash.ToLower()
$name = Split-Path $out -Leaf
[IO.File]::WriteAllText("$out.sha256", "$hash  $name`n", (New-Object Text.UTF8Encoding $false))
$manifest = @(
  "release=$Release",
  "ref=$Ref",
  "commit=$commit",
  "created=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))",
  "entries=$($files.Count)",
  "sha256=$hash"
) -join "`n"
[IO.File]::WriteAllText("$out.manifest.txt", "$manifest`n", (New-Object Text.UTF8Encoding $false))

$size = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host "Release $Release ($commit) -> $out ($size MB, $($files.Count) entries)"
Write-Host ''
Write-Host 'Next (coordinator):'
Write-Host "  ssh -i ~/.ssh/id_ed25519 root@207.180.234.151 `"mkdir -p /root/nexus-releases`""
Write-Host "  scp -i ~/.ssh/id_ed25519 `"$out`" `"$out.sha256`" root@207.180.234.151:/root/nexus-releases/"
Write-Host "  ssh -i ~/.ssh/id_ed25519 root@207.180.234.151 `"mkdir -p /root/nexus-releases/$Release && tar -xzf /root/nexus-releases/$name -C /root/nexus-releases/$Release deploy/deploy.sh deploy/rollback.sh`""
Write-Host "  ssh -i ~/.ssh/id_ed25519 root@207.180.234.151 `"DETACH=1 bash /root/nexus-releases/$Release/deploy/deploy.sh $Release api worker admin investor onboarding company custodian mailpit`""
