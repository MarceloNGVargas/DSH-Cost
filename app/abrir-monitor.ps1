#requires -Version 5.1
<#
    Abre o monitor visual do dsh-session-cost:
      1. garante o agregador (monitor.mjs) rodando em segundo plano;
      2. abre a janela WPF (SessionCostMonitor.ps1).

    Uso: powershell.exe -NoProfile -ExecutionPolicy Bypass -File abrir-monitor.ps1 [-NoTopmost]
#>
param(
    [switch]$NoTopmost,
    [switch]$NoAggregator
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Resolve-Node {
    $command = Get-Command node -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $runtimes = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes'
    if (Test-Path -LiteralPath $runtimes) {
        $candidates = Get-ChildItem -LiteralPath $runtimes -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'dependencies\node\bin\node.exe' } |
            Where-Object { Test-Path -LiteralPath $_ }
        if ($candidates) { return @($candidates)[0] }
    }
    return $null
}

if (-not $NoAggregator) {
    $node = Resolve-Node
    if ($node) {
        Start-Process -FilePath $node `
            -ArgumentList @((Join-Path $here 'monitor.mjs'), '--interval', '1000') `
            -WindowStyle Hidden
    } else {
        Write-Warning 'node.exe não encontrado: o app mostrará o último live.json sem atualização contínua.'
    }
}

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$uiArgs = @('-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $here 'SessionCostMonitor.ps1'))
if ($NoTopmost) { $uiArgs += '-NoTopmost' }

Start-Process -FilePath $powershell -ArgumentList $uiArgs -WindowStyle Hidden
