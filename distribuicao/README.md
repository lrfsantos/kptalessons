# Copia os arquivos de distribuição do repo para a instalação portátil.
# Corrigir.cmd e preflight.js vivem aqui (não na raiz) para não serem
# confundidos com o fluxo de desenvolvimento do repositório.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dist = Join-Path $repo 'distribuicao'
foreach ($name in @('Corrigir.cmd', 'preflight.js')) {
  $src = Join-Path $dist $name
  if (-not (Test-Path $src)) { throw "Arquivo de distribuição ausente: $src" }
  Write-Output "OK: $name"
}
