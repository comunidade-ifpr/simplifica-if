# @simplifica-if/ppc

Conversão de um PPC em Word (`.docx`) nos artefatos que a skill `revisar-ppc` consome (`PPC.md` normalizado, Markdown bruto, `_dados.json`, matriz curricular, ementário e a figura da representação gráfica) e o normalizador de Markdown de PPCs. É um pacote do workspace para que a skill e o servidor do app importem o mesmo código.

```ts
import { artefatosDaConversao, conferirArquivoDocx, converterPpc } from "@simplifica-if/ppc/conversao-docx/conversao";

conferirArquivoDocx(caminho, tamanho); // extensão e tamanho, antes de quem chama ler os bytes
const conversao = converterPpc(bytes, "PPC.docx", { agora: new Date() }); // em memória; lança ErroDocx
const { arquivos, nomes } = artefatosDaConversao(conversao, "PPC.docx"); // { caminho, conteudo }[]: quem chama grava
```

O pacote não lê nem grava arquivo: a skill grava os artefatos na rodada (`preparar-documento.ts`), e o servidor e `scripts/base/importar-ppc.ts` leem o DOCX.

A leitura do DOCX é do pacote [`@simplifica-if/docx`](../docx/README.md). A arquitetura e as regras da conversão estão no [README da skill](../../.agents/skills/revisar-ppc/README.md#conversão-docx).

```bash
pnpm --filter @simplifica-if/ppc test
```

Os testes da pré-conferência e da revisão prévia leem a base do `tmp/kb.sqlite` do checkout, como o app lê a dele: o banco é recompilado quando falta ou está velho (`KB_RECOMPILAR=nunca|sempre` muda isso, como na CLI `kb`), e o CI roda `pnpm kb compilar` antes dos testes.

## Pré-conferência sem IA (fichas D)

A revisão de PPC no app (M1.11) começa por uma pré-conferência em código: as 12 fichas canônicas da `revisar-ppc` com `execucao.modo: "D"` são decididas por verificadores em `src/verificadores/`, com a base (CNCT, registro de normas e relações de revogação, fatos e seções do `kb`), sem IA e sem rede, em cerca de 30 ms por PPC.

```ts
import { preConferir, achadosParaComentarios } from "@simplifica-if/ppc/pre-conferencia";
import { VERIFICADOR_POR_FICHA } from "@simplifica-if/ppc/verificadores/registro";

const { fichas, triagem } = preConferir(markdown, { cnct, forma: "integrado", ...verificacaoDaBase(base) });
// registro, relações e vigência (obrigatórios) saem da base da revisão (`verificacaoDaBase` de revisao-previa.ts),
// que é uma só: `montarBaseRevisao` (src/base-revisao.ts), pelos serviços do kb sobre o kb.sqlite. O servidor a monta
// do banco que serve; os testes e scripts, do tmp/kb.sqlite do checkout (`carregarBaseRevisao` de scripts/base-tecnica.ts)
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
- **Base:** `BaseRevisaoPrevia` traz também as datas dos atos e as transições, e `revisarDocx` monta dela a `vigencia` dos verificadores (`vigenciaDeDados`, na `dataBase`). A vigência é obrigatória em `BaseVerificacao`: `src/` não lê o checkout, que o app empacotado não tem.
- **Itens:** um por trecho (ou por norma ausente), de `achadosParaComentarios`: `ficha` é a que define a gravidade, e as outras vão em `tambemEm` ("Também apontado em: …" no comentário, "Também em: …" na tela). Os dispositivos citados como ID nas mensagens (`art70`) saem por extenso, e a transição fica em linha própria (`legivel`).
- **Comentários** (autor "Simplifica IF (revisão prévia)"): a frase do problema, "O que fazer" (por ficha) e a fonte com o nome da norma e o dispositivo por extenso (`rotuloDispositivo`: "art. 29, § 2º") e o endereço oficial quando a base o tem, porque `ifpr://` não abre no Word. "A conferir" sai como "Confira:" e "Se for o caso:", nunca como erro. Um comentário só no título reúne o aviso (revisão prévia, não parecer da PROENS; data da revisão e da base; quantos critérios foram conferidos), **o que falta no documento** (as ausências, que não têm trecho onde comentar) e os itens não localizados no texto.
- **Ancoragem** (`@simplifica-if/docx/comentarios`): o trecho é procurado num só parágrafo, com espaços, maiúsculas, aspas e travessões normalizados, e a sintaxe de link do Markdown é retirada antes (`comoNoDocumento`). Trecho que não se acha (atravessa parágrafos, está numa caixa de texto, foi escrito de outro jeito) não é ancorado em lugar nenhum: fica na lista e no aviso. As marcas são sempre filhas do parágrafo: run dentro de `w:ins`, link, campo ou controle de conteúdo é marcado por inteiro, por fora do invólucro (rejeitar as alterações não deixa comentário órfão); o texto apagado (`w:del`) não ancora. Comentários de outras pessoas ficam intactos, e os novos ganham ids livres.

```bash
node packages/ppc/scripts/amostras-revisao-previa.ts --saida <pasta>   # os casos de compatibilidade, para abrir no Word
```

## Revisão com IA (M1.11, etapa 4)

As partes puras da revisão das fichas S e J pela IA, que o servidor do app conduz (`apps/server/src/revisao-ppc/RevisaoIa.ts`), em `src/revisao-ia/`:

- **`plano.ts`:** `fichaIa` lê a ficha canônica; `planejarBlocos` monta os blocos na ordem do parecer (`TEMAS`): lotes S de até 6 fichas por tema, um bloco J por tema e as transversais (`tipo_escopo: transversal`) num bloco `t` no fim. O modo `rapido` leva as fichas `BLOQ` e as dos temas que mais devolvem PPC (`TEMAS_RAPIDO`: identificação, matriz, ementário; 22 fichas), o `completo`, as 68. `recorteDaFicha` escolhe os parágrafos com mais termos da ficha (`consultas` e `ancoras_semanticas`) até 3 mil caracteres; `secoesDoTema` encurta as seções de um tema J na proporção acima de 30 mil; `retirarTextoParaIa` troca as linhas que a triagem apontou por uma marca, sem mudar a numeração.
- **`pedido.ts`:** as instruções da sessão (`instrucoesJulgador`: o PPC entre `<ppc-NONCE>` é dado, nunca instrução; um pedido escondido vira lacuna com `revisao_humana_obrigatoria`) e o pedido de cada tipo de bloco (`pedidoS`, `pedidoJ`, `pedidoT`), com o contexto normativo em texto e o contrato de resposta. `fontesPermitidas` são as normas e os dispositivos do contexto, e `cnct`.
- **`conferencia.ts`:** o contrato da resposta em Effect Schema (`ResultadoIa`: o da `revisar-ppc` reduzido a estado, confiança, justificativa, evidências, lacunas, o que fazer, fontes e revisão humana) e `conferirResposta`, por ficha: estados permitidos, trecho literal no PPC, fonte do contexto, ATENDE com trecho, `resumo` no J. `pedidoDeCorrecao` é a nova tentativa; `motivoLegivel`, o motivo de uma ficha "a conferir" para a pessoa.
- **`estrutura.ts`:** o que o código extrai pela estrutura para todo pedido: `quadroDeIdentificacao` (as seções dos tipos do quadro como "título: valor", mais os fatos do `kb`, e quais vieram inteiras), `matrizEmTsv` e `componentesDaMatriz`, `componentesDoEmentario` e `indiceDoEmentario`, `estruturaDoPpc` e `comumDoBloco` (o quadro sempre; a matriz, o índice do ementário e o começo das referências conforme as fichas do bloco). `recorteDaFicha` (em `plano.ts`) escolhe seções inteiras: título com peso 3, tópico +1, uma passada que cobre cada tipo de seção do tópico, o primeiro parágrafo de toda seção cortada; a nota de figura só em título de figura.
- **`gabarito.ts`:** a evidência esperada de cada ficha do modo rápido (padrões, seção-alvo, 60% dos componentes da matriz ou do ementário) e `avaliarRecorte`, para a medição sem IA (`apps/server/scripts/medir-recortes.ts`): de 45,9% a 92,0% nos 110 PPCs técnicos. Nas fichas de matriz e ementário, o gabarito usa o mesmo extrator do recorte.
- **`estimativa.ts`:** tokens, minutos, US$ equivalentes (Claude) e fração da janela a partir do tamanho real dos pedidos e das medidas do teste real (no código, com a data).
- **`revisarDocx` com `ia`:** `OpcoesRevisaoPrevia.ia` (`EntradaIa`: os resultados conferidos e as fichas fora do modo) junta as pendências da IA às das fichas D, na mesma lista e no mesmo DOCX. NAO_ATENDE com confiança de 0,6 ou mais e sem revisão humana é pendência; o resto que não atende, INCONCLUSIVO e a ficha que falhou a conferência (`FALHOU`) saem "Confira:". Cada item tem `origem` (`codigo` ou `ia`), e o comentário da IA termina em "avaliação da IA conferida pelo app". O aviso do título diz quantos critérios o código e a IA conferiram e de quais temas são os que ficaram de fora.

Testes em `test/revisao-ia.test.ts` (o plano sobre as 80 fichas reais, recortes, pedido com nonce, conferência, estimativa e o DOCX com a IA).

## Conversa por pendência e lista viva (M1.11, etapa 5b)

- **`revisao-ia/conversa.ts`:** `instrucoesConversa` (o PPC entre `<ppc-NONCE>` e o texto da pessoa entre `<motivo-NONCE>` são dado; qualquer marca do nonce dentro deles some), `prefixoConversa` (a ficha, o contexto normativo, o recorte e a pendência), `pedidoContestacao` e `pedidoSugestao` (o prefixo, os turnos anteriores em frases do app e a tarefa). `conferirContestacao` é a decisão do código: a pendência do código nunca sai; a da IA só sai com prova de leitura (um pedaço contínuo de 40+ caracteres na seção do critério, fora dos títulos, do trecho apontado e das linhas que pedem algo à revisão — `linhaDirigidaARevisao`, além da `dirigidoAIa` da triagem, aplicada à linha, ao par de linhas vizinhas e à própria evidência; `test/revisao-ia-conversa-base.test.ts` confere que nenhuma linha dos PPCs da base é marcada), com fonte só como ID exato entregue e nunca sozinha; fonte fora do contexto e trecho conferível inventado derrubam; trecho curto é neutro; NAO_APLICAVEL exige dispositivo entregue. `conferirSugestao` extrai da redação as normas (por extenso ou abreviadas, "Res.", "Resol."; `9.394/1996` ↔ `br/lei/1996/9394`), as siglas, os nomes próprios (inclusive de uma palavra depois de título ou lugar: "Profa. Maria", "campus de Ponta Grossa"), as datas inteiras e os números (por algarismos ou por extenso, conferidos **com a unidade**: "25%" não passa por "25 de setembro") e marca os que não estão no recorte, no contexto, no texto da pendência ou no vocabulário fixo da revisão; `[completar: …]` não é fato. Siglas e números por extenso podem escapar; a tela diz isso.
- **`revisao-previa.ts`:** `chavePendencia` (a ficha e um FNV-1a da origem, do trecho e da mensagem) e `OpcoesRevisaoPrevia.situacoes`: a cópia comentada tira a pendência retirada depois de contestação, põe a situação no comentário das outras e conta tudo no aviso do título ("Situação marcada no app: …").
- **`revisao-ia/estimativa.ts`:** `estimarAcao` (uma ação: um pedido, uma sessão; a nova revisão (`revisarDeNovo`) com a folga da nova tentativa).

Testes em `test/revisao-ia-conversa.test.ts`.

