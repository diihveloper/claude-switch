# claude-switch: funcao "csw" para bash, zsh e Git Bash.
# Os comandos que mudam a conta do terminal imprimem codigo shell no stdout,
# que e avaliado aqui (o processo node nao consegue alterar o ambiente do shell pai).
if [ -n "$ZSH_VERSION" ]; then
  eval '_csw_src="${(%):-%x}"'
else
  _csw_src="${BASH_SOURCE[0]}"
fi
_CSW_CORE="$(cd "$(dirname "$_csw_src")/.." && pwd)/bin/claude-switch.js"
unset _csw_src

csw() {
  case "$1" in
    use|shell|rename|mv|remove|rm)
      local out rc
      out="$(node "$_CSW_CORE" "$@" --emit bash)"
      rc=$?
      [ $rc -eq 0 ] && [ -n "$out" ] && eval "$out"
      return $rc
      ;;
    *)
      node "$_CSW_CORE" "$@"
      ;;
  esac
}

# Linux/macOS: aplica a conta global (gravada por "csw use") ao abrir o shell,
# a menos que o terminal ja tenha herdado uma conta. No Windows a conta global
# e uma variavel de ambiente do usuario e esse arquivo nao existe.
_csw_global="${CLAUDE_SWITCH_HOME:-$HOME/.claude-switch}/global"
if [ -z "$CLAUDE_CONFIG_DIR" ] && [ -s "$_csw_global" ]; then
  CLAUDE_CONFIG_DIR="$(head -n 1 "$_csw_global")"
  export CLAUDE_CONFIG_DIR
fi
unset _csw_global
