#!/bin/sh
# Gabarito da CLI `kb`: stdout, stderr e código de saída de cada invocação, byte a byte.
#
#   sh testes-gabarito/kb.sh --comparar     # confere com testes-gabarito/kb/
#   sh testes-gabarito/kb.sh --capturar     # regrava o gabarito (só por decisão explícita)
#
# As consultas da CLI são as ferramentas do MCP, e a `Resposta` delas já está em
# testes-gabarito/mcp.json; aqui fica o que é só da CLI: a leitura dos argumentos e das flags, o texto
# Markdown impresso, as páginas seguidas por --todas-as-paginas, as mensagens de erro no stderr e o
# código de saída, mais os comandos de curadoria (em texto e com --json). O cursor das páginas e a
# versão `dev-<8 hex>` da base levam a impressão das fontes, que muda com qualquer mudança de código, e
# saem mascarados.
#
# Neutro de runtime: o comando da CLI vem de $KB (padrão: `node packages/mcp/src/kb.ts`). Roda a
# partir da raiz do repositório. Uma primeira chamada recompila o `tmp/kb.sqlite`, se ele faltar ou
# estiver velho; as invocações do gabarito rodam com KB_RECOMPILAR=nunca, para o stderr ter só o erro.
set -u

RAIZ=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$RAIZ" || exit 2
KB=${KB:-node packages/mcp/src/kb.ts}
DIR=testes-gabarito/kb

modo=${1:-}
case "$modo" in
  --capturar | --comparar) ;;
  *)
    echo "uso: sh testes-gabarito/kb.sh --capturar | --comparar" >&2
    exit 2
    ;;
esac

# Um caso por linha: nome, TAB, argumentos da CLI (em sintaxe de shell).
CASOS=$(cat <<'FIM'
buscar-norma-citacao	buscar-norma "Resolução CNE/CP nº 2/2026, art. 28" --limite 3
buscar-norma-vigentes	buscar-norma "itinerário formativo" --vigentes --em 2026-11-01 --limite 5
buscar-norma-situacao	buscar-norma "educação profissional" --situacao stub
ler-dispositivos	ler-dispositivos "br/cne-cp/res/2026/2#art28-xviii" "br/cne-cp/res/2026/2#art71" --filhos
ficha-norma	ficha-norma br/cne-cp/res/2021/1 --em 2026-11-01
correspondencia	correspondencia "br/cne-cp/res/2021/1#art20"
resolver-citacoes	resolver-citacoes "Resolução CNE/CP nº 1/2021, art. 20" "Lei nº 9.394/1996, art. 36" "texto qualquer sem citação normativa"
citacoes-da-norma	citacoes-da-norma "br/cne-cp/res/2021/1#art20" --confianca-min 0.9 --campus curitiba
impacto-da-norma	impacto-da-norma br/cne-cp/res/2021/1
adequacao-art71	adequacao-art71 --incluir-tecnologia --campus curitiba
buscar-secoes	buscar-secoes "estágio obrigatório" --nivel médio --campus curitiba --tipo estagio_praticas --tipo avaliacao --limite 5
ler-secao	ler-secao "curitiba/tecnico-em-enfermagem#estagio_praticas-1"
listar-cursos-todas	listar-cursos --campus curitiba --limite 10 --todas-as-paginas
ficha-curso	ficha-curso curitiba/tecnico-em-enfermagem
fatos-ppc	fatos-ppc --divergencias --nivel médio --campus curitiba
pacote-contexto	pacote-contexto CT-CURR-12 --ppc curitiba/tecnico-em-enfermagem
pacote-contexto-arquivo	pacote-contexto CT-CURR-12 --arquivo base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem.md
sobre-a-base	sobre-a-base
relacoes-propor	relacoes --propor
relacoes-propor.json	relacoes --propor --json
avaliar-resolvedor	avaliar-resolvedor
avaliar-resolvedor.json	avaliar-resolvedor --json
avaliar-busca	avaliar-busca
avaliar-busca.json	avaliar-busca --json
erro-norma-inexistente	ficha-norma br/xx/res/1900/1
erro-limite-texto	buscar-norma LDB --limite abc
erro-limite-faixa	buscar-norma LDB --limite 99
erro-data	ficha-norma br/cne-cp/res/2021/1 --em 01/11/2026
erro-sem-argumento	ficha-norma
erro-flag-desconhecida	sobre-a-base --cursor x
erro-relacoes-sem-propor	relacoes
erro-pacote-ficha-inexistente	pacote-contexto CT-NAO-EXISTE --ppc curitiba/tecnico-em-enfermagem
erro-pacote-ppc-e-arquivo	pacote-contexto CT-CURR-12 --ppc curitiba/tecnico-em-enfermagem --arquivo PPC.md
erro-ppc-inexistente	ficha-curso campus-inexistente/curso-inexistente
FIM
)

saida=$DIR
if [ "$modo" = "--comparar" ]; then
  saida=$(mktemp -d)
  trap 'rm -rf "$saida"' EXIT
else
  rm -rf "$DIR"
  mkdir -p "$DIR"
fi

# recompila o banco, se preciso, fora do gabarito
eval "$KB sobre-a-base" > /dev/null 2>&1

: > "$saida/codigos.txt"
rodar() {
  nome=$1
  shift
  eval "KB_RECOMPILAR=nunca $KB $*" > "$saida/$nome.out" 2> "$saida/$nome.err"
  printf '%s\t%s\n' "$nome" "$?" >> "$saida/codigos.txt"
  sed -E -e 's/cursor: "[^"]*"/cursor: "…"/g' -e 's/`dev-[0-9a-f]{8}`/`dev-…`/g' "$saida/$nome.out" > "$saida/$nome.tmp" && mv "$saida/$nome.tmp" "$saida/$nome.out"
  [ -s "$saida/$nome.err" ] || rm -f "$saida/$nome.err"
}

TAB=$(printf '\t')
echo "$CASOS" | while IFS="$TAB" read -r nome args; do
  [ -n "$nome" ] || continue
  rodar "$nome" "$args"
done

if [ "$modo" = "--capturar" ]; then
  echo "gabarito da CLI kb gravado em $DIR ($(wc -l < "$DIR/codigos.txt" | tr -d ' ') invocações)"
  exit 0
fi

falhas=0
for arquivo in "$DIR"/*; do
  base=$(basename "$arquivo")
  if ! cmp -s "$arquivo" "$saida/$base"; then
    echo "DIFERENTE: $base" >&2
    falhas=$((falhas + 1))
  fi
done
for arquivo in "$saida"/*; do
  base=$(basename "$arquivo")
  [ -e "$DIR/$base" ] || { echo "NOVO (fora do gabarito): $base" >&2; falhas=$((falhas + 1)); }
done
if [ "$falhas" -gt 0 ]; then
  echo "gabarito da CLI kb: $falhas diferença(s)" >&2
  exit 1
fi
echo "gabarito da CLI kb: igual ($(wc -l < "$DIR/codigos.txt" | tr -d ' ') invocações)"
