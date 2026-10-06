# claude-switch: funcao "csw" para PowerShell (Windows PowerShell 5.1 e PowerShell 7+ em qualquer SO).
# Os comandos que mudam a conta do terminal imprimem codigo PowerShell no stdout,
# que e avaliado aqui (o processo node nao consegue alterar o ambiente do shell pai).
$global:CswCore = Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'bin') 'claude-switch.js'
$global:CswStore = if ($env:CLAUDE_SWITCH_HOME) { $env:CLAUDE_SWITCH_HOME } else { Join-Path $HOME '.claude-switch' }
$env:CSW_WRAPPER_VERSION = '3'

# Captura a saida do node como UTF-8 (por padrao o console decodifica com a pagina OEM e
# caminhos com acento seriam corrompidos).
function global:__CswCapture([scriptblock]$Block) {
    $prev = [Console]::OutputEncoding
    try {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        & $Block
    } finally {
        [Console]::OutputEncoding = $prev
    }
}

function global:csw {
    if ($args.Count -gt 0 -and @('add', 'create', 'use', 'shell', 'next', 'rename', 'mv', 'remove', 'rm', 'auto', 'prompt') -contains $args[0]) {
        $cswArgs = $args
        $out = __CswCapture { & node $global:CswCore @cswArgs --emit pwsh }
        $code = $LASTEXITCODE
        if ($code -eq 0 -and $out) { ($out -join "`n") | Invoke-Expression }
        $global:LASTEXITCODE = $code
    } else {
        & node $global:CswCore @args
    }
}

# Linux/macOS: aplica a conta global (gravada por "csw use") ao abrir o shell.
# No Windows a conta global e uma variavel de ambiente do usuario.
$cswGlobal = Join-Path $global:CswStore 'global'
if (-not $env:CLAUDE_CONFIG_DIR -and (Test-Path $cswGlobal)) {
    $value = (Get-Content $cswGlobal -TotalCount 1)
    if ($value) { $env:CLAUDE_CONFIG_DIR = $value.Trim() }
}
Remove-Variable cswGlobal, value -ErrorAction SilentlyContinue

# ---------------------------------------------------------------- conta por projeto (.claude-account)
# Ao mudar de pasta, procura .claude-account subindo os diretorios. So chama o node quando a conta
# do projeto muda; ao sair do projeto, restaura a conta que o terminal tinha antes.
function global:__CswAutoCheck {
    $loc = Get-Location
    if ($loc.Provider.Name -ne 'FileSystem') { return }
    $here = $loc.ProviderPath
    if ($here -eq $global:__CswAutoPwd) { return }
    $global:__CswAutoPwd = $here
    $name = ''
    $dir = $here
    while ($dir) {
        $file = Join-Path $dir '.claude-account'
        if (Test-Path -LiteralPath $file -PathType Leaf) {
            $name = ((Get-Content -LiteralPath $file -TotalCount 1) -as [string]).Trim()
            break
        }
        $parent = Split-Path -Parent $dir
        if (-not $parent -or $parent -eq $dir) { break }
        $dir = $parent
    }
    if ($name -eq $global:__CswAutoName) { return }
    if ($name) {
        if (-not $global:__CswAutoName) { $global:__CswAutoPrev = $env:CLAUDE_CONFIG_DIR; $global:__CswAutoHadPrev = [bool]$env:CLAUDE_CONFIG_DIR }
        $out = __CswCapture { & node $global:CswCore use $name --session --project --emit pwsh }
        if ($LASTEXITCODE -eq 0 -and $out) { ($out -join "`n") | Invoke-Expression; $global:__CswAutoName = $name }
    } elseif ($global:__CswAutoName) {
        if ($global:__CswAutoHadPrev) { $env:CLAUDE_CONFIG_DIR = $global:__CswAutoPrev } else { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
        $global:__CswAutoName = ''
        Write-Host 'csw: fora do projeto, conta anterior restaurada' -ForegroundColor DarkGray
    }
}

# ---------------------------------------------------------------- conta no prompt
# Le prompt.tsv (mantido pelo csw) sem chamar o node.
function global:__CswPromptSegment {
    $key = if ($env:CLAUDE_CONFIG_DIR) { ($env:CLAUDE_CONFIG_DIR -replace '\\', '/').TrimEnd('/').ToLowerInvariant() } else { '-' }
    $file = Join-Path $global:CswStore 'prompt.tsv'
    if (-not (Test-Path $file)) { return $null }
    foreach ($line in [IO.File]::ReadAllLines($file)) {
        $f = $line -split "`t"
        if ($f[0] -ne $key) { continue }
        $pct = ''
        $age = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - [long]$f[4]
        if ($f[2] -and $age -lt 3600) { $pct = " $($f[2])%" }
        $color = switch ($f[3]) { 'green' { 'Green' } 'yellow' { 'Yellow' } 'red' { 'Red' } default { 'DarkGray' } }
        return @{ Text = "[claude:$($f[1])$pct] "; Color = $color }
    }
    @{ Text = '[claude:?] '; Color = 'DarkGray' }
}

# Envolve a funcao prompt atual uma unica vez; os ganchos so agem quando ligados.
function global:__CswInstallHook {
    if ($global:__CswPromptWrapped) { return }
    $global:__CswPromptWrapped = $true
    $global:__CswOrigPrompt = $function:prompt
    function global:prompt {
        $code = $global:LASTEXITCODE
        if ($global:__CswAutoOn) { try { __CswAutoCheck } catch {} }
        if ($global:__CswPromptOn) {
            $seg = __CswPromptSegment
            if ($seg) { Write-Host $seg.Text -NoNewline -ForegroundColor $seg.Color }
        }
        $global:LASTEXITCODE = $code
        & $global:__CswOrigPrompt
    }
}

function global:__CswAutoEnable { $global:__CswAutoOn = $true; $global:__CswAutoPwd = $null; __CswInstallHook }
function global:__CswAutoDisable { $global:__CswAutoOn = $false }
function global:__CswPromptEnable { $global:__CswPromptOn = $true; __CswInstallHook }
function global:__CswPromptDisable { $global:__CswPromptOn = $false }

if (Test-Path (Join-Path $global:CswStore 'auto-cd')) { __CswAutoEnable }
if (Test-Path (Join-Path $global:CswStore 'prompt')) { __CswPromptEnable }
