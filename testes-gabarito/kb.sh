#!/bin/sh
# Gabarito da CLI `kb`: stdout e código de saída de cada invocação, byte a byte.
#
#   sh testes-gabarito/kb.sh --comparar     # confere com testes-gabarito/kb/
#   sh testes-gabarito/kb.sh --capturar     # regrava o gabarito (só por decisão explícita)
#
# Neutro de runtime: o comando da CLI vem de $KB (padrão: `node packages/kb/src/cli.ts`). O
# gabarito do C0 foi capturado com `KB="bun packages/kb/src/cli.ts"`. Ajuda (`--help`) e stderr
# ficam fora. Roda a partir da raiz do repositório; a CLI recompila o `tmp/kb.sqlite` se ele
# faltar ou estiver velho, e essa saída vai para o stderr.
set -u

RAIZ=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$RAIZ" || exit 2
KB=${KB:-node packages/kb/src/cli.ts}
DIR=testes-gabarito/kb

modo=${1:-}
case "$modo" in
  --capturar | --comparar) ;;
  *)
    echo "uso: sh testes-gabarito/kb.sh --capturar | --comparar" >&2
    exit 2
    ;;
esac

# Um caso por linha: nome, TAB, argumentos da CLI (em sintaxe de shell). Cada consulta roda em
# texto e com --json.
CASOS=$(cat <<'FIM'
buscar-norma-citacao	buscar-norma "Resolução CNE/CP nº 2/2026, art. 28"
buscar-norma-id	buscar-norma br/cne-cp/res/2026/2
buscar-norma-termos	buscar-norma "estágio supervisionado obrigatório"
buscar-norma-vigentes	buscar-norma "itinerário formativo" --vigentes --limite 5
buscar-norma-situacao	buscar-norma "educação profissional" --situacao stub
buscar-secoes	buscar-secoes "acompanhamento de egressos" --cnct tecnico-em-agropecuaria
buscar-secoes-filtros	buscar-secoes "estágio obrigatório" --nivel médio --campus curitiba --forma integrado --limite 5
buscar-secoes-integral	buscar-secoes "estágio obrigatório" --ppc curitiba/tecnico-em-enfermagem --limite 3 --integral
buscar-secoes-tipo	buscar-secoes "avaliação da aprendizagem" --tipo avaliacao --limite 5
buscar-secoes-simples	buscar-secoes "acompanhamento de egressos" --modo simples --limite 5
cursos-eixo	cursos --eixo "Informação e Comunicação" --processo processo-seletivo-2026
cursos-campus	cursos --campus curitiba
cursos-turno	cursos --turno noturno --nivel médio
ppc-fatos	ppc-fatos curitiba/tecnico-em-enfermagem
ppc-fatos-todos	ppc-fatos
ppc-fatos-divergencias	ppc-fatos --divergencias --nivel médio
pacote-contexto	pacote-contexto CT-CURR-12 curitiba/tecnico-em-enfermagem
pacote-contexto-todas	pacote-contexto todas curitiba/tecnico-em-enfermagem
resolver	resolver "Resolução CNE/CP nº 1/2021, art. 20"
resolver-lei	resolver "Lei nº 9.394/1996, art. 36"
citacoes	citacoes br/cne-cp/res/2021/1
citacoes-dispositivo	citacoes "br/cne-cp/res/2021/1#art20" --confianca-min 0.9
adequacao-art71	adequacao-art71
adequacao-art71-tecnologia	adequacao-art71 --incluir-tecnologia
dispositivo	dispositivo "br/cne-cp/res/2026/2#art28-xviii"
dispositivo-filhos	dispositivo "br/cne-cp/res/2026/2#art28" --filhos
vigencia	vigencia br/cne-cp/res/2021/1 --em 2026-11-01
vigencia-referencia	vigencia br/cne-cp/res/2026/2
correspondencia	correspondencia "br/cne-cp/res/2021/1#art20"
impacto	impacto br/cne-cp/res/2021/1
impacto-sem-ppcs	impacto br/lei/1996/9394 --sem-ppcs
relacoes	relacoes br/lei/1996/9394
relacoes-propor	relacoes --propor
avaliar-resolvedor	avaliar-resolvedor
avaliar-busca	avaliar-busca
erro-resolver-sem-citacao	resolver "texto qualquer sem citação normativa"
erro-dispositivo-inexistente	dispositivo "br/cne-cp/res/2026/2#art999"
erro-norma-inexistente	vigencia br/xx/res/1900/1
erro-citacoes-inexistente	citacoes br/xx/res/1900/1
erro-ppc-inexistente	ppc-fatos campus-inexistente/curso-inexistente
erro-pacote-ficha-inexistente	pacote-contexto CT-NAO-EXISTE curitiba/tecnico-em-enfermagem
erro-correspondencia-inexistente	correspondencia "br/xx/res/1900/1#art1"
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

: > "$saida/codigos.txt"
rodar() {
  nome=$1
  shift
  eval "$KB $*" > "$saida/$nome.out" 2> /dev/null
  printf '%s\t%s\n' "$nome" "$?" >> "$saida/codigos.txt"
}

TAB=$(printf '\t')
echo "$CASOS" | while IFS="$TAB" read -r nome args; do
  [ -n "$nome" ] || continue
  rodar "$nome" "$args"
  rodar "$nome.json" "$args --json"
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
