# claude-switch: ícone na bandeja do Windows (Windows Forms, sem dependências).
# Iniciado por "csw tray". Mostra a conta global e o uso; o menu troca de conta e abre o Claude.
param(
    [Parameter(Mandatory = $true)] [string]$Core,
    [string]$Node = 'node',
    [int]$Interval = 5,
    [int]$Threshold = 90
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace CswNative -Name User32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool DestroyIcon(System.IntPtr handle);'

# Uma instância por usuário; "csw tray stop" sinaliza o evento para sair limpando o ícone.
$mutex = New-Object System.Threading.Mutex($false, 'Local\claude-switch-tray')
if (-not $mutex.WaitOne(0)) { exit 0 }
$stopEvent = New-Object System.Threading.EventWaitHandle($false, [System.Threading.EventResetMode]::AutoReset, 'Local\claude-switch-tray-stop')

$storeDir = if ($env:CLAUDE_SWITCH_HOME) { $env:CLAUDE_SWITCH_HOME } else { Join-Path $HOME '.claude-switch' }
New-Item -ItemType Directory -Force $storeDir | Out-Null
$pidFile = Join-Path $storeDir 'tray.pid'
$logFile = Join-Path $storeDir 'tray.log'
Set-Content -Path $pidFile -Value $PID -Encoding ascii

function Write-Log([string]$msg) {
    try { Add-Content -Path $logFile -Value ("{0:s} {1}" -f (Get-Date), $msg) -Encoding utf8 } catch {}
}

# ------------------------------------------------------------------ chamadas ao core (node)

function Start-Core([string[]]$CoreArgs) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Node
    $psi.Arguments = ((@($Core) + $CoreArgs) | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ' '
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $psi.EnvironmentVariables['NO_COLOR'] = '1'
    $p = [System.Diagnostics.Process]::Start($psi)
    [pscustomobject]@{ Process = $p; Out = $p.StandardOutput.ReadToEndAsync(); Err = $p.StandardError.ReadToEndAsync() }
}

function Invoke-CoreSync([string[]]$CoreArgs) {
    $job = Start-Core $CoreArgs
    $job.Process.WaitForExit()
    if ($job.Process.ExitCode -ne 0) { throw ($job.Err.Result.Trim() -replace '^\S+\s*', '') }
    $job.Out.Result
}

# ------------------------------------------------------------------ ícone

$colors = @{
    green  = [System.Drawing.Color]::FromArgb(46, 158, 91)
    yellow = [System.Drawing.Color]::FromArgb(217, 164, 0)
    red    = [System.Drawing.Color]::FromArgb(214, 69, 69)
    gray   = [System.Drawing.Color]::FromArgb(128, 128, 128)
}

function New-StatusIcon([string]$Text, [System.Drawing.Color]$Color) {
    $size = 32
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = 10
    $path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($size - $r - 1, 0, $r, $r, 270, 90)
    $path.AddArc($size - $r - 1, $size - $r - 1, $r, $r, 0, 90); $path.AddArc(0, $size - $r - 1, $r, $r, 90, 90)
    $path.CloseFigure()
    $brush = New-Object System.Drawing.SolidBrush $Color
    $g.FillPath($brush, $path)
    $fontSize = if ($Text.Length -ge 3) { 14 } else { 19 }
    $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString($Text, $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, 1, $size, $size)), $fmt)
    $g.Dispose(); $font.Dispose(); $brush.Dispose(); $path.Dispose()
    $handle = $bmp.GetHicon()
    $icon = ([System.Drawing.Icon]::FromHandle($handle)).Clone()
    [CswNative.User32]::DestroyIcon($handle) | Out-Null
    $bmp.Dispose()
    $icon
}

function Get-Pct($acc, [string]$key) {
    $w = @($acc.usage.windows) | Where-Object { $_ -and $_.key -eq $key } | Select-Object -First 1
    if ($w) { [int][math]::Round($w.pct) } else { $null }
}

function Get-Level($acc) {
    $pcts = @(@($acc.usage.windows) | Where-Object { $_ } | ForEach-Object { $_.pct })
    if ($pcts.Count -eq 0) { return 'gray' }
    $max = ($pcts | Measure-Object -Maximum).Maximum
    if ($max -ge 90) { 'red' } elseif ($max -ge 70) { 'yellow' } else { 'green' }
}

function Get-Summary($acc) {
    if ($acc.usage.status) { return ($acc.usage.status -replace '\s*\(.*\)$', '') }
    $parts = @()
    $five = Get-Pct $acc 'five_hour'; $week = Get-Pct $acc 'seven_day'
    if ($null -ne $five) { $parts += "5h $five%" }
    if ($null -ne $week) { $parts += "semana $week%" }
    if ($parts.Count) { $parts -join ' · ' } else { 'sem dados' }
}

function Format-Reset($acc, [string]$key) {
    $w = @($acc.usage.windows) | Where-Object { $_ -and $_.key -eq $key } | Select-Object -First 1
    if (-not $w -or -not $w.resetsAt) { return '' }
    ' (reset ' + ([datetime]$w.resetsAt).ToLocalTime().ToString('ddd HH:mm') + ')'
}

# ------------------------------------------------------------------ UI

[System.Windows.Forms.Application]::EnableVisualStyles()
$notify = New-Object System.Windows.Forms.NotifyIcon
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$notify.ContextMenuStrip = $menu
$notify.Text = 'claude-switch'
$notify.Icon = New-StatusIcon '…' $colors.gray
$notify.Visible = $true

$script:state = $null
$script:job = $null
$script:lastRun = [datetime]::MinValue
$script:forceFull = $true
$script:alerted = @{}
$script:menuDirty = $false
$script:balloonTarget = $null
$script:actionJob = $null

# Clicar na notificação de limite troca para a conta sugerida.
$notify.add_BalloonTipClicked({
        if ($script:balloonTarget) { $t = $script:balloonTarget; $script:balloonTarget = $null; Switch-Account $t }
    })
$notify.add_BalloonTipClosed({ $script:balloonTarget = $null })

# Clique esquerdo também abre o menu.
$notify.add_MouseUp({
        param($s, $e)
        if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
            $m = [System.Windows.Forms.NotifyIcon].GetMethod('ShowContextMenu', [System.Reflection.BindingFlags]'Instance,NonPublic')
            $m.Invoke($notify, $null)
        }
    })

function Show-Error([string]$msg) {
    Write-Log "erro: $msg"
    $script:balloonTarget = $null
$script:actionJob = $null
    $notify.ShowBalloonTip(5000, 'claude-switch', $msg, [System.Windows.Forms.ToolTipIcon]::Error)
}

function Switch-Account([string]$name) {
    try {
        Invoke-CoreSync @('use', $name) | Out-Null
        $script:balloonTarget = $null
$script:actionJob = $null
        $notify.ShowBalloonTip(3000, 'claude-switch', "Conta global: $name (vale para novos terminais)", [System.Windows.Forms.ToolTipIcon]::Info)
    } catch { Show-Error $_.Exception.Message }
    $script:lastRun = [datetime]::MinValue
}

# Renova os tokens expirados em segundo plano; o resultado aparece numa notificação.
function Start-TokenRefresh {
    if ($script:actionJob) { return }
    $script:actionJob = Start-Core @('refresh')
    $script:menuDirty = $true
}

function Complete-TokenRefresh {
    $j = $script:actionJob
    $script:actionJob = $null
    $text = ($j.Out.Result + $j.Err.Result).Trim() -replace '\s*\r?\n\s*', "`n"
    if (-not $text) { $text = 'Concluído.' }
    if ($text.Length -gt 250) { $text = $text.Substring(0, 247) + '…' }
    $script:balloonTarget = $null
    $icon = if ($j.Process.ExitCode -eq 0) { [System.Windows.Forms.ToolTipIcon]::Info } else { [System.Windows.Forms.ToolTipIcon]::Warning }
    $notify.ShowBalloonTip(8000, 'claude-switch · tokens', $text, $icon)
    $script:forceFull = $true
    $script:lastRun = [datetime]::MinValue
    $script:menuDirty = $true
}

function Open-Claude($acc) {
    $old = $env:CLAUDE_CONFIG_DIR
    try {
        if ($acc.envValue) { $env:CLAUDE_CONFIG_DIR = $acc.envValue } else { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
        $shell = if (Get-Command pwsh.exe -ErrorAction SilentlyContinue) { 'pwsh.exe' } else { 'powershell.exe' }
        Start-Process $shell -ArgumentList '-NoExit', '-Command', 'claude'
    } catch { Show-Error $_.Exception.Message }
    finally {
        if ($old) { $env:CLAUDE_CONFIG_DIR = $old } else { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
    }
}

function Exit-Tray {
    $timer.Stop()
    $notify.Visible = $false
    $notify.Dispose()
    try { if ((Get-Content $pidFile -ErrorAction SilentlyContinue) -eq "$PID") { Remove-Item $pidFile -Force } } catch {}
    $mutex.ReleaseMutex()
    [System.Windows.Forms.Application]::Exit()
}

function Add-Item($parent, [string]$text, [scriptblock]$onClick, $tag = $null) {
    $item = New-Object System.Windows.Forms.ToolStripMenuItem $text
    $item.Tag = $tag
    if ($onClick) { $item.add_Click($onClick) }
    [void]$parent.Items.Add($item)
    $item
}

function Build-Menu {
    $menu.Items.Clear()
    $st = $script:state
    if (-not $st) {
        (Add-Item $menu 'Carregando…' $null).Enabled = $false
    } else {
        $title = Add-Item $menu ('Conta global: ' + $(if ($st.global) { $st.global } else { '(pasta não registrada)' })) $null
        $title.Enabled = $false
        $best = if ($st.best -and $st.best -ne $st.global) { @($st.accounts | Where-Object { $_.name -eq $st.best }) | Select-Object -First 1 }
        if ($best) {
            $bi = Add-Item $menu ("Trocar para a de mais limite: {0}" -f $best.name) { Switch-Account $this.Tag.name } $best
            $bi.ShortcutKeyDisplayString = Get-Summary $best
            $bi.Font = New-Object System.Drawing.Font($bi.Font, [System.Drawing.FontStyle]::Bold)
        }
        [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
        foreach ($acc in $st.accounts) {
            $item = Add-Item $menu $acc.name { Switch-Account $this.Tag.name } $acc
            $item.ShortcutKeyDisplayString = Get-Summary $acc
            $item.Checked = [bool]$acc.isGlobal
            $item.ToolTipText = (@($acc.email, $acc.plan, "histórico: $($acc.history)", "config: $($acc.config)") | Where-Object { $_ }) -join ' · '
        }
        [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
        $open = New-Object System.Windows.Forms.ToolStripMenuItem 'Abrir Claude com'
        foreach ($acc in $st.accounts) { [void](Add-Item $open.DropDown $acc.name { Open-Claude $this.Tag } $acc) }
        [void]$menu.Items.Add($open)
    }
    $expired = @($st.accounts | Where-Object { $_.tokenExpired }).Count
    $refreshText = if ($script:actionJob) { 'Renovando tokens…' } elseif ($expired) { "Renovar tokens expirados ($expired)" } else { 'Renovar tokens expirados (nenhum)' }
    $ri = Add-Item $menu $refreshText { Start-TokenRefresh }
    $ri.Enabled = [bool]$expired -and -not $script:actionJob
    [void](Add-Item $menu 'Atualizar uso agora' { $script:forceFull = $true; $script:lastRun = [datetime]::MinValue })
    $auto = Add-Item $menu 'Iniciar com o Windows' {
        try { Invoke-CoreSync @('tray', 'autostart', $(if ($this.Checked) { 'off' } else { 'on' }), '--interval', "$Interval", '--threshold', "$Threshold") | Out-Null }
        catch { Show-Error $_.Exception.Message }
        $script:menuDirty = $true
    }
    $startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'claude-switch tray.lnk'
    $auto.Checked = Test-Path $startup
    [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
    [void](Add-Item $menu 'Sair' { Exit-Tray })
}

function Update-Tray {
    $st = $script:state
    $g = @($st.accounts | Where-Object { $_.isGlobal }) | Select-Object -First 1
    if (-not $g) {
        $old = $notify.Icon; $notify.Icon = New-StatusIcon '?' $colors.gray; if ($old) { $old.Dispose() }
        $notify.Text = 'claude-switch: conta global em pasta não registrada'
    } else {
        $five = Get-Pct $g 'five_hour'
        $text = if ($null -ne $five) { "$five" } elseif ($g.usage.status) { '!' } else { '?' }
        $old = $notify.Icon
        $notify.Icon = New-StatusIcon $text $colors[(Get-Level $g)]
        if ($old) { $old.Dispose() }
        $tip = "Claude · $($g.name)`n" + (Get-Summary $g) + (Format-Reset $g 'five_hour')
        $notify.Text = if ($tip.Length -gt 63) { $tip.Substring(0, 63) } else { $tip }

        # Aviso único por janela de uso ao cruzar o limite, sugerindo a conta com mais limite.
        $best = if ($st.best -and $st.best -ne $g.name) { @($st.accounts | Where-Object { $_.name -eq $st.best }) | Select-Object -First 1 }
        foreach ($w in @($g.usage.windows | Where-Object { $_ })) {
            $key = "$($g.name)/$($w.key)/$($w.resetsAt)"
            if ($w.pct -ge $Threshold -and -not $script:alerted[$key]) {
                $script:alerted[$key] = $true
                $title = "Claude · $($g.name): {0} em {1}%" -f $w.label, [math]::Round($w.pct)
                if ($best) {
                    $script:balloonTarget = $best.name
                    $body = "Clique para trocar para $($best.name) ($(Get-Summary $best))"
                } else {
                    $script:balloonTarget = $null
$script:actionJob = $null
                    $body = 'Nenhuma outra conta com limite disponível' + (Format-Reset $g $w.key)
                }
                $notify.ShowBalloonTip(15000, $title, $body, [System.Windows.Forms.ToolTipIcon]::Warning)
            }
        }
    }
    if ($menu.Visible) { $script:menuDirty = $true } else { Build-Menu }
}

# Laço: a cada segundo verifica parada, coleta resultado pendente e agenda nova coleta.
# O estado local (conta global) é relido a cada 15s; a API de uso só quando o cache passa de $Interval min.
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.add_Tick({
        try {
            if ($stopEvent.WaitOne(0)) { Exit-Tray; return }
            if ($script:actionJob -and $script:actionJob.Process.HasExited) { Complete-TokenRefresh }
            if ($script:menuDirty -and -not $menu.Visible) { $script:menuDirty = $false; Build-Menu }
            if ($script:job) {
                if (-not $script:job.Process.HasExited) { return }
                $j = $script:job; $script:job = $null
                if ($j.Process.ExitCode -eq 0) {
                    $script:state = $j.Out.Result | ConvertFrom-Json
                    Update-Tray
                } else {
                    Write-Log ("status falhou: " + $j.Err.Result)
                }
                return
            }
            if (((Get-Date) - $script:lastRun).TotalSeconds -ge 15) {
                $maxAge = if ($script:forceFull) { 0 } else { $Interval * 60 }
                $script:forceFull = $false
                $script:lastRun = Get-Date
                $script:job = Start-Core @('status', '--json', '--max-age', "$maxAge")
            }
        } catch { Write-Log $_.Exception.ToString() }
    })

Build-Menu
$timer.Start()
Write-Log "iniciado (pid $PID)"
[System.Windows.Forms.Application]::Run()
