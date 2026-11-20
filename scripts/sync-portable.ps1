# Sincroniza a instalação portátil Windows com o HEAD do repositório.
# Preserva runtime/, node_modules/ e dados locais. Cria backup antes.
param(
  [Parameter(Mandatory=$true)][string]$InstallPath,
  [string]$RepoPath = ''
)

$ErrorActionPreference = 'Stop'
if (-not $RepoPath) { $RepoPath = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }
$repo = (Resolve-Path $RepoPath).Path
$dest = (Resolve-Path $InstallPath -ErrorAction SilentlyContinue)
if (-not $dest) { throw "Instalação não encontrada: $InstallPath" }
$dest = $dest.Path

Write-Output "Repositório: $repo"
Write-Output "Instalação: $dest"

# 1) Backup privado fora da instalação
$backup = Join-Path (Split-Path -Parent $dest) ("corretor-cna-backup-" + (Get-Date -Format yyyyMMdd-HHmmss))
Copy-Item $dest $backup -Recurse -Force
if (-not (Test-Path (Join-Path $backup 'Corrigir.cmd'))) { throw 'Falha no backup.' }
Write-Output "Backup criado: $backup"

# 2) Copia SOMENTE arquivos rastreados pelo Git, exceto dados locais
$tracked = & git -C $repo ls-files
$skipPrefixes = @('lotes/', 'answers.json', 'report.json', 'revisao.md', 'relatorio-ia.md')
$copied = @()
foreach ($rel in $tracked) {
  $skip = $false
  foreach ($pre in $skipPrefixes) { if ($rel -eq $pre -or $rel.StartsWith($pre)) { $skip = $true; break } }
  if ($skip) { continue }
  $srcFile = Join-Path $repo $rel
  $dstFile = Join-Path $dest $rel
  if (-not (Test-Path $srcFile)) { continue }
  $dstDir = Split-Path -Parent $dstFile
  if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Force $dstDir | Out-Null }
  Copy-Item $srcFile $dstFile -Force
  $copied += $rel
}
Write-Output "Arquivos atualizados: $($copied.Count)"

# 3) Garante diretórios locais essenciais (sem apagar nada)
New-Item -ItemType Directory -Force (Join-Path $dest 'lotes') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $dest 'lotes\retornos-da-IA') | Out-Null

# 4) Preflight na instalação
Push-Location $dest
try {
  $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $dest 'runtime\ms-playwright'
  $env:BROWSER = 'chromium'
  & ".\runtime\node\node.exe" preflight.js
  if ($LASTEXITCODE -ne 0) { throw 'Preflight falhou na instalação.' }
} finally { Pop-Location }

Write-Output 'Sincronização concluída e validada.'
