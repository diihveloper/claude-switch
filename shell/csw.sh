# claude-switch: funcao "csw" para bash, zsh e Git Bash.
# Os comandos que mudam a conta do terminal imprimem codigo shell no stdout,
# que e avaliado aqui (o processo node nao consegue alterar o ambiente do shell pai).
if [ -n "$ZSH_VERSION" ]; then
  eval '_csw_src="${(%):-%x}"'
else
  _csw_src="${BASH_SOURCE[0]}"
fi
_CSW_CORE="$(cd "$(dirname "$_csw_src")/.." && pwd)/bin/claude-switch.js"
_CSW_STORE="${CLAUDE_SWITCH_HOME:-$HOME/.claude-switch}"
export CSW_WRAPPER_VERSION=3
unset _csw_src

csw() {
  case "$1" in
    add|create|use|shell|next|rename|mv|remove|rm|auto|prompt)
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
if [ -z "$CLAUDE_CONFIG_DIR" ] && [ -s "$_CSW_STORE/global" ]; then
  CLAUDE_CONFIG_DIR="$(head -n 1 "$_CSW_STORE/global")"
  export CLAUDE_CONFIG_DIR
fi

# ---------------------------------------------------------------- conta por projeto (.claude-account)
# Ao mudar de pasta, procura .claude-account subindo os diretorios. So chama o node quando a conta
# do projeto muda; ao sair do projeto, restaura a conta que o terminal tinha antes.
_csw_auto_check() {
  [ "$PWD" = "$_CSW_AUTO_PWD" ] && return
  _CSW_AUTO_PWD="$PWD"
  local d="$PWD" name="" out
  while [ -n "$d" ]; do
    if [ -f "$d/.claude-account" ]; then
      IFS= read -r name < "$d/.claude-account" || true
      name="${name%%[[:space:]]*}"
      break
    fi
    [ "$d" = "/" ] && break
    d="${d%/*}"
    [ -z "$d" ] && d="/"
  done
  [ "$name" = "$_CSW_AUTO_NAME" ] && return
  if [ -n "$name" ]; then
    [ -z "$_CSW_AUTO_NAME" ] && _CSW_AUTO_PREV="${CLAUDE_CONFIG_DIR-__csw_unset__}"
    if out="$(node "$_CSW_CORE" use "$name" --session --project --emit bash)"; then
      eval "$out"
      _CSW_AUTO_NAME="$name"
    fi
  elif [ -n "$_CSW_AUTO_NAME" ]; then
    if [ "$_CSW_AUTO_PREV" = "__csw_unset__" ]; then unset CLAUDE_CONFIG_DIR; else export CLAUDE_CONFIG_DIR="$_CSW_AUTO_PREV"; fi
    _CSW_AUTO_NAME=""
    echo "csw: fora do projeto, conta anterior restaurada" >&2
  fi
}

# ---------------------------------------------------------------- conta no prompt
# Le ~/.claude-switch/prompt.tsv (mantido pelo csw) sem chamar o node.
_csw_prompt_update() {
  local key="-" d name pct lvl ts color now
  if [ -n "$CLAUDE_CONFIG_DIR" ]; then
    key="${CLAUDE_CONFIG_DIR//\\//}"
    key="${key%/}"
    _csw_lower_key
  fi
  _CSW_SEG=""
  [ -r "$_CSW_STORE/prompt.tsv" ] || return
  while IFS=$'\t' read -r d name pct lvl ts; do
    [ "$d" = "$key" ] || continue
    now="${EPOCHSECONDS:-0}"
    # % so aparece se o dado tiver menos de 1h
    if [ -n "$pct" ] && { [ "$now" = 0 ] || [ $((now - ts)) -lt 3600 ]; }; then pct=" $pct%"; else pct=""; fi
    case "$lvl" in green) color=32 ;; yellow) color=33 ;; red) color=31 ;; *) color=90 ;; esac
    if [ -n "$ZSH_VERSION" ]; then
      _CSW_SEG="%{"$'\e'"[${color}m%}[claude:${name}${pct}]%{"$'\e'"[0m%} "
    else
      _CSW_SEG=$'\001\e['"${color}m"$'\002'"[claude:${name}${pct}]"$'\001\e[0m\002 '
    fi
    return
  done < "$_CSW_STORE/prompt.tsv"
  _CSW_SEG="[claude:?] "
}

# Converte $key (variavel do chamador) para minusculas sem fork, conforme o shell.
if [ -n "$ZSH_VERSION" ]; then
  eval '_csw_lower_key() { key="${(L)key}"; }'
  zmodload zsh/datetime 2>/dev/null # EPOCHSECONDS
elif [ "${BASH_VERSINFO[0]}" -ge 4 ]; then
  eval '_csw_lower_key() { key="${key,,}"; }'
else
  _csw_lower_key() { key="$(printf '%s' "$key" | tr '[:upper:]' '[:lower:]')"; }
fi

_csw_hook() {
  local rc=$?
  [ -n "$_CSW_AUTO_ON" ] && _csw_auto_check
  [ -n "$_CSW_PROMPT_ON" ] && _csw_prompt_update
  return $rc
}

_csw_install_hook() {
  if [ -n "$ZSH_VERSION" ]; then
    case " ${precmd_functions[*]} " in *" _csw_hook "*) ;; *) precmd_functions+=(_csw_hook) ;; esac
  else
    case ";$PROMPT_COMMAND;" in *";_csw_hook;"*) ;; *) PROMPT_COMMAND="_csw_hook${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;; esac
  fi
}

_csw_auto_enable() { _CSW_AUTO_ON=1; _CSW_AUTO_PWD=""; _csw_install_hook; }
_csw_auto_disable() { _CSW_AUTO_ON=""; }

_csw_prompt_enable() {
  _CSW_PROMPT_ON=1
  _csw_install_hook
  if [ -n "$ZSH_VERSION" ]; then
    setopt PROMPT_SUBST
    case "$PROMPT" in *'${_CSW_SEG}'*) ;; *) PROMPT='${_CSW_SEG}'"$PROMPT" ;; esac
  else
    case "$PS1" in *'${_CSW_SEG}'*) ;; *) PS1='${_CSW_SEG}'"$PS1" ;; esac
  fi
  _csw_prompt_update
}
_csw_prompt_disable() {
  _CSW_PROMPT_ON=""
  _CSW_SEG=""
}

[ -f "$_CSW_STORE/auto-cd" ] && _csw_auto_enable
[ -f "$_CSW_STORE/prompt" ] && _csw_prompt_enable
true
