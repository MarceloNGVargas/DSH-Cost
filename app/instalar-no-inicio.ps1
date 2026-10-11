#requires -Version 5.1
<#
    Cria (ou remove) o atalho do monitor na pasta Inicializar do Windows, para o
    app abrir sozinho quando o usuário liga o computador.

    Uso:
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File instalar-no-inicio.ps1
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File instalar-no-inicio.ps1 -Remover
#>
param(
    [switch]$Remover
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$startup = [Environment]::GetFolderPath('Startup')
$linkPath = Join-Path $startup 'DSH Custo em tempo real.lnk'

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

if (-not (Test-Path -LiteralPath $launcher)) {
    throw "launcher não encontrado: $launcher"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '"'
$shortcut.WorkingDirectory = $here
$shortcut.WindowStyle = 7
$shortcut.Description = 'Monitor de custo e tokens do DeepSeek Harness em tempo real'
$shortcut.Save()

Write-Output "atalho criado: $linkPath"
Write-Output 'o monitor passa a abrir junto com o Windows; use -Remover para desfazer.'
