# M1.11 — "Analisar um PPC" no app: proposta C (código primeiro, o DOCX da pessoa de volta com comentários)

> **Registro (16/11/2026).** A síntese da seção 9 foi aprovada e está no plano (`docs/plans/app-simplifica-if.md`, M1.11). `comentarios.ts` e `pre-conferencia.ts` entraram em `main`. O contorno do achado de integração (seção 5) foi retirado: a conversão DOCX passou a escrever as seções em `##`, como os PPCs da base. Na etapa 2 (16/11/2026), a classificação do anexo virou o campo `execucao` das fichas, sem mudança, e a PoC virou os 12 verificadores D de `packages/ppc/src/verificadores/`; os números da seção 2 são os da PoC, e os atuais, com a amostra conferida à mão, estão em `packages/ppc/PRECISAO.md`. O script `pre-conferencia-poc.ts` virou `pre-conferencia.ts`, que lê a base dos arquivos, sem o `tmp/kb.sqlite`. Na etapa 3 (16/11/2026), a entrega da seção 9 chegou ao app sem IA: `revisarDocx` (`packages/ppc/src/revisao-previa.ts`) num `Worker` do servidor, com a base do `kb.sqlite`, e a cópia comentada ao lado do original; as marcas do comentário passaram a ficar por fora de `w:ins` e de links.

Proposta de desenho, 16/11/2026. É a terceira de três (A, B, C). O ponto de partida era repensar o produto e a divisão entre código e IA. A e B mandam todas as fichas para a IA; esta proposta pergunta quanto da revisão a base já decide sem IA, e o que a pessoa deveria levar embora.

**Em uma frase:** a revisão começa por uma pré-conferência em código (19 ms por PPC, sem cota, sem IA) que já cobre o que mais faz a PROENS devolver PPC. A IA entra só onde há julgamento, com recortes curtos. O resultado volta **no próprio DOCX da pessoa, com comentários do Word ancorados nos trechos**.

A prova de conceito confirmou as duas partes arriscadas, ambas em TypeScript e testadas:

- **Comentários do Word ancorados no arquivo original** (`packages/docx/src/comentarios.ts`). O código insere marcas no `document.xml` por posição e não regrava o resto do arquivo. Divide runs quando o trecho começa no meio de um, atravessa negrito e hiperlink, ancora dentro de célula de tabela e soma comentários a um arquivo já comentado. Trecho que não está no arquivo não é ancorado em lugar errado.
- **Sete fichas e a triagem em código** (`packages/ppc/src/pre-conferencia.ts`), rodadas nos 110 PPCs técnicos da base em 2,1 s. Num PPC sintético em DOCX, todos os 7 achados viraram comentários ancorados (ensaio ponta a ponta: DOCX → conversão → pré-conferência → DOCX comentado).

## 1. O problema, visto da pessoa

Quem usa é a coordenação de curso, a pedagogia, a PROENS ou o DENS. O PPC vive num `.docx`: é nele que a comissão escreve, que circula por e-mail e pelo SEI e que a PROENS lê. Mesmo com um bom relatório da revisão, a pessoa ainda precisa:

1. **achar no Word o trecho de cada apontamento.** Um relatório HTML ou uma lista em outra janela obriga a ir e voltar entre duas telas e a procurar o texto, o que custa tempo e gera erro;
2. **repassar à comissão.** O jeito natural de pedir "ajuste isto" a um colega é um comentário no Word. Os comentários do relatório viram tarefas de quem edita aquela seção;
3. **revisar de novo.** O PPC volta da comissão com mudanças e é revisado outra vez, às vezes três ou quatro vezes antes de ir à PROENS. Uma revisão de US$ 2 a 7 e 5 a 60 minutos a cada volta pesa na cota de uma assinatura comum;
4. **confiar no que é fato e discutir só o que é opinião.** "A Res. CNE/CEB nº 6/2012 está revogada" não precisa de IA nem de discussão. "O perfil do egresso não dialoga com a matriz" precisa, e é aí que a pessoa quer gastar a atenção.

Os 21 pareceres "não conclusivos" contados por B mostram onde está a devolução: Identificação (9 de 21), Matriz (9), Estrutura curricular (8), Representação gráfica (5), Ementário e referências, Fundamentos legais. Boa parte disso é conferência de fato: denominação, eixo e carga horária contra o CNCT, norma revogada, seção ausente, AEE na matriz. **O que mais devolve PPC é, em boa parte, o que menos precisa de IA.**

## 2. A classificação das fichas

**São 80 fichas, não 81**: `base-analise/fichas/` tem 81 arquivos, mas um é o `README.md` (`indice.json`: `total_fichas: 80`).

### Critério

Cada ficha foi lida pela `pergunta`, pela `rubrica` e pelas `referencias_normativas`, e classificada pelo **modo de decisão do caso típico de não conformidade**:

| Classe | Critério | O que a IA recebe |
|---|---|---|
| **D: determinística** | O código decide com a base (CNCT, registro de normas e vigência, `fatos_ppc`, segmentação de seções, padrões de texto) e aponta o trecho. Nuance que a regra não cobre vira "a conferir" para a pessoa, nunca para a IA. | Nada |
| **S: semiautomática** | O código decide se a ficha se aplica, localiza o trecho e extrai os valores (tabela da matriz, presença de termos e seções, contagens). Sobra uma pergunta curta sobre um trecho curto ("este texto descreve critérios de aproveitamento?"). | 1 a 3 mil caracteres por ficha, em lote por seção |
| **J: julgamento** | Coerência, suficiência ou clareza de texto corrido, ou relação entre partes do PPC. | As seções relevantes, como em B |

### Números

| | D | S | J | Total |
|---|---|---|---|---|
| Fichas | **12** (15%) | **38** (48%) | **30** (37%) | 80 |
| BLOQ (11) | 2 (CT-CURR-02, CT-CURR-22) | 3 (CT-CURR-01, 03, 05) | 6 (CT-CURR-04, CT-TRANS-01 a 05) | 11 |
| Condicionais (9; a aplicabilidade o código decide em todas) | 0 | 6 | 3 | 9 |

Em resumo: **63% das fichas (50 de 80) dispensam a leitura do PPC pela IA**. Em 12 delas a IA não entra. Em 38 ela confirma um recorte que o código já achou. Só 30 pedem julgamento, e 8 dessas são transversais: CT-TRANS-05 e 06 são síntese, e as outras leem resumos (a mesma correção que A e B propõem).

A classificação é conservadora. Duas fichas que pareciam D desceram para S depois da leitura da rubrica: CT-IDENT-19 pede que se evite "promessa automática indevida" de registro, e CT-SUP-02 pede "critérios e procedimentos" de recuperação. Uma terceira continua D, mas mudou de estado depois da medição: em CT-IDENT-13 (eixo), a divergência passou a sair como "a conferir", porque 5 de 7 divergências na base eram abreviação ou texto colado pela conversão. O anexo traz a tabela das 80.

### O que a PoC mediu na base (110 PPCs técnicos, 19 ms por PPC)

| Ficha (D) | Regra | Achados | Precisão observada |
|---|---|---|---|
| CT-SUP-12 / CT-IDENT-08 | norma citada com `status_vigencia: revogada` no registro | 440 pendências em 107 PPCs (Res. CONSUP 54/2011 em 95, CNE/CEB 6/2012 em 82, CNE/CP 1/2021 em 41, CNE/CEB 3/2018 em 32) | alta para "está revogada"; a pessoa decide se a citação é histórica ou fundamento |
| CT-SUP-21 | nenhuma lei da legislação profissional do CNCT citada | 50 PPCs | a primeira versão (uma pendência por lei) gerava 280; agregada por curso, sai uma por PPC |
| CT-CURR-22 | AEE numa linha de tabela da matriz ou do quadro de componentes | 9 linhas em 4 PPCs | os 2 casos abertos eram verdadeiros ("Componente curricular variável: AEE"; "AEE \| *") |
| CT-CURR-02 | CH total contra o mínimo do CNCT e o da forma (3.000 h no integrado) | 28 "a conferir": 13 sem CH achada, 2 integrados com 2.400 h, os demais com valores divergentes no texto | é extração (`extraido`), por isso fica "a conferir" |
| CT-IDENT-01 | denominação no início do PPC contra o CNCT | 0 depois de corrigir maiúsculas (a 1ª versão errava "TÉCNICO EM SOLDAGEM") | — |
| CT-IDENT-13 | eixo declarado contra o CNCT | 26 "a conferir" (19 sem eixo declarado) | baixa como pendência; correta como "a conferir" |
| Triagem: seções do modelo | 13 tipos esperados da taxonomia `tecnico` | 78 PPCs com ao menos uma ausente (o mais comum: acompanhamento de egressos, ausente em 75 de 110) | depende da classificação de títulos do `kb` |
| Triagem: texto dirigido à IA | frases típicas de injeção | 0 na base; achado no PPC sintético | — |

A base é de PPCs vigentes escritos antes da Res. CNE/CP nº 2/2026. É de esperar que quase todos citem norma revogada, e é exatamente isso que a atualização tem de corrigir.

## 3. O que a pessoa leva embora

| Formato | Para quê | Veredito |
|---|---|---|
| **O próprio DOCX com comentários do Word** | editar ali mesmo; repassar à comissão; abre no Word, no LibreOffice e no Google Docs (que importa os comentários) | **Principal.** É o formato em que a pessoa já trabalha. O comentário fica no trecho exato, assinado "Simplifica IF (revisão prévia)", com a fonte e o aviso de que não é parecer |
| **Lista de pendências na ordem do parecer da PROENS** (a de B) | levar à comissão; registrar o que foi resolvido e as discordâncias; mostrar a cobertura ("conferidos 80 de 80") | **Junto do DOCX.** É o estado no app e o resumo exportável |
| **Pré-conferência de 1 minuto** | primeira resposta sem cota; confere se o CNCT identificado é o certo; acha texto dirigido à IA e documento digitalizado | **É a porta de entrada.** Para muitos PPCs em atualização, já traz metade do que a PROENS devolveria |
| **Exemplos de PPCs semelhantes** (`kb buscar-secoes`, sem IA) | ver como outro campus redigiu acompanhamento de egressos ou a seção de registro profissional | **Barato e útil nas pendências J e S de seção ausente**, com o rótulo "exemplo institucional, não norma" |
| **Correções como controle de alterações** (`w:ins`/`w:del`) | aceitar com um clique | **Depois, e só para D.** Uma troca mecânica (denominação do CNCT, nome do eixo) cabe. Trocar norma revogada não cabe: depende das regras de transição, e a tabela 1/2021 → 2/2026 é rascunho. Texto de IA como alteração no documento oficial convida a "aceitar tudo" sem ler. Por enquanto, a sugestão de redação vai dentro do comentário |
| **PPC HTML anotado** (o gerador atual da skill) | leitura lado a lado, auditoria | Opcional ("Ver no navegador"). Deixa de ser o produto principal |

O DOCX comentado é melhor por três motivos. Não pede um hábito novo. Leva a revisão ao lugar em que o trabalho acontece. E torna barata a **segunda volta**: quando o PPC volta da comissão, a pré-conferência roda de novo em segundos e a IA só revisa os temas cujas seções mudaram (hash por seção). A lista mostra "resolvidas / novas / ainda abertas".

## 4. O fluxo da tela

```
┌ Analisar um PPC ─────────────────────────────────────────────────────────┐
│ [PPC Agropecuária 2026.docx ✓]                                           │
│ Técnico em Agropecuária · Campus X · Integrado · CNCT ✓      [Não é este] │
└──────────────────────────────────────────────────────────────────────────┘

 Pré-conferência (sem IA, 3 s): 4 pendências · 3 a conferir
  ● Texto dirigido a um sistema de IA (§2): remova antes de submeter     [ver]
  ● Cita a Res. CNE/CEB nº 6/2012, revogada                [ver] [norma ↗]
  ● O AEE aparece como linha da matriz                     [ver] [NT ↗]
  ● Nenhuma lei da legislação profissional do CNCT citada  [ver] [CNCT ↗]
  ◐ CH total 2.400 h; o mínimo do integrado é 3.000 h      [ver] a conferir
  ◐ Eixo declarado difere do CNCT                          [ver] a conferir
  ◐ Seções não encontradas: Ementário; Acompanhamento de egressos…
                                                                      
  [⬇ Baixar o DOCX com estes comentários]      ← já é útil, e sem cota

 Aprofundar com a IA da sua conta (Claude):
  (●) O que mais devolve PPC   ~5 min · ~1/5 de uma janela do plano
  ( ) Todos os 80 critérios    ~12 min · ~1/2 janela
                                                         [Aprofundar →]
```

Durante o aprofundamento, a lista cresce por tema, na ordem do parecer. A pessoa lê enquanto a IA trabalha, sem espera depois do primeiro tema. Cada item tem: o trecho (clicável), o porquê, a fonte (`ifpr://`), a classe ("conferido pela base" ou "avaliação da IA") e os botões **Vou ajustar · Já está certo… · Ver exemplos**. "Já está certo…" pede um motivo. A IA pode reavaliar (a conversa de B, opcional), mas uma pendência D só sai diante de um fato verificável: o código é a autoridade nela.

No fim, **Levar embora**: o DOCX comentado (principal), a lista em DOCX ou PDF e o HTML anotado. Na volta da comissão, a pessoa solta o arquivo novo, e o app mostra "7 resolvidas · 2 novas · 3 ainda abertas", sem gastar cota no que não mudou.

## 5. Arquitetura

```
DOCX ──► Worker: conversão (packages/ppc, já existe) ──► PPC.md + seções + matriz + ementário
          │
          ├─► pré-conferência D (packages/ppc/pre-conferencia → futuro packages/revisao)
          │     usa o kb em processo: registro e vigência, CNCT, fatos, segmentação
          │
          ├─► preparo S: o código acha o trecho e decide a aplicabilidade
          │     └─► motor, sessões sem ferramentas: lotes por seção, trechos curtos, JSON
          │
          ├─► J: uma sessão por tema (as paradas de B), só as seções do tema, JSON
          │     └─► transversais sobre os resumos dos temas
          │
          ├─► conferência em código do JSON da IA (Effect Schema): ficha da lista, estado
          │     permitido, trecho LITERAL presente no PPC (senão o item vai sem âncora),
          │     fonte que existe no registro
          │
          └─► saída: comentarDocx(bytes originais, pendências) + lista + HTML opcional
```

- **A classificação vira dado.** Cada ficha canônica ganha um bloco `execucao: { modo: "codigo" | "confirmacao" | "julgamento", verificador?: "<id da regra>", secoes: [tipos] }`, validado pelo `revisar_ppc.ts validar-base`. Mudar uma ficha de J para S passa a ser uma edição versionada, e a cobertura ("12 em código, 38 confirmadas, 30 avaliadas") sai do próprio dado.
- **Os verificadores ficam em TypeScript puro**, sobre funções que o `kb` já tem e que a PoC usou sem mudança: `extrairFatosPpc`, `extrairCitacoes`, `segmentarPpc`, `Registro`. Rodam no servidor do app, que já carrega a base para o MCP `ifpr`. Funcionam com os três providers, sem Python e sem rede.
- **Injeção de prompt.** A triagem acha o texto dirigido à IA e o retira dos recortes. A IA nunca vê o PPC inteiro. Recebe recortes como dados, sem ferramentas, e não pode mudar o resultado de uma ficha D. Todo trecho que ela cita é conferido no texto literal. Um PPC que "convença" a IA de que tudo atende ainda sai com as pendências D. O comentário no DOCX é texto escapado (o teste injeta `<w:p>` e caracteres de controle).
- **O DOCX gravado.** As marcas são inseridas por posição e o resto do `document.xml` fica como estava. O pacote passa pelos mesmos limites da leitura (`PacoteOoxml`). O que a PoC ainda não trata (documento em UTF-16, prefixo `w:` não convencional, trecho que atravessa parágrafos) é recusado ou volta como "não ancorado", nunca gravado errado.

### Achado de integração (da PoC)

O `segmentarPpc` do `kb` só toma `##` em diante como seção (nos PPCs da base, `#` é o título do documento). A conversão DOCX em TypeScript escreve as seções como `#`. Sem ajuste, todas as seções saíam "ausentes". A pré-conferência agora rebaixa `#` para `##` antes de segmentar, preservando as linhas. A correção certa é escolher **uma** convenção entre `packages/ppc` e o `kb`. Isso vale para A e B também, que segmentam o PPC convertido.

## 6. Custo por provider

**Método.** A unidade é a medida de B: uma abertura de 7 fichas sobre cerca de 22,6 mil caracteres custou US$ 0,12 equivalentes no Claude Sonnet, em 38 s. D custa zero. S vai em lotes de cerca de 6 a 8 fichas sobre 8 a 12 mil caracteres de recortes, perto de metade de uma abertura de B. J vai em cerca de 6 temas, com as seções inteiras do tema (como as paradas de B, de 1 a 2,5 aberturas cada). As transversais leem os resumos. **Isto é estimativa.** Não rodei IA nesta proposta, para poupar a cota (o limite de taxa interrompeu uma tentativa anterior). A medição de B vale como unidade porque o formato da chamada é o mesmo.

| | Pré-conferência | "O que mais devolve" | Todos os 80 critérios | B completo | A (hoje / meta) |
|---|---|---|---|---|---|
| Fichas na IA | 0 | ~25 (BLOQ + temas de Identificação, Matriz, Ementário, Fundamentos) | 68 (38 S + 30 J) | 80 | 80 |
| Entrada nova (tokens) | 0 | ~60 a 90 mil | ~180 a 260 mil | ~350 a 450 mil | ~1,4 M / 0,6 M |
| Saída | 0 | ~15 mil | ~40 a 55 mil | ~60 a 100 mil | ~120 mil |
| Claude Sonnet, US$ equivalentes | 0 | **~US$ 0,4 a 0,6** | **~US$ 1,1 a 1,6** | US$ 2,0 a 2,8 | US$ 7 / 4 |
| Espera da pessoa | 2 a 5 s | ~40 s até o 1º tema | idem, com a lista crescendo | idem | 4 a 6 min |
| Segunda volta (PPC revisado) | 0, em segundos | só os temas cujas seções mudaram (tipicamente 20 a 40%) | idem | tudo de novo | tudo de novo |

Por provider: o custo em tokens é o mesmo. Muda o tempo e a forma da cota.

| Provider | Lote S (curto) | Tema J | Observação |
|---|---|---|---|
| Claude | 10 a 20 s (estimado da unidade medida) | 30 a 60 s | `tools: []` evita os ~10 mil tokens de sistema por sessão (medido em B); cache entre lotes do mesmo PPC |
| Codex | 5 a 20 s | 20 a 50 s | cota por mensagens ou janelas: os lotes S, curtos e numerosos, devem ir juntos (6 a 8 fichas por turno) para não gastar mensagens |
| Antigravity | 30 a 60 s | 60 a 120 s | o mais lento; a lista que cresce esconde a espera; a pré-conferência é igual nos três |

**Para a pessoa:** num plano básico, a pré-conferência é ilimitada. "O que mais devolve" custa o equivalente a duas ou três conversas longas, e o completo, de cinco a oito. Cabem de 4 a 6 revisões completas por janela (contra 2 a 3 em B e 1 a 2 em A). A segunda volta custa uma fração disso.

## 7. Riscos

1. **Falso positivo do código, apresentado como fato.** É o maior risco desta proposta: uma pendência D errada pesa mais que um palpite da IA, porque se apresenta como fato. Mitigação: estado "a conferir" para toda regra sobre extração; precisão medida por regra na base antes de promovê-la a "pendência" (a PoC fez isso e rebaixou CT-IDENT-13); suíte de regressão com os 110 PPCs e alguns gabaritos anotados à mão; o rótulo "conferido pela base" com o trecho e a fonte, para a pessoa ver o motivo.
2. **Âncora errada ou ausente no DOCX.** O trecho tem de ser literal e caber num parágrafo. Mitigação: a IA devolve trechos copiados, conferidos no texto; sem âncora, o item vai para a lista e para um comentário-resumo no início. Falta validar no Word real, no LibreOffice e no Google Docs (a PoC validou a estrutura OOXML, a releitura pelo leitor do projeto e a abertura pelo `textutil` do macOS, que lê o texto mas não mostra comentários).
3. **Drift entre a regra e a ficha.** A rubrica muda e o verificador não acompanha. Mitigação: `execucao.verificador` aponta a regra, e o `validar-base` exige teste para cada verificador citado.
4. **"Já que o código achou pouco, está bom."** Uma pré-conferência limpa não é um PPC aprovado. A tela diz "conferidos 12 de 80 critérios" até o aprofundamento.
5. **Vigência a confirmar.** "Revogada" depende da `data_referencia` e da publicação da Res. CNE/CP nº 2/2026 no DOU. O texto do comentário diz "confira as regras de transição" e não "substitua".

## 8. O que fica para depois

- Controle de alterações para correções D mecânicas, com aceite por item.
- Comentários com resposta (`commentsExtended`, `w15:paraIdParent`), para a discordância da pessoa voltar ao app pelo próprio DOCX.
- Trecho que atravessa parágrafos (âncora do primeiro ao último) e documento em UTF-16 ou com prefixo incomum.
- Verificadores das 38 fichas S em código (a PoC fez 7 D), começando pelas que leem a matriz: CT-CURR-01, 03, 18, 23 e 27, sobre o `matriz` que a conversão já produz.
- Exportar a lista no formato "Elementos para análise de PPC" da pró-reitoria, com "Atende / Atende parcialmente / Não atende".
- Ancorar no DOCX o que vem do PDF: hoje só o DOCX recebe comentários, e o PDF recebe a lista.

## 9. Comparação com A e B, e a recomendação de síntese

| | A (orquestrada) | B (roteiro conversacional) | C (código primeiro, DOCX comentado) |
|---|---|---|---|
| O que decide a ficha | IA, todas | IA, todas, por parada; triagem sem IA antes | código em 12; IA confirma recortes em 38; IA julga 30 |
| Primeira resposta | 4 a 6 min | <10 s (triagem) + 40 s | 2 a 5 s, já exportável |
| Cota (completo) | US$ 4 a 7 | US$ 2 a 2,8 | US$ 1,1 a 1,6; segunda volta incremental |
| Interação | relatório | conversa por parada | lista + comentários no Word; conversa opcional |
| Entrega | PPC anotado (HTML) | lista na ordem do parecer | DOCX da pessoa com comentários + a lista |
| Ponto forte | simples de operar, cobertura total | foco no que devolve; discordância registrada | fato separado de opinião; custo; formato de trabalho |
| Ponto fraco | custo, espera, grupo transversal não cabe | 45 a 60 min de atenção no completo | precisão das regras a manter; âncora literal |

**O que eu faria, combinando as três:**

1. **A porta de entrada é a pré-conferência de C** (sem IA, segundos, exportável no DOCX). Ela já absorve a triagem de B e passa a responder por 12 fichas inteiras.
2. **A ordem e o vocabulário são os de B**: temas na ordem do parecer da PROENS, modo "o que mais devolve" e modo completo, lista de pendências com resolvidas e discordâncias, exportada no formato do parecer.
3. **A execução é a de A, mais fina**: o servidor orquestra, sessões curtas sem ferramentas, de 3 em 3 em paralelo, conferência do JSON em código. O que muda é o recorte. S vai em lotes de trechos, J vai por tema com as seções do tema, e as transversais leem resumos (A e B já convergem aqui).
4. **A conversa de B é opcional, dentro de cada pendência** ("Já está certo…", "Sugerir texto"), e não é o fluxo principal. Ela reaproveita o cache da sessão do tema.
5. **A entrega é o DOCX comentado de C**, com a lista de B ao lado e o HTML de hoje como visão opcional.
6. **A classificação vira dado nas fichas** (`execucao`), para que mover uma ficha de J para S ou D seja uma edição versionada, com a precisão medida na base.

Em ordem de construção: (a) unificar a convenção de títulos entre `packages/ppc` e `kb`; (b) `execucao` nas fichas, com os 7 verificadores da PoC; (c) `comentarDocx` no servidor e o botão "Baixar o DOCX com estes comentários". Com isso, a pré-conferência já vai para os usuários **sem nenhuma chamada de IA**. Só então entram (d) os lotes S e os temas J no motor, e (e) a conversa por pendência.

## Anexo: classificação das 80 fichas

D = determinística, S = semiautomática, J = julgamento. Entre parênteses, o que o código usa ou o que sobra para a IA.

| Ficha | Crit. | Classe | Base da decisão |
|---|---|---|---|
| CT-CURR-01 | BLOQ | S | tabela da matriz convertida (componentes, períodos, CH); a IA só olha se a matriz não for reconhecida |
| CT-CURR-02 | BLOQ | D | `fatos_ppc` + CNCT + mínimo da forma (Res. 2/2026, art. 29); divergência interna "a conferir" |
| CT-CURR-03 | BLOQ | S | somas por núcleo na matriz; a IA confirma o rótulo dos núcleos |
| CT-CURR-04 | BLOQ | J | componentes × perfil |
| CT-CURR-05 | BLOQ | S | cada componente da matriz tem ementa (pareamento de nomes); suficiência por amostra |
| CT-CURR-06 | OBRIG | S | contagem de básica/complementar por componente no ementário |
| CT-CURR-07 | OBRIG | J | progressão formativa |
| CT-CURR-08 | OBRIG | J | metodologias |
| CT-CURR-09 | OBRIG | J | inclusão no currículo |
| CT-CURR-10 | OBRIG | S | presença da representação gráfica (a conversão a detecta); a coerência fica com a pessoa (imagem) |
| CT-CURR-11 | REC | S | termos dos temas transversais legais nas ementas |
| CT-CURR-12 | OBRIG | J | progressão explicitada |
| CT-CURR-13 | OBRIG | S | seção `aproveitamento_estudos`; a IA confirma critérios e procedimento no trecho |
| CT-CURR-14 | OBRIG | J | aplicabilidade em código (PFI/TCC na matriz); caracterização é julgamento |
| CT-CURR-15 | REC | S | aplicabilidade e trecho de certificação de conhecimentos |
| CT-CURR-16 | OBRIG | D | requisito de ingresso pela forma (fundamental/médio completo) e pelo CNCT, por padrão no trecho |
| CT-CURR-17 | REC | S | itinerários do CNCT × termos do PPC |
| CT-CURR-18 | OBRIG | D | componentes obrigatórios da FGB × nomes na matriz (integrado) |
| CT-CURR-19 | OBRIG | J | integração teoria-prática |
| CT-CURR-20 | OBRIG | S | `estagio_obrigatorio`/`estagio_carga_h` + CNCT e legislação profissional; a IA confirma o requisito de aprovação |
| CT-CURR-21 | OBRIG | S | aplicabilidade (estágio) + termos (convênio, termo de compromisso, seguro) |
| CT-CURR-22 | BLOQ | D | AEE como linha de tabela na matriz, no ementário ou na organização curricular |
| CT-CURR-23 | OBRIG | S | CH semanal da matriz × turno; a IA confirma o contraturno no trecho |
| CT-CURR-24 | OBRIG | J | organização pedagógica do estágio |
| CT-CURR-25 | OBRIG | J | campos de estágio × perfil |
| CT-CURR-26 | OBRIG | S | termos de educação política e cidadania nas ementas (integrado) |
| CT-CURR-27 | OBRIG | S | formato declarado e CH não presencial da matriz × limites das DCN |
| CT-IDENT-01 | OBRIG | D | denominação × CNCT |
| CT-IDENT-02 | OBRIG | S | campus, forma, CH, duração e prazo em vários pontos × dados institucionais |
| CT-IDENT-03 | OBRIG | J | justificativa territorial |
| CT-IDENT-04 | OBRIG | J | objetivos |
| CT-IDENT-05 | OBRIG | J | concepção de EPT |
| CT-IDENT-06 | OBRIG | J | formação integral |
| CT-IDENT-07 | OBRIG | J | perfil do egresso |
| CT-IDENT-08 | OBRIG | D | normas revogadas nas seções de identidade (registro + vigência) |
| CT-IDENT-09 | REC | S | modalidade declarada × menções a EaD/AVA |
| CT-IDENT-10 | OBRIG | J | competências × perfil do CNCT |
| CT-IDENT-11 | OBRIG | S | campo de atuação do CNCT × termos do PPC; a IA confirma equivalências |
| CT-IDENT-12 | OBRIG | J | clareza do perfil |
| CT-IDENT-13 | OBRIG | D | eixo × CNCT (divergência "a conferir", ver §2) |
| CT-IDENT-14 | OBRIG | S | códigos e ocupações CBO do CNCT no PPC |
| CT-IDENT-15 | OBRIG | S | "Técnico em X" e eixo na seção de diplomas; a IA confirma certificado × diploma |
| CT-IDENT-16 | OBRIG | S | termos de processo seletivo, reserva de vagas, Res. 190/2024 |
| CT-IDENT-17 | OBRIG | S | citação da lei de cotas e alteração (registro); a IA confere a regra reproduzida |
| CT-IDENT-18 | OBRIG | S | seção `acompanhamento_egresso` (ausente em 75 de 110); a IA confirma responsáveis e instrumentos |
| CT-IDENT-19 | OBRIG | S | conselho do CNCT citado; a IA confere "promessa automática" de registro |
| CT-SUP-01 | OBRIG | S | norma de avaliação do IFPR citada + escala de conceitos |
| CT-SUP-02 | OBRIG | S | percentual de frequência + termos de recuperação/recomposição |
| CT-SUP-03 | OBRIG | S | trecho de assistência estudantil |
| CT-SUP-04 | OBRIG | S | trecho de AEE e acessibilidade na política de atendimento |
| CT-SUP-05 | OBRIG | J | corpo docente × oferta |
| CT-SUP-06 | OBRIG | S | coordenação, colegiado, NDE (termos e seção) |
| CT-SUP-07 | OBRIG | J | infraestrutura × proposta |
| CT-SUP-08 | OBRIG | S | seção `avaliacao_curso` + Res. CONSUP 64/2022; a IA confirma periodicidade e responsáveis |
| CT-SUP-09 | OBRIG | D | referências normativas revogadas |
| CT-SUP-10 | REC | S | NEABI, NAPNE, NUGEDIS e afins (termos) |
| CT-SUP-11 | REC | S | termos de acessibilidade física |
| CT-SUP-12 | OBRIG | D | normas revogadas citadas (medido: 440 em 107 PPCs) |
| CT-SUP-13 | OBRIG | S | padrões ABNT por expressão regular; a IA olha só as linhas fora do padrão |
| CT-SUP-14 | OBRIG | D | marcos institucionais, CNCT e legislação profissional entre as citações resolvidas |
| CT-SUP-15 | OBRIG | J | habilitação docente × componentes |
| CT-SUP-16 | OBRIG | S | contagem do quadro docente × CH da matriz |
| CT-SUP-17 | OBRIG | J | formação pedagógica |
| CT-SUP-18 | OBRIG | S | instâncias e normas de inclusão (termos + registro) |
| CT-SUP-19 | OBRIG | J | AEE: procedimentos e público |
| CT-SUP-20 | OBRIG | J | recursos de acessibilidade e permanência |
| CT-SUP-21 | OBRIG | D | legislação profissional do CNCT × citações (medido: 50 PPCs sem nenhuma) |
| CT-SUP-22 | OBRIG | S | itens de infraestrutura mínima do CNCT × seção de infraestrutura; a IA confirma equivalências |
| CT-SUP-23 | OBRIG | S | "Manual de Competências", regime de trabalho, participação (termos) |
| CT-SUP-24 | OBRIG | D | Res. CONSUP 239/2025 citada × política anterior revogada |
| CT-SUP-25 | OBRIG | S | biblioteca: andar, piso, acessibilidade (termos) |
| CT-SUP-26 | OBRIG | S | progressão parcial e dependência × forma; a IA confirma a operacionalidade |
| CT-TRANS-01 a 05 | BLOQ | J | transversais; 05 é síntese |
| CT-TRANS-06 | REC | J | síntese da conclusão |
| CT-TRANS-07 | REC | J | vagas × infraestrutura |
| CT-TRANS-08 | OBRIG | J | coerência teórico-prática |

Somas: D = 12 (CT-CURR-02, 16, 18, 22; CT-IDENT-01, 08, 13; CT-SUP-09, 12, 14, 21, 24); S = 38; J = 30.

## Reproduzir a PoC

```bash
node packages/ppc/scripts/pre-conferencia.ts --base
node packages/ppc/scripts/pre-conferencia.ts --docx <PPC.docx> --cnct <slug> --forma integrado --saida <saida.docx>
pnpm --filter @simplifica-if/docx --filter @simplifica-if/ppc test
```
