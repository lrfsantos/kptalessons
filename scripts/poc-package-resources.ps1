# Empacota os recursos do sidecar para a prova de conceito Tauri.
# Copia para src-tauri/resources/: node.exe, src-node/, lib/, ui/painel.html,
# node_modules/playwright-core/. Nao inclui navegador nenhum.
param(
  [string]$NodeExe = "C:\Users\luiza\Desktop\corretor cna\runtime\node\node.exe"
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $repo 'src-tauri\resources'

Write-Output "Repositorio: $repo"
Write-Output "Node: $NodeExe"

if (-not (Test-Path $NodeExe)) { throw "Node nao encontrado: $NodeExe" }

if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dest | Out-Null

Copy-Item $NodeExe (Join-Path $dest 'node.exe')
Copy-Item (Join-Path $repo 'src-node') (Join-Path $dest 'src-node') -Recurse
Copy-Item (Join-Path $repo 'lib') (Join-Path $dest 'lib') -Recurse
New-Item -ItemType Directory -Force -Path (Join-Path $dest 'ui') | Out-Null
Copy-Item (Join-Path $repo 'ui\painel.html') (Join-Path $dest 'ui\painel.html')
Copy-Item (Join-Path $repo 'poc-ui') (Join-Path $dest 'poc-ui') -Recurse
Copy-Item (Join-Path $repo 'node_modules\playwright-core') (Join-Path $dest 'node_modules\playwright-core') -Recurse

$total = (Get-ChildItem $dest -Recurse -File | Measure-Object Length -Sum).Sum
$nodeSize = (Get-Item (Join-Path $dest 'node.exe')).Length
$pwc = (Get-ChildItem (Join-Path $dest 'node_modules\playwright-core') -Recurse -File | Measure-Object Length -Sum).Sum
Write-Output ("Total recursos: {0:N2} MB" -f ($total / 1MB))
Write-Output ("  node.exe:    {0:N2} MB" -f ($nodeSize / 1MB))
Write-Output ("  playwright-core: {0:N2} MB" -f ($pwc / 1MB))
Write-Output 'Empacotamento concluido.'
