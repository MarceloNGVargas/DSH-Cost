#requires -Version 5.1
<#
    Cria (ou remove) o atalho do monitor na Área de Trabalho do usuário.

    Uso:
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File instalar-na-area-de-trabalho.ps1
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File instalar-na-area-de-trabalho.ps1 -Remover
#>
param(
    [switch]$Remover
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath('Desktop')
$linkPath = Join-Path $desktop 'DSH Custo em tempo real.lnk'

if ($Remover) {
    if (Test-Path -LiteralPath $linkPath) {
        Remove-Item -LiteralPath $linkPath -Force
        Write-Output "atalho removido: $linkPath"
    } else {
        Write-Output 'nada a remover: o atalho não existe'
    }
    exit 0
}

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$launcher = Join-Path $here 'abrir-monitor.ps1'
if (-not (Test-Path -LiteralPath $launcher)) { throw "launcher não encontrado: $launcher" }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '"'
$shortcut.WorkingDirectory = $here
$shortcut.WindowStyle = 7
$shortcut.Description = 'Monitor de custo e tokens do DeepSeek Harness em tempo real'

# Ícone do aplicativo DSH, quando disponível.
$icon = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\tray.ico'
if (Test-Path -LiteralPath $icon) { $shortcut.IconLocation = "$icon,0" }

$shortcut.Save()

Write-Output "atalho criado: $linkPath"
