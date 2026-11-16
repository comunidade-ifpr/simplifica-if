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

const { fichas, triagem } = preConferir(markdown, { cnct, forma: "integrado", registro, relacoes });
// fichas: um ResultadoFicha por ficha D (estado atende | nao_atende | a_conferir | nao_se_aplica,
// apontamentos com trechos literais, linha e seção, fontes ifpr://); triagem: texto dirigido à IA e seções ausentes
const itens = achadosParaComentarios({ fichas, triagem }); // trechos como no DOCX, para comentarDocx
```

| Ficha | Verificador | O que confere |
|---|---|---|
| CT-IDENT-01 | `d-denominacao-cnct` | denominação "Técnico em …" do início do PPC contra a do CNCT |
| CT-IDENT-08 | `d-base-legal-identidade` | normas revogadas nas seções de identidade; DCN da EPT 2026 (e DCNEM no integrado) citadas |
| CT-IDENT-13 | `d-eixo-cnct` | eixo tecnológico declarado contra o do CNCT (divergência a conferir) |
| CT-CURR-02 | `d-carga-horaria-total` | CH total extraída contra o mínimo do CNCT e as 3.000 h do integrado (a conferir) |
| CT-CURR-16 | `d-requisito-ingresso` | escolaridade de ingresso contra a do CNCT para a forma (a conferir) |
| CT-CURR-18 | `d-componentes-fgb` | os 12 componentes da Formação Geral Básica na matriz e no ementário, no integrado (a conferir) |
| CT-CURR-22 | `d-aee-componente` | AEE como componente nas tabelas da matriz ou do ementário |
| CT-SUP-09 | `d-marcos-nas-referencias` | marcos vigentes da forma de oferta na seção de referências |
| CT-SUP-12 | `d-normas-revogadas` | normas revogadas citadas, e se a sucessora em vigor também é citada |
| CT-SUP-14 | `d-cnct-e-marcos-institucionais` | CNCT e PDI, PPI, Regimento ou Estatuto mencionados |
| CT-SUP-21 | `d-legislacao-profissional` | legislação profissional do CNCT citada (com o conselho só mencionado, a conferir) |
| CT-SUP-24 | `d-politica-assistencia-estudantil` | Res. CONSUP/IFPR nº 239/2025 citada, e as nº 11/2009 e 53/2011, revogadas por ela |

**Prudência:** tudo o que depende de extração incerta (fatos `extraido`, classificação de títulos, citação de confiança menor) sai `a_conferir`, nunca `nao_atende`. Uma regra só dá `nao_atende` com a precisão medida na base: a tabela e a amostra conferida à mão estão em [`PRECISAO.md`](PRECISAO.md), e os números agregados, fixados em `test/precisao-base.test.ts`.

**Registro:** `src/verificadores/registro.ts` é o mapa ficha → verificador que a etapa com IA consulta para saber o que o código já resolveu. O `revisar_ppc.ts validar-base` da skill recusa ficha D sem verificador e verificador de ficha que não é D, e `test/verificadores.test.ts` exige, para cada verificador, um caso que atende e um com problema. Para criar um verificador: escreva-o em `src/verificadores/`, registre-o, mude a ficha para `D` (com a justificativa), acrescente os casos, meça na base e atualize `PRECISAO.md` e o teste de regressão.

```bash
node packages/ppc/scripts/pre-conferencia.ts --base                                    # contagem por ficha nos 110 PPCs técnicos
node packages/ppc/scripts/pre-conferencia.ts --base --amostra CT-SUP-21 --estado nao_atende
node packages/ppc/scripts/pre-conferencia.ts --docx <PPC.docx> --cnct <slug> --forma integrado --saida <comentado.docx>
```

## Revisão prévia em DOCX (M1.11, etapa 3)

`revisarDocx` (`src/revisao-previa.ts`) junta a conversão, a pré-conferência e os comentários do Word numa função pura sobre bytes e dados planos (o servidor do app a roda num `Worker`):

```ts
import { revisarDocx } from "@simplifica-if/ppc/revisao-previa";

const revisao = revisarDocx(bytes, "PPC.docx", base, { agora: new Date() }); // base: BaseRevisaoPrevia (do kb.sqlite no app)
// revisao.docx: a cópia com comentários; revisao.pendencias: por tema, com o que fazer, trecho, fontes legíveis
// e onde o comentário ficou (no-trecho | no-inicio | so-na-lista); revisao.curso: CNCT e forma identificados
```

- **Curso:** o CNCT é a denominação mais longa do catálogo que aparece nas 200 primeiras linhas; a forma, PROEJA se aparece, senão a mais citada entre integrado, subsequente e concomitante. A pessoa pode escolher os dois (`cnct`, `forma`). Sem curso identificado, os critérios que dependem dele saem "a conferir".
- **Temas:** a ordem do parecer da PROENS (as paradas da proposta B, `TEMAS`), pelo tópico da ficha em `topicos-fichas.json`; a triagem vem antes, em "Antes de começar".
- **Comentários** (autor "Simplifica IF (revisão prévia)"): a frase do problema, "O que fazer" (por ficha) e a fonte com o nome da norma e o dispositivo por extenso (`rotuloDispositivo`: "art. 29, § 2º") e o endereço oficial quando a base o tem, porque `ifpr://` não abre no Word. "A conferir" sai como "Confira:" e "Se for o caso:", nunca como erro. Ausência (sem trecho) é comentada no título. Um comentário no título avisa que é revisão prévia, não parecer da PROENS, com a data da revisão, a data da base, quantos critérios foram conferidos e os itens não localizados no texto.
- **Ancoragem** (`@simplifica-if/docx/comentarios`): o trecho é procurado num só parágrafo, com espaços, maiúsculas, aspas e travessões normalizados, e a sintaxe de link do Markdown é retirada antes (`comoNoDocumento`). Trecho que não se acha (atravessa parágrafos, está numa caixa de texto, foi escrito de outro jeito) não é ancorado em lugar nenhum: fica na lista e no aviso. As marcas são sempre filhas do parágrafo: run dentro de `w:ins`, link, campo ou controle de conteúdo é marcado por inteiro, por fora do invólucro (rejeitar as alterações não deixa comentário órfão); o texto apagado (`w:del`) não ancora. Comentários de outras pessoas ficam intactos, e os novos ganham ids livres.

```bash
node packages/ppc/scripts/amostras-revisao-previa.ts --saida <pasta>   # os casos de compatibilidade, para abrir no Word
```
