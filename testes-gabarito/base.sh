#!/bin/sh
# Gabarito da base: os geradores (`gerar_base`, `gerar_indice_ppcs`) não mudam nada no git,
# `validar_base` passa e o `site/` gerado por `gerar_site` tem o mesmo hash.
#
# `exportar_base_publica` fica fora: lê as movimentações do Notion (exige NOTION_TOKEN), então a saída
# (institucional/ifpr/processos-sei/index.json) muda com o Notion. Confira-o à mão pelo `git diff`.
#
#   sh testes-gabarito/base.sh --comparar     # confere com testes-gabarito/base.txt
#   sh testes-gabarito/base.sh --capturar     # regrava o hash do site (só por decisão explícita)
#
# Neutro de runtime: os scripts rodam com $RODAR (padrão: `node`). O gabarito do C0 foi capturado com
# `RODAR=bun`. Exige árvore limpa em base-conhecimento/ antes de rodar.
set -u

RAIZ=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$RAIZ" || exit 2
RODAR=${RODAR:-node}
GABARITO=testes-gabarito/base.txt

modo=${1:-}
case "$modo" in
  --capturar | --comparar) ;;
  *)
    echo "uso: sh testes-gabarito/base.sh --capturar | --comparar" >&2
    exit 2
    ;;
esac

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
if ! $RODAR scripts/gerar_site.ts > /dev/null; then
  echo "FALHOU: scripts/gerar_site.ts" >&2
  falhas=$((falhas + 1))
fi
hash=$(cd site && find . -type f | LC_ALL=C sort | while read -r f; do printf '%s  %s\n' "$(shasum -a 256 < "$f" | cut -d' ' -f1)" "$f"; done | shasum -a 256 | cut -d' ' -f1)
arquivos=$(find site -type f | wc -l | tr -d ' ')
atual=$(printf 'site\t%s\t%s\n' "$arquivos" "$hash")

if [ "$modo" = "--capturar" ]; then
  [ "$falhas" -eq 0 ] || exit 1
  echo "$atual" > "$GABARITO"
  echo "gabarito da base gravado em $GABARITO"
  exit 0
fi
if [ "$atual" != "$(cat "$GABARITO")" ]; then
  echo "site/ diferente: gabarito $(cat "$GABARITO"); atual $atual" >&2
  falhas=$((falhas + 1))
fi
if [ "$falhas" -gt 0 ]; then
  echo "gabarito da base: $falhas falha(s)" >&2
  exit 1
fi
echo "gabarito da base: igual"
