# claude-switch: funcao "csw" para PowerShell (Windows PowerShell 5.1 e PowerShell 7+ em qualquer SO).
# Os comandos que mudam a conta do terminal imprimem codigo PowerShell no stdout,
# que e avaliado aqui (o processo node nao consegue alterar o ambiente do shell pai).
$global:CswCore = Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'bin') 'claude-switch.js'

function csw {
    if ($args.Count -gt 0 -and @('add', 'create', 'use', 'shell', 'rename', 'mv', 'remove', 'rm') -contains $args[0]) {
        $out = & node $global:CswCore @args --emit pwsh
        $code = $LASTEXITCODE
        if ($code -eq 0 -and $out) { ($out -join "`n") | Invoke-Expression }
        $global:LASTEXITCODE = $code
    } else {
        & node $global:CswCore @args
    }
}

# Linux/macOS: aplica a conta global (gravada por "csw use") ao abrir o shell.
# No Windows a conta global e uma variavel de ambiente do usuario.
$cswStore = if ($env:CLAUDE_SWITCH_HOME) { $env:CLAUDE_SWITCH_HOME } else { Join-Path $HOME '.claude-switch' }
$cswGlobal = Join-Path $cswStore 'global'
if (-not $env:CLAUDE_CONFIG_DIR -and (Test-Path $cswGlobal)) {
    $value = (Get-Content $cswGlobal -TotalCount 1)
    if ($value) { $env:CLAUDE_CONFIG_DIR = $value.Trim() }
}
Remove-Variable cswStore, cswGlobal, value -ErrorAction SilentlyContinue
