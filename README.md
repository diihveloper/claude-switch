# claude-switch (`csw`)

Gerencia várias contas do [Claude Code](https://claude.com/claude-code) na mesma máquina trocando a variável `CLAUDE_CONFIG_DIR`, no estilo do `nvm`.

- Funciona no **Windows** (PowerShell 5.1/7+ e Git Bash), no **Linux** e no **macOS** (bash, zsh e PowerShell 7).
- Não tem dependências. Só precisa do **Node.js 18+**, que já vem com o Claude Code.

## Instalação

### 1. Baixe o projeto

Clone o repositório num local fixo, porque a função `csw` aponta para esta pasta:

```bash
git clone https://github.com/diihveloper/claude-switch.git ~/.claude-switch-app
```

No PowerShell:

```powershell
git clone https://github.com/diihveloper/claude-switch.git "$HOME\.claude-switch-app"
```

### 2. Instale a função `csw` nos seus shells

```bash
node ~/.claude-switch-app/bin/claude-switch.js install
```

No PowerShell:

```powershell
node "$HOME\.claude-switch-app\bin\claude-switch.js" install
```

O `install` adiciona um bloco marcado com `# >>> claude-switch >>>` em:

| Arquivo | Quando |
|---|---|
| `$PROFILE` do PowerShell 7 (`pwsh`) | se estiver instalado |
| `$PROFILE` do Windows PowerShell 5.1 | se estiver instalado (Windows) |
| `~/.bashrc` | sempre (bash e Git Bash) |
| `~/.zshrc` | se existir ou se o seu `$SHELL` for zsh |

### 3. Abra um novo terminal

```bash
csw help
```

> **PowerShell no Windows:** se aparecer o erro "execução de scripts foi desabilitada", libere os scripts locais com
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
>
> **macOS com bash:** o bash de login lê o `~/.bash_profile`. Se ele não carregar o `~/.bashrc`, adicione `source ~/.bashrc` a ele.

### Atualizar

```bash
csw update
```

Ou, no ícone da bandeja, clique em **Atualizar o claude-switch**. O `update` baixa a versão nova (`git pull` na pasta do app), mostra o que mudou e reinicia o ícone da bandeja, se ele estiver rodando. Se a função `csw` dos shells mudar, ele avisa para abrir um novo terminal.

> **Instalações anteriores ao `csw update`:** atualize uma vez à mão com `git -C ~/.claude-switch-app pull` (no PowerShell: `git -C "$HOME\.claude-switch-app" pull`) e reinicie o ícone com `csw tray stop` e `csw tray start`. Daqui em diante, basta o `csw update`.

### Desinstalar

```bash
csw uninstall                         # remove os blocos dos profiles
rm -rf ~/.claude-switch-app           # remove o app (suas contas em ~/.claude-accounts continuam)
```

## Uso

```text
csw add trabalho              # cria ~/.claude-accounts/trabalho e já troca para ela NESTE terminal
claude                        # → /login com a conta de trabalho
csw use trabalho              # GLOBAL: novos terminais + este terminal

csw use pessoal --session     # só neste terminal (atalho: csw shell pessoal)
csw next                      # troca para a conta com mais limite disponível
csw run trabalho claude       # executa um comando com outra conta, sem trocar

csw list                      # * = conta deste terminal, (global) = conta padrão
csw current                   # conta do terminal, global e do projeto
csw rename trabalho empresa
csw remove empresa            # pede confirmação; -y pula; --keep-files mantém a pasta
csw path empresa
csw usage                     # limites da conta atual (como o /usage)
csw usage --all               # limites de todas as contas
csw usage --history           # + gráficos do uso (com --all, também o limite livre somado)
csw doctor                    # diagnóstico; --fix corrige o que der
csw update                    # atualiza o claude-switch
```

```text
$ csw usage
default voce@exemplo.com · max
  Sessão (5h)  ██░░░░░░░░░░░░░░░░░░   10%  reseta em 1h21 (seg., 05/10, 19:29)
  Semanal      ██████████████░░░░░░   68%  reseta em 8h51 (ter., 06/10, 02:59)
                                           no ritmo atual acaba ~23:10 (3h49 antes do reset)
```

### Previsão e histórico de uso

Cada consulta de uso (ícone da bandeja, statusline, `csw usage`) grava uma amostra em `~/.claude-switch/usage-history.jsonl`, que guarda cerca de 35 dias. Com o ícone da bandeja ligado, isso acontece a cada 5 min. A API só informa o valor atual, então o histórico começa a partir da primeira consulta.

A partir do histórico, o `csw usage` prevê, no ritmo atual, se o limite acaba antes do reset:

- **Janela de 5h:** usa o ritmo dos últimos 60 min. Sem amostras suficientes, usa a média desde o início da janela.
- **Janela semanal:** usa a média desde o início da semana, para não oscilar entre dia e noite. Só aparece depois de 12 h de janela.

O `csw usage --history` desenha, no terminal, o uso da janela de 5h nas últimas 24 h e o da semanal nos últimos 7 dias. Com `--all`, mostra também o **limite livre somado** de todas as contas nas últimas 24 h (por exemplo, "1,4 de 3 contas livres").

```text
  Sessão (5h) · últimas 24h
  100% │▃▅           ▁▃▅                                       █
       │██       ▂▄▅▇███                                   ▁▃▄▅█
       │██   ▂▃▅████████                               ▂▃▄▆█████
    0% │██▂▅▇███████████▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▃▅▇█████████
        qui., 08, 13:15                                    agora
```

A conta **`default`** é o `~/.claude` original. Ao selecioná-la, a variável `CLAUDE_CONFIG_DIR` é **removida**, em vez de apontar para `~/.claude`. Assim o Claude continua usando o `~/.claude.json` da home, como antes.

### Trocar para a conta com mais limite

`csw next` (o mesmo que `csw use --auto`) consulta o uso de todas as contas e troca para a que tem mais limite livre. O limite livre de uma conta é `100% − o maior uso entre a janela de 5h e a semanal`. Contas sem login ou com token expirado ficam de fora. Assim como o `use`, a troca é global por padrão; com `--session`, vale só para o terminal atual.

```text
$ csw next
    default        9% livre   5h 91% · semana 50%
  → trabalho       80% livre  5h 10% · semana 20%
✔ Usando trabalho (global + este terminal)
```

### Conta por projeto (`.claude-account`)

Funciona como o `.nvmrc`: um arquivo `.claude-account` na raiz do repositório guarda o nome da conta daquele projeto. Você pode versioná-lo ou colocá-lo no `.gitignore`.

```text
csw pin trabalho              # grava .claude-account na pasta atual
csw pin --remove              # remove
csw use                       # sem argumento: aplica a conta do projeto (só neste terminal)
csw auto on                   # troca automática ao entrar na pasta (cd), em todos os shells
csw auto off
```

Com o `auto` ligado, o terminal troca para a conta do projeto ao entrar numa pasta que contém (ou está dentro de) um `.claude-account`, e **volta para a conta anterior ao sair**. A busca pelo arquivo é feita no próprio shell; o Node só é chamado quando a conta muda, então o `cd` continua rápido.

### Compartilhamento entre contas

As contas novas compartilham com a `default` o **histórico e as sessões** (`/resume`, `--continue`, `/rewind`, seta para cima) e as **configurações**: `settings.json`, `CLAUDE.md`, `skills/`, `agents/`, `commands/` e `output-styles/`. Assim, uma conta nova já começa com o seu CLAUDE.md global, as suas skills e as suas permissões. **Login, MCPs e plugins ficam sempre separados**, porque guardam dados específicos de cada conta.

```text
csw share <conta|--all>                 # histórico e sessões (contas criadas antes desta versão)
csw share <conta|--all> --config        # configurações
csw unshare <conta> [--history] [--config] [--copy]   # --copy: a conta leva uma cópia do atual
csw add <conta> --no-config             # nova conta compartilhando só o histórico
csw add <conta> --isolated              # nova conta sem compartilhar nada
```

O `share` leva para a `default` o que a conta já tinha, sem perder nada:

- **Pastas** (sessões, skills…): são mescladas. Se houver conflito, a versão da conta ganha o nome dela como sufixo (por exemplo, `MEMORY.trabalho.md`).
- **`history.jsonl`:** as entradas são juntadas.
- **`settings.json` e `CLAUDE.md`:** vale o arquivo modificado por último, e o outro vai para `~/.claude-switch/backups/`.

Feche o Claude nessa conta antes de rodar o comando. As colunas `HISTÓRICO` e `CONFIG` do `csw list` mostram o estado de cada conta.

### Conta visível no Claude Code e no terminal

Para não gastar o limite da conta errada:

```text
csw statusline install        # conta e uso na barra de status do Claude Code
csw prompt on                 # [claude:trabalho 13%] no prompt do PowerShell, bash e zsh
```

- **Statusline:** mostra `◆ trabalho · 5h 13% ↻19:29 · semana 69%`, com as cores do nível de uso. O `install` grava `statusLine` no `settings.json` de cada conta (uma vez só, se as configurações forem compartilhadas). Se já existir outra statusline, ela não é substituída sem `--force`. Para remover: `csw statusline uninstall`.
- **Prompt:** lê um arquivo de cache, sem chamar o Node a cada comando. O % aparece quando o dado tem menos de 1h.
- **Atualização do uso:** a statusline atualiza o cache de uso em segundo plano, no máximo uma vez por minuto, e o ícone da bandeja também mantém o cache em dia.

### Ícone na bandeja do sistema

```text
csw tray                      # inicia o ícone em segundo plano
csw tray stop                 # encerra
csw tray status               # está rodando? inicia com o sistema?
csw tray autostart on|off     # iniciar junto com o Windows/sessão gráfica
csw tray --interval 10        # consulta o uso a cada 10 min (padrão: 5)
csw tray --threshold 95       # % que dispara o alerta (padrão: 90)
```

O ícone mostra o **% da janela de 5h** da conta global e muda de cor pelo maior uso entre as janelas:

- **Verde:** abaixo de 70%.
- **Amarelo:** de 70% a 89%.
- **Vermelho:** a partir de 90%.
- **Cinza:** sem dados (por exemplo, sem login ou token expirado).

Ao passar o mouse, aparecem a conta e o uso. O menu (clique esquerdo ou direito) permite:

- **trocar para a conta com mais limite** (aparece quando há uma melhor que a global);
- ver o uso de cada conta e quanto falta para o reset de cada janela, por exemplo `5h 66% (1h20) · semana 18% (6d)`;
- ver a **previsão** da conta global, por exemplo `Previsão: 5h acaba ~16:40 · semana ok (~72% no reset)` (a de cada conta aparece ao passar o mouse sobre ela);
- **trocar a conta global** com um clique;
- **abrir o Claude** com qualquer conta num terminal novo;
- forçar a atualização do uso;
- ligar ou desligar a inicialização junto com o sistema;
- **atualizar o claude-switch** (o resultado aparece numa notificação).

Quando uma janela de uso da conta global passa do limite (`--threshold`), aparece uma notificação que sugere a conta com mais limite:

- **No Windows:** clique na notificação para trocar.
- **No Linux:** a notificação tem o botão "Trocar para X" (requer `notify-send` com suporte a ações).

| Sistema | Requisito |
|---|---|
| **Windows** | Nenhum: usa o Windows PowerShell e o .NET que já vêm no sistema (`shell/tray.ps1`). |
| **Linux** | [`yad`](https://github.com/v1cont/yad) (`sudo apt install yad`, `sudo dnf install yad`…). No GNOME, também é preciso a extensão *AppIndicator and KStatusNotifierItem Support*. Para notificações: `notify-send` (`libnotify-bin`). |
| **macOS** | Não suportado. |

O ícone relê a conta global a cada 15 s, então reflete trocas feitas pelo terminal. A API de uso só é consultada a cada `--interval` minutos, e o resultado fica em cache em `~/.claude-switch/usage-cache.json`. Erros vão para `~/.claude-switch/tray.log`.

### Diagnóstico

`csw doctor` verifica:

- a versão do Node;
- se a função `csw` deste terminal está carregada e atualizada;
- os blocos nos profiles dos shells;
- o login e a validade do token de cada conta;
- links de compartilhamento quebrados ou parciais;
- se a conta global ou a do terminal apontam para uma pasta não registrada;
- se o terminal está numa conta diferente da global ou da do `.claude-account`;
- o estado da bandeja e da statusline.

Com `--fix`, ele reinstala os blocos dos profiles e refaz os links.

## Como funciona

- **Registro:** fica em `~/.claude-switch/accounts.json`. As pastas criadas pelo `csw add` ficam em `~/.claude-accounts/<nome>`. Com `--dir` é possível usar uma pasta existente; nesse caso, `remove` só apaga a pasta se você passar `--purge`.
- **Troca de sessão:** um processo não consegue alterar o ambiente do shell que o chamou. Por isso, `csw` é uma função de shell: o core em Node imprime `$env:CLAUDE_CONFIG_DIR = '...'` ou `export ...`, e a função avalia essa saída no terminal atual. É o mesmo truque do `nvm`. A troca automática por projeto e o prompt usam ganchos do próprio shell: a função `prompt` no PowerShell, `PROMPT_COMMAND` no bash e `precmd` no zsh.
- **Troca global:**
  - **Windows:** grava `CLAUDE_CONFIG_DIR` como variável de ambiente do usuário (`HKCU\Environment`). Terminais **já abertos** continuam com a conta antiga até você rodar `csw use` neles ou reabri-los. Apps como o VS Code só recebem a variável nova ao serem reiniciados.
  - **Linux/macOS:** grava o caminho em `~/.claude-switch/global`. A função `csw` exporta esse valor ao abrir um shell novo, a menos que o shell já tenha herdado uma conta.
- **Compartilhamento:** dentro da pasta de cada conta, os itens compartilhados viram links para os mesmos itens em `~/.claude`.
  - As pastas viram **junctions** no Windows, que não exigem admin nem Modo de Desenvolvedor, e **symlinks** no Linux e no macOS.
  - Os arquivos (`history.jsonl`, `settings.json`, `CLAUDE.md`) viram **hardlinks**, porque o Claude Code não aceita o histórico como symlink.
  - Quando o Claude recria um desses arquivos (por exemplo, na limpeza de histórico antigo, padrão de 30 dias), o hardlink se desfaz. Nesse caso, a conta aparece como `parcial`, e o próximo `csw use` ou `csw doctor --fix` refaz o link sem perder dados.
  - `csw remove` desfaz os links antes de apagar a pasta da conta, então os dados compartilhados nunca são apagados.
- **`usage`:** lê o token OAuth em `<pasta-da-conta>/.credentials.json` e consulta `https://api.anthropic.com/api/oauth/usage`, o mesmo endpoint usado pelo `/usage`. É só leitura e não renova tokens. Se o token tiver expirado, abra o Claude nessa conta (`csw run <conta> claude`) para ele se renovar.
  - **Esse endpoint não é documentado e pode mudar.**
  - No **macOS**, o Claude Code guarda as credenciais no Keychain, não em arquivo. Por isso o `usage`, o `next`, a statusline e a bandeja não conseguem ler o uso lá.

## Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `CLAUDE_SWITCH_HOME` | `~/.claude-switch` | pasta do registro de contas |
| `CLAUDE_SWITCH_ACCOUNTS_DIR` | `~/.claude-accounts` | onde `csw add` cria as contas novas |
| `NO_COLOR` | — | desativa as cores |

## Licença

MIT
