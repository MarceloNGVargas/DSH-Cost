#requires -Version 5.1
<#
    Monitor visual do dsh-session-cost (Windows PowerShell 5.1, STA).

    Janela nativa (WPF) sempre no topo, com três abas:
      Ao vivo   - custo de hoje (R$ e US$), chamada em andamento com cronômetro,
                  última requisição e as requisições recentes da sessão ativa;
      Sessões   - nome (título) e custo de CADA sessão medida, em R$ e US$;
      Histórico - consumo dia a dia (requisições, tokens, tempo, R$ e US$).

    Lê ~/.dsh/session-cost/live.json a cada 500 ms.

    Uso: powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -File SessionCostMonitor.ps1 [-Tab 0..2] [-IntervalMs 500]
#>
param(
    [int]$IntervalMs = 500,
    [int]$Tab = 0,
    [string]$Language = 'auto',
    [switch]$NoTopmost
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$script:livePath = Join-Path $env:USERPROFILE '.dsh\session-cost\live.json'
$script:dataDir = Split-Path $script:livePath -Parent
$script:lastRead = $null

# --- idioma da interface (pt-BR | en | es | zh-CN) ---------------------------
function Resolve-UiLanguage([string]$requested) {
    $supported = @('pt-BR', 'en', 'es', 'zh-CN')
    if ($requested -and $requested.ToLowerInvariant() -ne 'auto') {
        $exact = @($supported | Where-Object { $_.ToLowerInvariant() -eq $requested.ToLowerInvariant() })[0]
        if ($exact) { return $exact }
        $primary = ($requested -split '[-_]')[0].ToLowerInvariant()
        $match = @($supported | Where-Object { ($_ -split '-')[0].ToLowerInvariant() -eq $primary })[0]
        if ($match) { return $match }
    }
    $system = [System.Globalization.CultureInfo]::CurrentUICulture.Name
    $primary = ($system -split '[-_]')[0].ToLowerInvariant()
    $match = @($supported | Where-Object { ($_ -split '-')[0].ToLowerInvariant() -eq $primary })[0]
    if ($match) { return $match }
    return 'en'
}

$script:language = Resolve-UiLanguage $Language
# Números e datas seguem o idioma escolhido (separador decimal etc.).
try { [System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::GetCultureInfo($script:language) } catch { }
$script:strings = @{}
$script:localeDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'locales'
foreach ($candidate in @($script:language, 'pt-BR', 'en')) {
    $file = Join-Path $script:localeDir ($candidate + '.json')
    if (-not (Test-Path -LiteralPath $file)) { continue }
    $loaded = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($property in $loaded.PSObject.Properties) {
        if (-not $script:strings.ContainsKey($property.Name)) { $script:strings[$property.Name] = $property.Value }
    }
    break
}

# Traduz uma chave, substituindo {0}, {1}, ... pelos valores informados.
function T([string]$key, [object[]]$values) {
    $text = $script:strings[$key]
    if ($null -eq $text) { return $key }
    $result = [string]$text
    if ($null -ne $values) {
        for ($i = 0; $i -lt $values.Count; $i++) {
            $result = $result.Replace('{' + $i + '}', [string]$values[$i])
        }
    }
    return $result
}

$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="DSH · Custo em tempo real"
        Height="830" Width="826" Left="20" Top="20"
        WindowStartupLocation="Manual"
        Background="#0d1117" Foreground="#e6edf3"
        FontFamily="Segoe UI" FontSize="12"
        ResizeMode="CanResizeWithGrip" ShowInTaskbar="True">
  <Border Padding="14">
    <Grid>
      <Grid.RowDefinitions>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="*"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
      </Grid.RowDefinitions>

      <!-- cabeçalho -->
      <Grid Grid.Row="0" Margin="0,0,0,10" x:Name="header">
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="Auto"/>
        </Grid.ColumnDefinitions>
        <Ellipse x:Name="dot" Grid.Column="0" Width="10" Height="10" Fill="#8b949e" VerticalAlignment="Center" Margin="0,0,8,0"/>
        <StackPanel Grid.Column="1">
          <TextBlock x:Name="txtHeaderTitle" Text="Custo em tempo real" FontSize="15" FontWeight="SemiBold"/>
          <TextBlock x:Name="txtSession" Text="sessão —" FontSize="10.5" Foreground="#8b949e"/>
          <TextBlock x:Name="txtModelInfo" Text="" FontSize="10.5" Foreground="#58a6ff"/>
        </StackPanel>
        <TextBlock x:Name="txtPeak" Grid.Column="2" Text="" FontSize="10" Foreground="#f0c674" VerticalAlignment="Center"/>
      </Grid>

      <TabControl x:Name="tabs" Grid.Row="1" Background="#0d1117" Foreground="#e6edf3" BorderBrush="#30363d" Padding="0">
        <TabControl.Resources>
          <Style TargetType="TabItem">
            <Setter Property="Background" Value="#161b22"/>
            <Setter Property="Foreground" Value="#e6edf3"/>
            <Setter Property="Padding" Value="12,6"/>
          </Style>
        </TabControl.Resources>

        <!-- ================= ao vivo ================= -->
        <TabItem Header="Ao vivo">
          <Grid Margin="0,8,0,0">
            <Grid.RowDefinitions>
              <RowDefinition Height="Auto"/>
              <RowDefinition Height="Auto"/>
              <RowDefinition Height="Auto"/>
              <RowDefinition Height="Auto"/>
              <RowDefinition Height="*"/>
            </Grid.RowDefinitions>

            <Border Grid.Row="0" Background="#161b22" CornerRadius="8" Padding="12" Margin="0,0,0,8">
              <StackPanel>
                <TextBlock x:Name="txtTodayLabel" Text="HOJE" FontSize="10" Foreground="#8b949e"/>
                <TextBlock x:Name="txtTodayBrl" Text="R$ —" FontSize="34" FontWeight="Bold" Foreground="#3fb950" Margin="0,2,0,0"/>
                <TextBlock x:Name="txtTodayUsd" Text="US$ —" FontSize="12" Foreground="#c9d1d9"/>
                <TextBlock x:Name="txtTodayMeta" Text="0 requisições · 0 tokens · 0 s de modelo" FontSize="10" Foreground="#8b949e" Margin="0,4,0,0"/>
                <TextBlock x:Name="txtTodaySplit" Text="" FontSize="10" Foreground="#58a6ff" Margin="0,2,0,0"/>
                <TextBlock x:Name="txtTodaySavings" Text="" FontSize="10" Foreground="#3fb950" Margin="0,2,0,0"/>
              </StackPanel>
            </Border>

            <!-- sessões em andamento (uma linha por sessão processando) -->
            <Border x:Name="cardRunning" Grid.Row="1" Background="#161b22" CornerRadius="8" Padding="12" Margin="0,0,0,8">
              <StackPanel>
                <TextBlock x:Name="txtRunningTitle" Text="SESSÕES EM ANDAMENTO" FontSize="10" Foreground="#8b949e" Margin="0,0,0,6"/>
                <TextBlock x:Name="txtRunning" FontFamily="Consolas" FontSize="10.5" Foreground="#8b949e" Text="nada processando agora"/>
              </StackPanel>
            </Border>

            <Border x:Name="cardInflight" Grid.Row="2" Background="#12261c" CornerRadius="8" Padding="12" Margin="0,0,0,8" Visibility="Collapsed">
              <StackPanel>
                <TextBlock x:Name="txtInflightTitle" Text="▶ EM ANDAMENTO" FontSize="10" Foreground="#3fb950"/>
                <TextBlock x:Name="txtInflightModel" Text="—" FontSize="13" FontWeight="SemiBold"/>
                <TextBlock x:Name="txtInflightTime" Text="0,0 s" FontSize="26" FontWeight="Bold" Foreground="#e6edf3"/>
                <TextBlock x:Name="txtInflightDetail" Text="" FontSize="10" Foreground="#8b949e"/>
              </StackPanel>
            </Border>

            <Border x:Name="cardLast" Grid.Row="3" Background="#161b22" CornerRadius="8" Padding="12" Margin="0,0,0,8">
              <StackPanel>
                <TextBlock x:Name="txtLastTitle" Text="ÚLTIMA REQUISIÇÃO" FontSize="10" Foreground="#8b949e"/>
                <TextBlock x:Name="txtLastModel" Text="—" FontSize="13" FontWeight="SemiBold"/>
                <TextBlock x:Name="txtLastMeta" Text="" FontSize="10" Foreground="#8b949e" Margin="0,2,0,0"/>
                <TextBlock x:Name="txtLastCost" Text="" FontSize="14" Foreground="#58a6ff" Margin="0,4,0,0"/>
                <TextBlock x:Name="txtLastSplit" Text="" FontSize="10" Foreground="#8b949e" Margin="0,2,0,0"/>
                <TextBlock x:Name="txtLastSavings" Text="" FontSize="10" Foreground="#3fb950" Margin="0,2,0,0"/>
              </StackPanel>
            </Border>

            <Border Grid.Row="4" Background="#161b22" CornerRadius="8" Padding="12">
              <DockPanel>
                <TextBlock DockPanel.Dock="Top" x:Name="txtRecentTitle" Text="RECENTES" FontSize="10" Foreground="#8b949e" Margin="0,0,0,6"/>
                <ScrollViewer VerticalScrollBarVisibility="Auto">
                  <TextBlock x:Name="txtRecent" FontFamily="Consolas" FontSize="10.5" Foreground="#c9d1d9" Text="Aguardando dados…"/>
                </ScrollViewer>
              </DockPanel>
            </Border>
          </Grid>
        </TabItem>

        <!-- ================= sessões ================= -->
        <TabItem Header="Sessões">
          <Border Background="#161b22" CornerRadius="8" Padding="12" Margin="0,8,0,0">
            <DockPanel>
              <TextBlock DockPanel.Dock="Top" x:Name="txtSessionsTitle" Text="SESSÕES" FontSize="10" Foreground="#8b949e" Margin="0,0,0,6"/>
              <ScrollViewer VerticalScrollBarVisibility="Auto">
                <TextBlock x:Name="txtSessions" FontFamily="Consolas" FontSize="10.5" Foreground="#c9d1d9" Text="Aguardando dados…"/>
              </ScrollViewer>
            </DockPanel>
          </Border>
        </TabItem>

        <!-- ================= histórico ================= -->
        <TabItem Header="Histórico">
          <Border Background="#161b22" CornerRadius="8" Padding="12" Margin="0,8,0,0">
            <DockPanel>
              <TextBlock DockPanel.Dock="Top" x:Name="txtHistoryTitle" Text="HISTÓRICO DIÁRIO" FontSize="10" Foreground="#8b949e" Margin="0,0,0,6"/>
              <ScrollViewer VerticalScrollBarVisibility="Auto">
                <TextBlock x:Name="txtHistory" FontFamily="Consolas" FontSize="10.5" Foreground="#c9d1d9" Text="Aguardando dados…"/>
              </ScrollViewer>
            </DockPanel>
          </Border>
        </TabItem>
      </TabControl>

      <!-- rodapé -->
      <StackPanel Grid.Row="2" Margin="0,8,0,0">
        <TextBlock x:Name="txtFx" Text="cotação —" FontSize="10" Foreground="#8b949e"/>
        <TextBlock x:Name="txtUpdated" Text="sem dados ainda" FontSize="10" Foreground="#8b949e"/>
      </StackPanel>

      <!-- botões -->
      <StackPanel Grid.Row="3" Orientation="Horizontal" Margin="0,10,0,0">
        <ToggleButton x:Name="btnTop" Content="Fixar no topo" IsChecked="True" Padding="8,4" Margin="0,0,6,0"/>
        <Button x:Name="btnRefresh" Content="Atualizar" Padding="8,4" Margin="0,0,6,0"/>
        <Button x:Name="btnFolder" Content="Pasta de dados" Padding="8,4" Margin="0,0,6,0"/>
        <Button x:Name="btnClose" Content="Sair" Padding="8,4"/>
      </StackPanel>
    </Grid>
  </Border>
</Window>
'@

$window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader ([xml]$xaml)))
$window.Topmost = -not $NoTopmost

$elm = @{}
foreach ($name in 'dot', 'txtSession', 'txtModelInfo', 'txtPeak', 'tabs', 'txtHeaderTitle', 'txtInflightTitle', 'txtLastTitle',
    'txtTodayLabel', 'txtTodayBrl', 'txtTodayUsd', 'txtTodayMeta', 'txtTodaySplit', 'txtTodaySavings',
    'cardRunning', 'txtRunningTitle', 'txtRunning',
    'cardInflight', 'txtInflightModel', 'txtInflightTime', 'txtInflightDetail',
    'cardLast', 'txtLastModel', 'txtLastMeta', 'txtLastCost', 'txtLastSplit', 'txtLastSavings',
    'txtRecent', 'txtRecentTitle',
    'txtSessions', 'txtSessionsTitle', 'txtHistory', 'txtHistoryTitle',
    'txtFx', 'txtUpdated', 'btnTop', 'btnRefresh', 'btnFolder', 'btnClose', 'header') {
    $elm[$name] = $window.FindName($name)
}

# --- textos fixos, no idioma escolhido ---------------------------------------
$window.Title = T 'windowTitle'
$elm['txtHeaderTitle'].Text = T 'headerTitle'
$elm['txtInflightTitle'].Text = T 'inflightTitle'
$elm['txtLastTitle'].Text = T 'lastTitle'
$elm['txtRunningTitle'].Text = T 'runningTitle'
$elm['txtRunning'].Text = T 'runningIdle'
$elm['btnTop'].Content = T 'btnTop'
$elm['btnRefresh'].Content = T 'btnRefresh'
$elm['btnFolder'].Content = T 'btnFolder'
$elm['btnClose'].Content = T 'btnClose'
[void]($elm['tabs'].Items[0].Header = (T 'tabLive'))
[void]($elm['tabs'].Items[1].Header = (T 'tabSessions'))
[void]($elm['tabs'].Items[2].Header = (T 'tabHistory'))

function Format-Brl([double]$value) {
    if ([math]::Abs($value) -lt 0.01) { return 'R$ ' + $value.ToString('0.000000', [Globalization.CultureInfo]::InvariantCulture) }
    return 'R$ ' + $value.ToString('0.0000', [Globalization.CultureInfo]::InvariantCulture)
}

function Format-Usd([double]$value) {
    if ([math]::Abs($value) -lt 0.01) { return 'US$ ' + $value.ToString('0.000000', [Globalization.CultureInfo]::InvariantCulture) }
    return 'US$ ' + $value.ToString('0.0000', [Globalization.CultureInfo]::InvariantCulture)
}

function Format-Duration([double]$ms) {
    if ($ms -lt 1000) { return ('{0:0} ms' -f $ms) }
    if ($ms -lt 60000) { return ('{0:0.00} s' -f ($ms / 1000)) }
    return ('{0:0} min {1:0.0} s' -f [math]::Floor($ms / 60000), (($ms % 60000) / 1000))
}

function Format-DurationShort([double]$ms) {
    if ($ms -lt 1000) { return ('{0:0}ms' -f $ms) }
    if ($ms -lt 60000) { return ('{0:0}s' -f ($ms / 1000)) }
    if ($ms -lt 3600000) { return ('{0:0}m' -f [math]::Floor($ms / 60000)) }
    return ('{0:0}h{1:00}' -f [math]::Floor($ms / 3600000), [math]::Floor(($ms % 3600000) / 60000))
}

function Format-Tokens([double]$n) {
    if ($n -ge 1000000) { return ('{0:0.00}M' -f ($n / 1000000)) }
    if ($n -ge 1000) { return ('{0:0.0}k' -f ($n / 1000)) }
    return ('{0:0}' -f $n)
}

# Versão compacta para caber em coluna fixa (no máximo 6 caracteres).
function Format-TokensShort([double]$n) {
    if ($n -ge 100000000) { return ('{0:0}M' -f [math]::Floor($n / 1000000)) }
    if ($n -ge 1000000) { return ('{0:0.0}M' -f ($n / 1000000)) }
    if ($n -ge 1000) { return ('{0:0.0}k' -f ($n / 1000)) }
    return ('{0:0}' -f $n)
}

function Format-Time([long]$unixMs) {
    return ([DateTimeOffset]::FromUnixTimeMilliseconds($unixMs).ToLocalTime().ToString('HH:mm:ss'))
}

function Short-Model([string]$model) {
    if ([string]::IsNullOrWhiteSpace($model)) { return '?' }
    if ($model.Length -le 16) { return $model }
    return $model.Substring(0, 15) + '…'
}

function Short-Text([string]$text, [int]$max) {
    if ([string]::IsNullOrWhiteSpace($text)) { return '' }
    $value = $text.Trim()
    if ($value.Length -le $max) { return $value }
    return $value.Substring(0, [math]::Max(1, $max - 1)) + '…'
}

function Short-Session([string]$sessionId) {
    if ([string]::IsNullOrWhiteSpace($sessionId)) { return '—' }
    if ($sessionId.Length -le 13) { return $sessionId }
    return '…' + $sessionId.Substring($sessionId.Length - 12)
}

# Nome de exibição do modelo, do catálogo do adapter (ex.: DeepSeek-V41-Flash).
function ModelName($live, $model) {
    $m = [string]$model
    if ([string]::IsNullOrWhiteSpace($m)) { return '?' }
    if ($null -ne $live.modelNames) {
        $name = $live.modelNames.$m
        if (-not [string]::IsNullOrWhiteSpace([string]$name)) { return [string]$name }
    }
    return $m
}

# Esforço de raciocínio da requisição/sessão (Low | Medium | High | Max).
function EffortText($effort) {
    if ([string]::IsNullOrWhiteSpace([string]$effort)) { return '—' }
    $value = ([string]$effort).Trim().ToLowerInvariant()
    switch ($value) {
        'low' { return 'Low' }
        'medium' { return 'Medium' }
        'high' { return 'High' }
        'max' { return 'Max' }
        default { return ([string]$effort).Trim() }
    }
}

function Read-Live {
    try {
        if (-not (Test-Path -LiteralPath $script:livePath)) { return $null }
        return (Get-Content -LiteralPath $script:livePath -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json)
    } catch {
        return $script:lastRead
    }
}

function TotalTokens($tokens) {
    if ($null -eq $tokens) { return 0 }
    # vale para o usage cru (miss + cache + write + saída) e para os agregados do snapshot
    return [double]$tokens.inputTokens + [double]$tokens.cacheReadTokens + [double]$tokens.cacheWriteTokens + [double]$tokens.outputTokens
}

function Money($value) {
    if ($null -eq $value) { return '—' }
    $v = [double]$value
    if ([math]::Abs($v) -lt 0.01) { return $v.ToString('0.000000', [Globalization.CultureInfo]::InvariantCulture) }
    return $v.ToString('0.0000', [Globalization.CultureInfo]::InvariantCulture)
}

# Divisão entrada/saída, nas DUAS moedas quando há cotação.
function SplitText($inputUsd, $outputUsd, $inputBrl, $outputBrl) {
    if ($null -ne $inputBrl) {
        return T 'splitEntryBoth' @((Money $inputBrl), (Money $inputUsd), (Money $outputBrl), (Money $outputUsd))
    }
    return T 'splitEntry' @((Money $inputUsd), (Money $outputUsd))
}

# Quanto o cache de entrada economizou (tokens lidos do cache em vez de miss).
function SavingsText($usd, $brl) {
    if ($null -eq $usd) { return '' }
    if ($null -ne $brl) { return ('R$ {0} (US$ {1})' -f (Money $brl), (Money $usd)) }
    return ('US$ {0}' -f (Money $usd))
}

function CacheHitPercent($tokens) {
    if ($null -eq $tokens) { return $null }
    $total = [double]$tokens.inputTokens + [double]$tokens.cacheReadTokens + [double]$tokens.cacheWriteTokens
    if ($total -le 0) { return $null }
    return (100.0 * [double]$tokens.cacheReadTokens / $total)
}

function Update-View {
    $live = Read-Live
    if ($null -eq $live) {
        $elm['dot'].Fill = '#8b949e'
        $elm['txtUpdated'].Text = T 'waitingLive'
        return
    }
    $script:lastRead = $live
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $ageMs = $now - [long]$live.updatedAt

    if ($ageMs -lt 3000) { $elm['dot'].Fill = '#3fb950' }
    elseif ($ageMs -lt 15000) { $elm['dot'].Fill = '#f0c674' }
    else { $elm['dot'].Fill = '#ff7b72' }

    # ---------------------------------------------------------------- cabeçalho
    $activeTitle = ''
    if ($null -ne $live.activeSessionTitle) { $activeTitle = [string]$live.activeSessionTitle }
    if ($activeTitle.Length -gt 0) {
        $elm['txtSession'].Text = T 'sessionActive' @((Short-Text $activeTitle 46))
    } else {
        $elm['txtSession'].Text = T 'sessionFallback' @((Short-Session ([string]$live.activeSessionId)))
    }
    $elm['txtPeak'].Text = if ($live.peak) { T 'bandPeak' } else { T 'bandOffPeak' }
    $activeModelId = if ($null -ne $live.activeModel) { [string]$live.activeModel } elseif ($live.lastRequest) { [string]$live.lastRequest.model } else { '' }
    $elm['txtModelInfo'].Text = T 'modelLine' @((ModelName $live $activeModelId), (EffortText $live.activeReasoningEffort))

    # ---------------------------------------------------------------- hoje
    $elm['txtTodayLabel'].Text = T 'todayLabel' @([string]$live.today.date)
    if ($null -eq $live.today.costBrl) {
        $elm['txtTodayBrl'].Text = T 'noRate'
        $elm['txtTodayBrl'].Foreground = '#f0c674'
    } else {
        $elm['txtTodayBrl'].Text = Format-Brl ([double]$live.today.costBrl)
        $elm['txtTodayBrl'].Foreground = '#3fb950'
    }
    $elm['txtTodayUsd'].Text = Format-Usd ([double]$live.today.costUsd)

    # Uma linha por sessão REALMENTE em processamento, com o consumo de cada uma.
    if ($null -ne $live.running -and $live.running.sessionCount -gt 0) {
        $runningLines = New-Object System.Collections.Generic.List[string]
        $runningLines.Add(('{0,-26} | {1,4} | {2,5} | {3,7} | {4,8} | {5,8}' -f (T 'colSession'), (T 'colReqs'), (T 'colTime'), (T 'colTokens'), (T 'colBrl'), (T 'colUsd')))
        $runningLines.Add('-' * 72)
        $runningSessions = @($live.running.sessions)
        foreach ($rs in ($runningSessions | Select-Object -First 6)) {
            $rsName = Short-Text ([string]$rs.title) 26
            if ($rsName.Length -eq 0) { $rsName = Short-Session ([string]$rs.sessionId) }
            $runningLines.Add(('{0,-26} | {1,4} | {2,5} | {3,7} | {4,8} | {5,8}' -f $rsName, $rs.requests,
                (Format-DurationShort ([double]$rs.durationMs)), (Format-TokensShort (TotalTokens $rs.tokens)),
                (Money $rs.costBrl), (Money $rs.costUsd)))
        }
        if ($runningSessions.Count -gt 6) { $runningLines.Add((T 'runningMore' @(($runningSessions.Count - 6)))) }
        $elm['txtRunning'].Text = ($runningLines -join "`n")
        $elm['txtRunning'].Foreground = '#58a6ff'
        $totalText = if ($null -ne $live.running.costBrl) {
            (Format-Brl ([double]$live.running.costBrl)) + ' (' + (Format-Usd ([double]$live.running.costUsd)) + ')'
        } else {
            Format-Usd ([double]$live.running.costUsd)
        }
        $elm['txtRunningTitle'].Text = T 'runningTitleCount' @($live.running.sessionCount, $totalText)
    } else {
        $elm['txtRunning'].Text = T 'runningIdle'
        $elm['txtRunning'].Foreground = '#8b949e'
        $elm['txtRunningTitle'].Text = T 'runningTitle'
    }
    $elm['txtTodayMeta'].Text = T 'todayMeta' @($live.today.requests, (Format-Tokens (TotalTokens $live.today.tokens)), (Format-Duration ([double]$live.today.durationMs)))
    $elm['txtTodaySplit'].Text = T 'splitPrefix' @((SplitText $live.today.costInputUsd $live.today.costOutputUsd $live.today.costInputBrl $live.today.costOutputBrl))
    $hit = CacheHitPercent $live.today.tokens
    $hitText = if ($null -eq $hit) { '' } else { T 'cacheHit' @(('{0:0.0}' -f $hit)) }
    $elm['txtTodaySavings'].Text = T 'savingsPrefix' @((SavingsText $live.today.savingsUsd $live.today.savingsBrl) + $hitText)

    # ---------------------------------------------------------------- em andamento
    if ($live.inflight -and $live.inflight.Count -gt 0) {
        $call = $live.inflight[0]
        $elapsed = $now - [long]$call.startedAt
        $elm['cardInflight'].Visibility = 'Visible'
        $elm['txtInflightModel'].Text = ModelName $live $call.model
        $elm['txtInflightTime'].Text = ('{0:0.0} s' -f ($elapsed / 1000))
        $detail = T 'effortPrefix' @((EffortText $call.reasoningEffort))
        $detail += if ($null -ne $call.ttftMs) { ' · ' + (T 'ttftFirst' @((Format-Duration ([double]$call.ttftMs)))) } else { ' · ' + (T 'ttftWaiting') }
        if ($call.usage) {
            $detail += T 'tokensInOut' @((Format-Tokens (TotalTokens $call.usage)), (Format-Tokens ([double]$call.usage.outputTokens)))
        }
        if ($live.inflight.Count -gt 1) { $detail += T 'inflightParallel' @(($live.inflight.Count - 1)) }
        $elm['txtInflightDetail'].Text = $detail
    } else {
        $elm['cardInflight'].Visibility = 'Collapsed'
    }

    # ---------------------------------------------------------------- última
    if ($live.lastRequest) {
        $last = $live.lastRequest
        $elm['cardLast'].Visibility = 'Visible'
        $elm['txtLastModel'].Text = (ModelName $live $last.model) + ' · ' + (Format-Time ([long]$last.at))
        $lastEffort = if ($null -ne $last.reasoningEffort) { $last.reasoningEffort } else { $live.activeReasoningEffort }
        $elm['txtLastMeta'].Text = T 'lastMeta' @((EffortText $lastEffort), (Format-Duration ([double]$last.durationMs)),
            (Format-Duration ([double]$last.ttftMs)), (Format-Tokens ([double]$last.usage.inputTokens)),
            (Format-Tokens ([double]$last.usage.cacheReadTokens)), (Format-Tokens ([double]$last.usage.outputTokens)))
        if ($null -eq $last.costBrl) {
            $elm['txtLastCost'].Text = (Format-Usd ([double]$last.costUsd)) + (T 'noRateShort')
        } else {
            $elm['txtLastCost'].Text = (Format-Brl ([double]$last.costBrl)) + '   (' + (Format-Usd ([double]$last.costUsd)) + ')'
        }
        $elm['txtLastSplit'].Text = SplitText $last.costInputUsd $last.costOutputUsd $last.costInputBrl $last.costOutputBrl
        $elm['txtLastSavings'].Text = T 'savingsPrefix' @((SavingsText $last.savingsUsd $last.savingsBrl))
    } else {
        $elm['cardLast'].Visibility = 'Collapsed'
    }

    # ---------------------------------------------------------------- recentes
    $lines = New-Object System.Collections.Generic.List[string]
    $rows = @($live.recent | Where-Object { $null -eq $live.activeSessionId -or $_.sessionId -eq $live.activeSessionId })
    if ($rows.Count -eq 0) { $rows = @($live.recent) }
    $lines.Add(('{0,-8} | {1,-19} | {2,-7} | {3,5} | {4,7} | {5,7} | {6,8} | {7,8} | {8,8} | {9,8}' -f (T 'colHour'), (T 'colModel'), (T 'colEffort'), (T 'colTime'), (T 'colIn'), (T 'colOut'), (T 'colBrl'), (T 'colUsd'), (T 'colEconBrl'), (T 'colEconUsd')))
    $lines.Add('-' * 112)
    foreach ($row in ($rows | Select-Object -First 14)) {
        $effort = if ($null -ne $row.reasoningEffort) { $row.reasoningEffort } else { $live.activeReasoningEffort }
        $lines.Add(('{0,-8} | {1,-19} | {2,-7} | {3,5} | {4,7} | {5,7} | {6,8} | {7,8} | {8,8} | {9,8}' -f (Format-Time ([long]$row.at)), (Short-Text (ModelName $live $row.model) 19),
            (EffortText $effort), (Format-DurationShort ([double]$row.durationMs)),
            (Format-TokensShort (TotalTokens $row.usage)), (Format-TokensShort ([double]$row.usage.outputTokens)),
            (Money $row.costBrl), (Money $row.costUsd), (Money $row.savingsBrl), (Money $row.savingsUsd)))
    }
    $elm['txtRecent'].Text = ($lines -join "`n")
    $active = if ($live.sessions -and $live.sessions.Count -gt 0) { $live.sessions[0] } else { $null }
    $elm['txtRecentTitle'].Text = T 'recentTitleActive' @((Short-Text $activeTitle 40), $(if ($active) { $active.requests } else { 0 }),
        (Format-Duration $(if ($active) { [double]$active.durationMs } else { 0 })))

    # ---------------------------------------------------------------- sessões
    $sessionLines = New-Object System.Collections.Generic.List[string]
    $sessionLines.Add(('{0,-8} | {1,-30} | {2,4} | {3,7} | {4,5} | {5,-7} | {6,8} | {7,8} | {8,8} | {9,8}' -f (T 'colStart'), (T 'colSession'), (T 'colReqs'), (T 'colTokens'), (T 'colTime'), (T 'colEffort'), (T 'colBrl'), (T 'colUsd'), (T 'colEconBrl'), (T 'colEconUsd')))
    $sessionLines.Add('-' * 122)
    $sessionRows = @($live.sessions | Select-Object -First 20)
    foreach ($session in $sessionRows) {
        $startedAt = if ($null -ne $session.firstAt) { [long]$session.firstAt } else { [long]$session.lastAt }
        $name = Short-Text ([string]$session.title) 30
        if ($name.Length -eq 0) { $name = Short-Session ([string]$session.sessionId) }
        $sessionLines.Add(('{0,-8} | {1,-30} | {2,4} | {3,7} | {4,5} | {5,-7} | {6,8} | {7,8} | {8,8} | {9,8}' -f (Format-Time $startedAt), $name,
            $session.requests, (Format-TokensShort (TotalTokens $session.tokens)), (Format-DurationShort ([double]$session.durationMs)),
            (EffortText $session.reasoningEffort), (Money $session.costBrl), (Money $session.costUsd), (Money $session.savingsBrl), (Money $session.savingsUsd)))
    }
    if ($sessionRows.Count -eq 0) { $sessionLines.Add((T 'sessionsEmpty')) }
    $elm['txtSessions'].Text = ($sessionLines -join "`n")
    $elm['txtSessionsTitle'].Text = ('SESSÕES · {0} medida(s) · total {1}' -f @($live.sessions).Count,
        $(if ($null -eq $live.totals.costBrl) { Format-Usd ([double]$live.totals.costUsd) } else { Format-Brl ([double]$live.totals.costBrl) }))

    # ---------------------------------------------------------------- histórico
    $historyLines = New-Object System.Collections.Generic.List[string]
    $historyLines.Add(('{0,-10} | {1,5} | {2,8} | {3,6} | {4,8} | {5,8} | {6,8} | {7,8}' -f (T 'colDay'), (T 'colReqs'), (T 'colTokens'), (T 'colTime'), (T 'colBrl'), (T 'colUsd'), (T 'colEconBrl'), (T 'colEconUsd')))
    $historyLines.Add('-' * 90)
    $daily = @($live.daily)
    foreach ($day in $daily) {
        $historyLines.Add(('{0,-10} | {1,5} | {2,8} | {3,6} | {4,8} | {5,8} | {6,8} | {7,8}' -f [string]$day.date, $day.requests,
            (Format-TokensShort (TotalTokens $day.tokens)), (Format-DurationShort ([double]$day.durationMs)),
            (Money $day.costBrl), (Money $day.costUsd), (Money $day.savingsBrl), (Money $day.savingsUsd)))
    }
    if ($daily.Count -eq 0) { $historyLines.Add((T 'historyEmpty')) }
    $elm['txtHistory'].Text = ($historyLines -join "`n")
    $elm['txtHistoryTitle'].Text = T 'historyTitle' @($daily.Count)

    # ---------------------------------------------------------------- rodapé
    if ($live.fx -and $null -ne $live.fx.rate) {
        $stale = if ($live.fx.stale) { T 'fxStale' } else { '' }
        $elm['txtFx'].Text = T 'fxLine' @(('{0:0.0000}' -f [double]$live.fx.rate), $live.fx.source, $live.fx.date, $stale)
    } else {
        $elm['txtFx'].Text = T 'fxUnavailable'
    }
    $elm['txtUpdated'].Text = T 'updated' @(('{0:0.0}' -f ($ageMs / 1000)), $live.totals.requests,
        $(if ($null -eq $live.totals.costBrl) { Format-Usd ([double]$live.totals.costUsd) } else { Format-Brl ([double]$live.totals.costBrl) }))
}

# --- interação ---------------------------------------------------------------
$elm['header'].Add_MouseLeftButtonDown({ try { $window.DragMove() } catch { } })
$elm['btnTop'].Add_Click({ $window.Topmost = [bool]$elm['btnTop'].IsChecked })
$elm['btnRefresh'].Add_Click({ Update-View })
$elm['btnFolder'].Add_Click({
        if (-not (Test-Path -LiteralPath $script:dataDir)) { New-Item -ItemType Directory -Path $script:dataDir -Force | Out-Null }
        Start-Process explorer.exe -ArgumentList ('"' + $script:dataDir + '"')
    })
$elm['btnClose'].Add_Click({ $window.Close() })

$elm['tabs'].SelectedIndex = [math]::Max(0, [math]::Min(2, $Tab))

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds([math]::Max(200, $IntervalMs))
$timer.Add_Tick({ Update-View })
$timer.Start()
$window.Add_Closed({ $timer.Stop() })

Update-View
[void]$window.ShowDialog()
