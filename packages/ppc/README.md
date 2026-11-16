# @simplifica-if/ppc

Conversão de um PPC em Word (`.docx`) nos artefatos que a skill `revisar-ppc` consome (`PPC.md` normalizado, Markdown bruto, `_dados.json`, matriz curricular, ementário e a figura da representação gráfica) e o normalizador de Markdown de PPCs. É um pacote do workspace para que a skill e o servidor do app importem o mesmo código.

```ts
import { converterPpc, gravarArtefatos } from "@simplifica-if/ppc/conversao-docx/conversao";

const conversao = converterPpc(bytes, "PPC.docx", { agora: new Date() }); // em memória; lança ErroDocx
const artefatos = gravarArtefatos(conversao, "PPC.docx", pastaDeSaida);
```

A leitura do DOCX é do pacote [`@simplifica-if/docx`](../docx/README.md). A arquitetura, as regras do modo `documento` (`src/conversao-docx/regras.ts`), as diferenças em relação à conversão antiga em Python e o diferencial (`scripts/diferencial-docx.ts`) estão no [README da skill](../../.agents/skills/revisar-ppc/README.md#conversão-docx).

```bash
pnpm --filter @simplifica-if/ppc test
node packages/ppc/scripts/diferencial-docx.ts   # precisa de git, uv e diff
```

## Pré-conferência sem IA (fichas D)

A revisão de PPC no app (M1.11) começa por uma pré-conferência em código: as 12 fichas canônicas da `revisar-ppc` com `execucao.modo: "D"` são decididas por verificadores em `src/verificadores/`, com a base (CNCT, registro de normas e relações de revogação, fatos e seções do `kb`), sem IA e sem rede, em cerca de 30 ms por PPC.

```ts
import { preConferir, achadosParaComentarios } from "@simplifica-if/ppc/pre-conferencia";
import { VERIFICADOR_POR_FICHA } from "@simplifica-if/ppc/verificadores/registro";

const { fichas, triagem } = preConferir(markdown, { cnct, forma: "integrado", registro, relacoes, vigencia });
// vigencia (opcional): carregarVigencia(raiz) de verificadores/vigencia.ts; sem ela, a da base do checkout
// fichas: um ResultadoFicha por ficha D (estado atende | nao_atende | a_conferir | nao_se_aplica,
// apontamentos com trechos literais, linha e seção, fontes ifpr://); triagem: texto dirigido à IA e seções ausentes
const itens = achadosParaComentarios({ fichas, triagem }); // um item por trecho, com `fichas`; trechos como no DOCX
```

| Ficha | Verificador | O que confere |
|---|---|---|
| CT-IDENT-01 | `d-denominacao-cnct` | denominação "Técnico em …" do início do PPC contra a do CNCT |
| CT-IDENT-08 | `d-base-legal-identidade` | normas revogadas nas seções de identidade; DCN da EPT 2026 (e DCNEM no integrado) citadas (ficha de base legal: só registra) |
| CT-IDENT-13 | `d-eixo-cnct` | eixo tecnológico declarado contra o do CNCT (divergência a conferir) |
| CT-CURR-02 | `d-carga-horaria-total` | CH total extraída contra o mínimo do CNCT e as 3.000 h do integrado (a conferir) |
| CT-CURR-16 | `d-requisito-ingresso` | escolaridade de ingresso contra a do CNCT para a forma (a conferir) |
| CT-CURR-18 | `d-componentes-fgb` | os 12 componentes da Formação Geral Básica na matriz e no ementário, no integrado (a conferir) |
| CT-CURR-22 | `d-aee-componente` | AEE como componente nas tabelas da matriz ou do ementário |
| CT-SUP-09 | `d-marcos-nas-referencias` | marcos vigentes da forma de oferta na seção de referências (as DCN só registra) |
| CT-SUP-12 | `d-normas-revogadas` | normas revogadas citadas (vigência, transição e cadeia de sucessoras), e a norma vigente dos marcos não citada; é a responsável pelos marcos da DCN da EPT e da DCNEM |
| CT-SUP-14 | `d-cnct-e-marcos-institucionais` | CNCT e PDI, PPI, Regimento ou Estatuto mencionados |
| CT-SUP-21 | `d-legislacao-profissional` | legislação profissional do CNCT citada (com o conselho só mencionado, a conferir) |
| CT-SUP-24 | `d-politica-assistencia-estudantil` | Res. CONSUP/IFPR nº 239/2025 citada, e as nº 11/2009 e 53/2011, revogadas por ela |

**Prudência:** tudo o que depende de extração incerta (fatos `extraido`, classificação de títulos, citação de confiança menor) ou de vigência a confirmar (a Res. CNE/CP nº 2/2026, sem a publicação no DOU) sai `a_conferir`, nunca `nao_atende`; norma revogada com transição em curso também. Só a ficha responsável pelo marco normativo (`marcos-normativos.json` da skill, copiado em `verificadores/vigencia.ts` e conferido em teste) eleva um fato do marco a `nao_atende`; as fichas de base legal registram. Uma regra só dá `nao_atende` com a precisão medida na base: a tabela, as regras de vigência e a amostra conferida à mão estão em [`PRECISAO.md`](PRECISAO.md); os números exatos são conferidos por `pre-conferencia.ts --base --check` (fora do `pnpm test`, porque dependem da base), e `test/precisao-base.test.ts` confere os invariantes.

**Registro:** `src/verificadores/registro.ts` é o mapa ficha → verificador que a etapa com IA consulta para saber o que o código já resolveu. O `revisar_ppc.ts validar-base` da skill recusa ficha D sem verificador e verificador de ficha que não é D, e `test/verificadores.test.ts` exige, para cada verificador, um caso que atende e um com problema. Para criar um verificador: escreva-o em `src/verificadores/`, registre-o, mude a ficha para `D` (com a justificativa), acrescente os casos, meça na base, confira uma amostra e atualize `PRECISAO.md` e `scripts/precisao-base.json` (`--gravar`).

```bash
node packages/ppc/scripts/pre-conferencia.ts --base                                    # contagem por ficha nos 110 PPCs técnicos
node packages/ppc/scripts/pre-conferencia.ts --base --check                            # os números de PRECISAO.md
node packages/ppc/scripts/pre-conferencia.ts --base --amostra CT-SUP-21 --estado nao_atende
node packages/ppc/scripts/pre-conferencia.ts --docx <PPC.docx> --cnct <slug> --forma integrado --saida <comentado.docx>
```
