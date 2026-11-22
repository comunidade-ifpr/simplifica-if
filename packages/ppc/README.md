# @simplifica-if/ppc

Conversão de um PPC em Word (`.docx`) em Markdown e nos artefatos da revisão (`PPC.md` normalizado, Markdown bruto, `_dados.json`, matriz curricular, ementário e a figura da representação gráfica), o normalizador de Markdown de PPCs e a revisão prévia do app (pré-conferência, revisão com IA e cópia comentada). O servidor do app e a importação de PPC (`scripts/base/importar-ppc.ts`) importam o mesmo código.

```ts
import { artefatosDaConversao, conferirArquivoDocx, converterPpc } from "@simplifica-if/ppc/conversao-docx/conversao";

conferirArquivoDocx(caminho, tamanho); // extensão e tamanho, antes de quem chama ler os bytes
const conversao = converterPpc(bytes, "PPC.docx", { agora: new Date() }); // em memória; lança ErroDocx
const { arquivos, nomes } = artefatosDaConversao(conversao, "PPC.docx"); // { caminho, conteudo }[]: quem chama grava
```

O pacote não lê nem grava arquivo: o servidor e `scripts/base/importar-ppc.ts` leem o DOCX e gravam o que precisam.

A leitura do DOCX e a camada genérica de texto (elementos, tabelas em grade, o `Escritor` de Markdown e o orçamento de texto) são do pacote [`@simplifica-if/docx`](../docx/README.md); aqui ficam as seções (`secoes.ts`), a matriz, o ementário, a identificação, a figura da representação gráfica, a escrita por seções (`markdown.ts`) e o normalizador. As regras da conversão estão em [Conversão do DOCX](#conversão-do-docx).

```bash
pnpm --filter @simplifica-if/ppc test
```

Os testes da pré-conferência e da revisão prévia leem a base do `tmp/kb.sqlite` do checkout, como o app lê a dele: o banco é recompilado quando falta ou está velho (`KB_RECOMPILAR=nunca|sempre` muda isso, como na CLI `kb`), uma vez só, no `globalSetup` do `vite.config.ts` do pacote (`test/banco-fresco.ts`), antes dos arquivos de teste, que rodam em paralelo; o CI roda `pnpm kb compilar` antes dos testes.

## Conversão do DOCX

A conversão (`src/conversao-docx/`) fica sobre a camada genérica do `docx` (`elementos.ts`: título, parágrafo, item de lista, grade de tabela, figura; `tabelas.ts`; `orcamento.ts`; a escrita em `markdown.ts`): `secoes.ts`, `matriz.ts`, `ementario.ts` e `similaridade.ts` (o `partial_ratio` do `rapidfuzz`), `identificacao-tabelas.ts`, `figura.ts`, `markdown.ts` (as seções) e `conversao.ts`; e o `normalizador-markdown.ts`, usado também na entrada `.md`. Ela lê o texto que o Word mostra (inclusive as alterações controladas ainda não aceitas) e aplica as regras abaixo.

### Arquivo hostil ou quebrado

O app abre arquivos do usuário. O leitor e a conversão recusam, com `ErroDocx` e mensagem em português:

- o que não é ZIP, o `.doc` renomeado e o DOCX protegido por senha (contêiner OLE: "arquivo do Word 97-2003 (.doc) ou um DOCX protegido por senha");
- ZIP truncado ou com entrada cifrada;
- XML malformado ou truncado (antes virava um `PPC.md` pela metade, sem aviso);
- documento sem texto nenhum (vazio, ou PPC digitalizado como imagem);
- o que passa dos limites abaixo.

Os limites ficam em dois lugares, um por pacote, e quem chama pode trocar qualquer um (`limites` e `limitesDeTexto` nas opções de `converterPpc`). Os padrões vêm dos 12 PPCs reais conferidos em 16/11/2026.

| Limite (`packages/docx/src/limites.ts`) | Padrão | Maior valor nos PPCs reais |
|---|---:|---:|
| Arquivo `.docx` (`bytesDoArquivo`), conferido antes da leitura | 20 MB | 7,3 MB |
| Parte descompactada (`bytesPorParte`) | 25 MB | 4,5 MB (`document.xml`) |
| Total das partes lidas (`bytesNoTotal`) | 60 MB | cerca de 6 MB |
| Razão de compressão, nas partes de mais de 10 MB (`razaoDeCompressao`) | 200:1 | cerca de 15:1 |
| Entradas no ZIP (`entradas`) | 10 mil | dezenas |
| Elementos por parte XML (`elementosPorParte`) | 500 mil | 104 mil |
| Níveis de aninhamento do XML (`profundidadeDoXml`) | 256 | dezenas |
| Células por linha de tabela (`celulasPorLinha`) | 1.024 | 63 (o máximo do Word) |
| Posições da grade de uma tabela (`posicoesPorTabela`) | 2 milhões | milhares |

| Orçamento de texto do documento (`packages/docx/src/orcamento.ts`) | Padrão | Maior valor nos PPCs reais |
|---|---:|---:|
| Caracteres no documento: texto das tabelas expandidas e Markdown gerado (`caracteresNoDocumento`) | 8 milhões | 398 mil |
| Caracteres num parágrafo, título ou célula (`caracteresPorBloco`) | 50 mil | 3,3 mil |
| Caracteres seguidos sem letra nem dígito: espaços, tabulações, pontuação (`sequenciaSemTexto`) | 1.000 | 27 |

O arquivo acima de 20 MB sai com a orientação de compactar as imagens no Word (Arquivo › Compactar imagens). As partes do ZIP são descompactadas sob demanda, em pedaços, e os limites de tamanho e de razão valem para o que de fato saiu, não para o tamanho declarado; o que a conversão não lê (fontes, imagens, `customXml`) não é descompactado. `gridSpan` e `gridBefore` ficam presos à faixa do Word (até 63 colunas).

O orçamento de texto é por documento porque os limites por item não fecham a conta: sessenta tabelas logo abaixo do teto por tabela (num ZIP de 18 KB) custavam dois minutos. Ele é conferido logo depois da leitura, antes de qualquer trabalho proporcional ao texto. O teto de sequência sem letra nem dígito existe por causa das expressões regulares terminadas em `\s*$` ou em pontuação, que custam o quadrado de uma sequência dessas (80 mil tabulações num parágrafo, num ZIP de 3 KB, levavam 89 s); o aparo de espaços do `kb` deixou de usar expressão regular pelo mesmo motivo.

Entidades declaradas no XML não são expandidas nem buscadas, e uma relação que aponta para fora do pacote resolve dentro dele. No `PPC.md`, só endereços `http`, `https` e `mailto` viram link, com parênteses e espaços escapados no endereço e `]` e `\` no texto. A consolidação de parágrafos do normalizador é linear no tamanho do texto.

Pior caso honesto dentro dos limites (um `document.xml` de 14 a 25 MB com 486 mil elementos e texto variado): 1,5 s e cerca de 690 MB de memória residente no pico; converte com o heap limitado a 512 MB. Um PPC típico leva 0,1 a 0,3 s e cerca de 150 MB. A conversão é síncrona e a árvore do XML fica inteira na memória: quem a chama a partir de um servidor deve isolá-la num `Worker` com limite de memória e de tempo (veja o M1.11 em `docs/plans/app-simplifica-if.md`). Os tetos barram os casos conhecidos, não toda entrada patológica; o limite de tempo do `Worker` é a defesa final.

### Regras da conversão

- **Leitura.** Entram os runs de `w:ins`, `w:moveTo`, `w:smartTag`, `w:sdt` em linha, `w:fldSimple` e `w:customXml`, de modo que o texto inserido com o controle de alterações ligado aparece no `PPC.md`; o removido (`w:del`, `w:moveFrom`) fica de fora, inclusive a figura apagada e a linha de tabela removida na revisão. Entram também as linhas, as células e os parágrafos de tabela embrulhados em `w:sdt` (numa matriz, são componentes). Nas tabelas em `w:sdt` do Google Docs, a célula é lida como os parágrafos do corpo: com tabulações e quebras, sem o texto movido e sem a versão de compatibilidade das caixas de texto.
- **Títulos de corpo.** Texto de corpo digitado num parágrafo com estilo de título sai como parágrafo: frase de 200 caracteres ou mais, item com marcador ou, sem numeração de seção, texto terminado em ponto e vírgula ou frase de oito palavras ou mais terminada em ponto ou dois-pontos. Sem isso, cada frase abriria uma seção e a seção de verdade ficaria vazia (`## 5.9 ESTÁGIO CURRICULAR` seguido de cinco `## O curso não prevê estágio…`).
- **Listas.** A numeração automática do Word (`w:numPr`) faz itens de lista, com o nível. O número digitado fica (`2. texto`, não `1. texto`), e a alínea sai como `- a) texto`, não `1. a) texto`.
- **Negrito unido.** Runs seguidos de mesma formatação saem num marcador só, com os espaços das pontas fora dele: `**Pró-Reitoria de Ensino**`, não `**Pró-Reitoria** de Ensino**`.
- **Totais da matriz.** Na matriz dividida em várias tabelas, o total que nenhuma delas declara é recalculado sobre todas as partes (e não fica a soma da última: 160 h-a de um 2º ano no lugar das 400 do curso), e `resumo_matriz_curricular.total_ha` e `total_hr` são a soma dos componentes.
- **Seções no nível 2.** As seções começam em `##` (a seção "1" é `##`, a "1.1" é `###`), e `#` fica para o título do documento, como nos PPCs convertidos da base (`##` em todas as seções) e na segmentação de seções do `kb`, que só toma `##` em diante; com a seção de primeiro nível em `#`, a pré-conferência veria todas as seções do modelo "ausentes". O normalizador (`normalizarMarkdown`, também usado na entrada `.md`) segue a mesma convenção pela numeração; sem número, o título mantém o nível que tinha.
- **Representação gráfica.** A figura desenhada com formas do Word não é renderizada. O `_dados.json` traz `metodo: "vetorial_nao_renderizada"` (ou `"figura_nao_localizada"`, quando a seção não tem figura reconhecida) e o `PPC.md` recebe, depois do título da seção, um parágrafo `**Aviso da conversão:** …`. Um EMF ou WMF embutido é copiado como está (`metodo: "vetorial_arquivo_cru"`, com `arquivo_vetorial`), sem contar como imagem extraída. A imagem sai com a extensão dela.
- **Propriedades do documento.** Sem `docProps/core.xml` (exportação do Google Docs), `metadata_documento` fica vazio.
- **Robustez.** Mescla vertical malformada e imagem com relação externa não abortam. O prefixo de namespace do XML é livre, e o DOCX salvo como "Strict Open XML" é lido.
- **Referências do ementário.** A busca aproximada de locais usa a medida `partial_ratio` do `rapidfuzz`, reproduzida em `similaridade.ts`.
- O texto de uma tabela aninhada não entra na célula que a contém; o que vem antes do primeiro título (capa) fica fora do Markdown.

Limitações das listas automáticas:

- o número não é calculado: todo item numerado sai como `1.` (o Markdown numera na exibição), e a lista que no Word começa em 5 (`w:start`) ou usa letras ou romanos perde o rótulo;
- o nível (`w:ilvl`) vai para o Markdown bruto como recuo, mas o normalizador tira o recuo de toda linha: no `PPC.md`, o subitem fica no nível do item. Preservar o recuo muda a normalização também da entrada `.md`.

Um PPC típico leva de 0,1 a 0,3 s para converter (12 PPCs técnicos reais, medidos em 16/11/2026 num Mac com Apple Silicon).

Os documentos sintéticos (`packages/ppc/src/testes/documentos.ts`, sobre o construtor de `packages/docx/src/testes/sintetico.ts`) são OOXML mínimo escrito à mão: mesclas horizontal, vertical, em bloco e em L, linhas, células e tabelas em `w:sdt`, alterações controladas, tabulações e quebras, hyperlinks, figura PNG, JPEG, EMF, vetorial e apagada, listas automáticas e digitadas, texto de corpo com estilo de título e dois PPCs fictícios completos. Os gabaritos de `packages/ppc/test/fixtures/conversao-docx/` são os artefatos de cada um, que a conversão tem de reproduzir byte a byte (uma mudança deliberada na saída regrava o gabarito do documento afetado), e `partial-ratio-rapidfuzz.json` traz 992 escores do `rapidfuzz`; os testes dos dois pacotes conferem tudo, e `packages/docx/test/leitor.test.ts` cobre os arquivos hostis.

## Pré-conferência sem IA (fichas D)

A revisão de PPC no app (M1.11) começa por uma pré-conferência em código: as 12 fichas da revisão de PPC com `execucao.modo: "D"` são decididas por verificadores em `src/verificadores/`, com a base (CNCT, registro de normas e relações de revogação, fatos e seções do `kb`), sem IA e sem rede, em cerca de 30 ms por PPC.

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

**Prudência:** tudo o que depende de extração incerta (fatos `extraido`, classificação de títulos, citação de confiança menor) ou de vigência a confirmar (a Res. CNE/CP nº 2/2026, sem a publicação no DOU) sai `a_conferir`, nunca `nao_atende`; norma revogada com transição em curso também. Só a ficha responsável pelo marco normativo (`base-conhecimento/revisao-ppc/marcos-normativos.json`, copiado em `verificadores/vigencia.ts` e conferido em teste) eleva um fato do marco a `nao_atende`; as fichas de base legal registram. Uma regra só dá `nao_atende` com a precisão medida na base: a tabela, as regras de vigência e a amostra conferida à mão estão em [`PRECISAO.md`](PRECISAO.md); os números exatos são conferidos por `pre-conferencia.ts --base --check` (fora do `pnpm test`, porque dependem da base), e `test/precisao-base.test.ts` confere os invariantes.

**Registro:** `src/verificadores/registro.ts` é o mapa ficha → verificador que a etapa com IA consulta para saber o que o código já resolveu. O `node scripts/validar_base.ts` recusa ficha D sem verificador e verificador de ficha que não é D, e `test/verificadores.test.ts` exige, para cada verificador, um caso que atende e um com problema. Para criar um verificador: escreva-o em `src/verificadores/`, registre-o, mude a ficha para `D` (com a justificativa), acrescente os casos, meça na base, confira uma amostra e atualize `PRECISAO.md` e `scripts/precisao-base.json` (`--gravar`).

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

- **Curso:** `identificacao.ts` lê no Markdown a denominação e a forma de oferta, por rótulo (em linha, em título numerado seguido do valor, em tabela, em grade de opções marcada com X) e, sem rótulo, pela capa; casa a denominação com o CNCT pelo núcleo do nome (sem "técnico em" e os qualificadores de oferta), por igualdade ou, se não houver, pelo único curso muito parecido (`SequenceMatcher` ≥ 0,9 e folga de 0,05 sobre o segundo). Sem confiança, o curso fica sem CNCT. A forma é `integrado`, `subsequente`, `concomitante` ou `proeja` (o integrado da EJA, só quando um rótulo ou o nome do curso diz PROEJA: "cursos PROEJA" na apresentação do campus não conta). A pessoa pode escolher os dois (`cnct`, `forma`). Sem curso identificado, os critérios que dependem dele saem "a conferir". Nos 109 PPCs técnicos da base (`test/identificacao-medicao.test.ts`, que trava os números), o CNCT sai certo em 108 e sem curso em 1 (PDF escaneado), nenhum errado; a forma, certa nos 109. A busca anterior (a denominação mais longa do CNCT nas 200 primeiras linhas) errava o curso em 12 e a forma em 13.
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
- **`conferencia.ts`:** o contrato da resposta em Effect Schema (`ResultadoIa`: o da ficha reduzido a estado, confiança, justificativa, evidências, lacunas, o que fazer, fontes e revisão humana) e `conferirResposta`, por ficha: estados permitidos, trecho literal no PPC, fonte do contexto, ATENDE com trecho, `resumo` no J. `pedidoDeCorrecao` é a nova tentativa; `motivoLegivel`, o motivo de uma ficha "a conferir" para a pessoa.
- **`estrutura.ts`:** o que o código extrai pela estrutura para todo pedido: `quadroDeIdentificacao` (as seções dos tipos do quadro como "título: valor", mais os fatos do `kb`, e quais vieram inteiras), `matrizEmTsv` e `componentesDaMatriz`, `componentesDoEmentario` e `indiceDoEmentario`, `estruturaDoPpc` e `comumDoBloco` (o quadro sempre; a matriz, o índice do ementário e o começo das referências conforme as fichas do bloco). `recorteDaFicha` (em `plano.ts`) escolhe seções inteiras: título com peso 3, tópico +1, uma passada que cobre cada tipo de seção do tópico, o primeiro parágrafo de toda seção cortada; a nota de figura só em título de figura.
- **`gabarito.ts`:** a evidência esperada de cada ficha do modo rápido (padrões, seção-alvo, 60% dos componentes da matriz ou do ementário) e `avaliarRecorte`, para a medição sem IA (`apps/server/scripts/medir-recortes.ts`): de 45,9% a 92,0% nos 110 PPCs técnicos. Nas fichas de matriz e ementário, o gabarito usa o mesmo extrator do recorte.
- **`revisarDocx` com `ia`:** `OpcoesRevisaoPrevia.ia` (`EntradaIa`: os resultados conferidos e as fichas fora do modo) junta as pendências da IA às das fichas D, na mesma lista e no mesmo DOCX. NAO_ATENDE com confiança de 0,6 ou mais e sem revisão humana é pendência; o resto que não atende, INCONCLUSIVO e a ficha que falhou a conferência (`FALHOU`) saem "Confira:". Cada item tem `origem` (`codigo` ou `ia`), e o comentário da IA termina em "avaliação da IA conferida pelo app". O aviso do título diz quantos critérios o código e a IA conferiram e de quais temas são os que ficaram de fora.

Testes em `test/revisao-ia.test.ts` (o plano sobre as fichas reais, recortes, pedido com nonce, conferência e o DOCX com a IA).

A política de provider fica no servidor, em `apps/server/src/revisao-ppc/`: o modelo padrão por provider (`modelos.ts`) e a estimativa de tokens, minutos, US$ e fração da janela (`estimativa.ts`, com `estimarAcao` para as ações da conversa).

## Conversa por pendência e lista viva (M1.11, etapa 5b)

- **`revisao-ia/conversa.ts`:** `instrucoesConversa` (o PPC entre `<ppc-NONCE>` e o texto da pessoa entre `<motivo-NONCE>` são dado; qualquer marca do nonce dentro deles some), `prefixoConversa` (a ficha, o contexto normativo, o recorte e a pendência), `pedidoContestacao` e `pedidoSugestao` (o prefixo, os turnos anteriores em frases do app e a tarefa). `conferirContestacao` é a decisão do código: a pendência do código nunca sai; a da IA só sai com prova de leitura (um pedaço contínuo de 40+ caracteres na seção do critério, fora dos títulos, do trecho apontado e das linhas que pedem algo à revisão — `linhaDirigidaARevisao`, além da `dirigidoAIa` da triagem, aplicada à linha, ao par de linhas vizinhas e à própria evidência; `test/revisao-ia-conversa-base.test.ts` confere que nenhuma linha dos PPCs da base é marcada), com fonte só como ID exato entregue e nunca sozinha; fonte fora do contexto e trecho conferível inventado derrubam; trecho curto é neutro; NAO_APLICAVEL exige dispositivo entregue. `conferirSugestao` extrai da redação as normas (por extenso ou abreviadas, "Res.", "Resol."; `9.394/1996` ↔ `br/lei/1996/9394`), as siglas, os nomes próprios (inclusive de uma palavra depois de título ou lugar: "Profa. Maria", "campus de Ponta Grossa"), as datas inteiras e os números (por algarismos ou por extenso, conferidos **com a unidade**: "25%" não passa por "25 de setembro") e marca os que não estão no recorte, no contexto, no texto da pendência ou no vocabulário fixo da revisão; `[completar: …]` não é fato. Siglas e números por extenso podem escapar; a tela diz isso.
- **`revisao-previa.ts`:** `chavePendencia` (a ficha e um FNV-1a da origem, do trecho e do texto da pendência: `titulo`, `explicacao` e `faltas`, reunidos por `textoDaPendencia`) e `OpcoesRevisaoPrevia.situacoes`: a cópia comentada tira a pendência retirada depois de contestação, põe a situação no comentário das outras e conta tudo no aviso do título ("Situação marcada no app: …").

Testes em `test/revisao-ia-conversa.test.ts`.

