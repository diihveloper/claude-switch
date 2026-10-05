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

### Atualizar e desinstalar

```bash
git -C ~/.claude-switch-app pull      # atualizar
csw uninstall                         # remove os blocos dos profiles
rm -rf ~/.claude-switch-app           # remove o app (suas contas em ~/.claude-accounts continuam)
```

## Uso

```text
csw add trabalho              # cria ~/.claude-accounts/trabalho e já troca para ela NESTE terminal
claude                        # → /login com a conta de trabalho
csw use trabalho              # GLOBAL: novos terminais + este terminal

csw use pessoal --session     # só neste terminal (atalho: csw shell pessoal)
csw run trabalho claude       # executa um comando com outra conta, sem trocar

csw list                      # * = conta deste terminal, (global) = conta padrão
csw current
csw rename trabalho empresa
csw remove empresa            # pede confirmação; -y pula; --keep-files mantém a pasta
csw path empresa
csw usage                     # limites da conta atual (como o /usage)
csw usage --all               # limites de todas as contas
```

```text
$ csw usage
default voce@exemplo.com · max
  Sessão (5h)  ██░░░░░░░░░░░░░░░░░░   10%  reseta em 1h21 (seg., 05/10, 19:29)
  Semanal      ██████████████░░░░░░   68%  reseta em 8h51 (ter., 06/10, 02:59)
```

### Histórico e sessões compartilhados

Por padrão, todas as contas compartilham o **histórico de prompts** (seta para cima) e as **sessões** (`/resume`, `--continue`, `/rewind`). Assim você pode trocar de conta e continuar a mesma conversa. **Login, configurações, MCPs e plugins continuam separados** por conta.

```text
csw share <conta|--all>              # passa a compartilhar (contas criadas antes desta versão)
csw unshare <conta> [--copy]         # volta a ter histórico próprio (--copy leva uma cópia do atual)
csw add <conta> --isolated           # cria uma conta que já nasce isolada
```

O `share` move as sessões e o histórico que a conta já tinha para o lugar compartilhado:

- O que já existe nos dois lados não é sobrescrito: se houver conflito, a versão da conta ganha o nome da conta como sufixo (por exemplo, `MEMORY.trabalho.md`).
- Feche o Claude nessa conta antes de rodar o comando.

A coluna `HISTÓRICO` do `csw list` mostra o estado de cada conta.

### Ícone na bandeja do sistema

```text
csw tray                      # inicia o ícone em segundo plano
csw tray stop                 # encerra
csw tray status               # está rodando? inicia com o sistema?
csw tray autostart on|off     # iniciar junto com o Windows/sessão gráfica
csw tray --interval 10        # consulta o uso a cada 10 min (padrão: 5)
```

O ícone mostra o **% da janela de 5h** da conta global e muda de cor pelo maior uso entre as janelas:

- **Verde:** abaixo de 70%.
- **Amarelo:** de 70% a 89%.
- **Vermelho:** a partir de 90%.
- **Cinza:** sem dados (por exemplo, sem login ou token expirado).

Ao passar o mouse, aparecem a conta e o uso. O menu (clique esquerdo ou direito) permite:

- ver o uso de cada conta;
- **trocar a conta global** com um clique;
- **abrir o Claude** com qualquer conta num terminal novo;
- forçar a atualização do uso;
- ligar ou desligar a inicialização junto com o sistema.

Quando uma janela de uso passa de 90%, aparece uma notificação.

| Sistema | Requisito |
|---|---|
| **Windows** | Nenhum: usa o Windows PowerShell e o .NET que já vêm no sistema (`shell/tray.ps1`). |
| **Linux** | [`yad`](https://github.com/v1cont/yad) (`sudo apt install yad`, `sudo dnf install yad`…). No GNOME, também é preciso a extensão *AppIndicator and KStatusNotifierItem Support*. |
| **macOS** | Não suportado. |

O ícone relê a conta global a cada 15 s, então reflete trocas feitas pelo terminal. A API de uso só é consultada a cada `--interval` minutos, e o resultado fica em cache em `~/.claude-switch/usage-cache.json`. Erros vão para `~/.claude-switch/tray.log`.

A conta **`default`** é o `~/.claude` original. Ao selecioná-la, a variável `CLAUDE_CONFIG_DIR` é **removida**, em vez de apontar para `~/.claude`. Assim o Claude continua usando o `~/.claude.json` da home, como antes.

## Como funciona

- **Registro:** fica em `~/.claude-switch/accounts.json`. As pastas criadas pelo `csw add` ficam em `~/.claude-accounts/<nome>`. Com `--dir` é possível usar uma pasta existente; nesse caso, `remove` só apaga a pasta se você passar `--purge`.
- **Troca de sessão:** um processo não consegue alterar o ambiente do shell que o chamou. Por isso, `csw` é uma função de shell: o core em Node imprime `$env:CLAUDE_CONFIG_DIR = '...'` ou `export ...`, e a função avalia essa saída no terminal atual. É o mesmo truque do `nvm`.
- **Troca global:**
  - **Windows:** grava `CLAUDE_CONFIG_DIR` como variável de ambiente do usuário (`HKCU\Environment`). Terminais **já abertos** continuam com a conta antiga até você rodar `csw use` neles ou reabri-los. Apps como o VS Code só recebem a variável nova ao serem reiniciados.
  - **Linux/macOS:** grava o caminho em `~/.claude-switch/global`. A função `csw` exporta esse valor ao abrir um shell novo, a menos que o shell já tenha herdado uma conta.
- **Compartilhamento:** dentro da pasta de cada conta, estes itens viram links para os mesmos itens em `~/.claude`: `projects/`, `file-history/`, `paste-cache/`, `plans/`, `todos/`, `session-env/` e `history.jsonl`.
  - As pastas viram **junctions** no Windows, que não exigem admin nem Modo de Desenvolvedor, e **symlinks** no Linux e no macOS.
  - O `history.jsonl` vira um **hardlink**, porque o Claude Code não aceita esse arquivo como symlink.
  - A limpeza automática de entradas antigas do Claude (padrão de 30 dias) recria o arquivo e desfaz o hardlink. Nesse caso, a conta aparece como `parcial` no `csw list`, e o próximo `csw use` ou `csw share` refaz o link juntando as entradas.
  - `csw remove` desfaz os links antes de apagar a pasta da conta, então o histórico compartilhado nunca é apagado.
- **`usage`:** lê o token OAuth em `<pasta-da-conta>/.credentials.json` e consulta `https://api.anthropic.com/api/oauth/usage`, o mesmo endpoint usado pelo `/usage`. É só leitura e não renova tokens. Se o token tiver expirado, abra o Claude nessa conta (`csw run <conta> claude`) para ele se renovar.
  - **Esse endpoint não é documentado e pode mudar.**
  - No **macOS**, o Claude Code guarda as credenciais no Keychain, não em arquivo. Por isso o `usage` não consegue lê-las lá.

## Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `CLAUDE_SWITCH_HOME` | `~/.claude-switch` | pasta do registro de contas |
| `CLAUDE_SWITCH_ACCOUNTS_DIR` | `~/.claude-accounts` | onde `csw add` cria as contas novas |
| `NO_COLOR` | — | desativa as cores |

## Licença

MIT
