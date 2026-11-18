#!/bin/sh
# Gabarito da base: os geradores (`gerar_base`, `gerar_indice_ppcs`) não mudam nada no git e
# `validar_base` passa. Não há arquivo de gabarito: o esperado é o próprio git.
#
# `exportar_base_publica` fica fora: lê as movimentações do Notion (exige NOTION_TOKEN), então a saída
# (institucional/ifpr/processos-sei/index.json) muda com o Notion. Confira-o à mão pelo `git diff`.
#
#   sh testes-gabarito/base.sh --comparar
#
# Neutro de runtime: os scripts rodam com $RODAR (padrão: `node`). Exige árvore limpa em
# base-conhecimento/ antes de rodar.
set -u

RAIZ=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$RAIZ" || exit 2
RODAR=${RODAR:-node}

if [ "${1:-}" != "--comparar" ]; then
  echo "uso: sh testes-gabarito/base.sh --comparar" >&2
  exit 2
fi

if [ -n "$(git status --porcelain -- base-conhecimento)" ]; then
  echo "base-conhecimento/ com mudanças antes de rodar; confira o git status" >&2
  exit 2
fi

falhas=0
for script in gerar_base gerar_indice_ppcs; do
  if ! $RODAR "scripts/$script.ts" > /dev/null; then
    echo "FALHOU: scripts/$script.ts" >&2
    falhas=$((falhas + 1))
  fi
done
mudancas=$(git status --porcelain -- base-conhecimento)
if [ -n "$mudancas" ]; then
  echo "os geradores mudaram arquivos versionados:" >&2
  echo "$mudancas" >&2
  falhas=$((falhas + 1))
fi
if ! $RODAR scripts/validar_base.ts > /dev/null; then
  echo "FALHOU: scripts/validar_base.ts" >&2
  falhas=$((falhas + 1))
fi
if [ "$falhas" -gt 0 ]; then
  echo "gabarito da base: $falhas falha(s)" >&2
  exit 1
fi
echo "gabarito da base: igual"
