#!/bin/sh
# Gabarito do banco: para cada tabela do `tmp/kb.sqlite`, o número de linhas e o sha256 do
# `.dump` da tabela (CREATE e INSERTs na ordem do rowid), sem as tabelas do FTS5 (que o SQLite de
# cada runtime pode gravar de outro jeito; o gabarito da CLI kb confere as buscas).
#
# Na `meta`, a impressão digital das fontes (`fontes_sha256`, `fontes_lista_sha256`, `fontes_total`)
# fica fora do hash: as fontes incluem o código de `packages/kb/src`, e ela muda com qualquer mudança
# de código, mesmo sem mudar nenhum dado.
#
#   sh testes-gabarito/banco.sh --comparar     # confere com testes-gabarito/banco.txt
#   sh testes-gabarito/banco.sh --capturar     # regrava o gabarito (só por decisão explícita)
#
# O hash do arquivo .sqlite inteiro não serve: o cabeçalho grava a versão do SQLite de quem
# escreveu. Usa o `sqlite3` do sistema, o mesmo nas duas pontas. Compile o banco antes
# (`pnpm kb:compilar`).
set -u

RAIZ=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$RAIZ" || exit 2
BANCO=${BANCO:-tmp/kb.sqlite}
GABARITO=testes-gabarito/banco.txt

modo=${1:-}
case "$modo" in
  --capturar | --comparar) ;;
  *)
    echo "uso: sh testes-gabarito/banco.sh --capturar | --comparar" >&2
    exit 2
    ;;
esac
[ -f "$BANCO" ] || { echo "falta $BANCO: rode pnpm kb:compilar" >&2; exit 2; }

gerar() {
  sqlite3 "$BANCO" "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE '%\_fts%' ESCAPE '\' AND name NOT LIKE 'sqlite\_%' ESCAPE '\' ORDER BY name" |
    while read -r tabela; do
      linhas=$(sqlite3 "$BANCO" "SELECT count(*) FROM \"$tabela\"")
      if [ "$tabela" = meta ]; then
        hash=$(sqlite3 "$BANCO" "SELECT chave, valor FROM meta WHERE chave NOT IN ('fontes_sha256', 'fontes_lista_sha256', 'fontes_total') ORDER BY chave" | shasum -a 256 | cut -d' ' -f1)
      else
        hash=$(sqlite3 "$BANCO" ".dump \"$tabela\"" | shasum -a 256 | cut -d' ' -f1)
      fi
      printf '%s\t%s\t%s\n' "$tabela" "$linhas" "$hash"
    done
  printf 'indices\t-\t%s\n' "$(sqlite3 "$BANCO" "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE type IN ('index', 'trigger', 'view') ORDER BY name" | shasum -a 256 | cut -d' ' -f1)"
  printf 'fts\t-\t%s\n' "$(sqlite3 "$BANCO" "SELECT name, sql FROM sqlite_schema WHERE name LIKE '%\_fts' ESCAPE '\' ORDER BY name" | shasum -a 256 | cut -d' ' -f1)"
}

if [ "$modo" = "--capturar" ]; then
  gerar > "$GABARITO"
  echo "gabarito do banco gravado em $GABARITO ($(wc -l < "$GABARITO" | tr -d ' ') linhas)"
  exit 0
fi
atual=$(mktemp)
trap 'rm -f "$atual"' EXIT
gerar > "$atual"
if diff "$GABARITO" "$atual" >&2; then
  echo "gabarito do banco: igual"
else
  echo "gabarito do banco: diferente (acima, < gabarito, > atual)" >&2
  exit 1
fi
