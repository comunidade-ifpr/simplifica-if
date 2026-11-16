# M1.11 — "Analisar um PPC" no app: proposta B (roteiro conversacional com lista viva de pendências)

> **Registro (16/11/2026).** A síntese aprovada está no plano (`docs/plans/app-simplifica-if.md`, M1.11). A PoC desta proposta (`apps/server/src/revisao-ppc/parada.ts`, `apps/server/scripts/poc-revisao-ppc-conversa.ts` e os testes) ficou só na branch `refs/arquivo/m1-11-proposta-B`, como referência.

Proposta de desenho, 16/11/2026. Uma de três (A, B, C). O ponto de partida desta era a hipótese de que a pessoa e a IA percorrem o PPC juntas, tema a tema, em vez de receber um lote de dezenas de achados. A conclusão é que **a conversa pura não serve a quem tem prazo, mas um roteiro guiado serve**: a triagem sem IA vem primeiro, depois um roteiro de paradas ordenadas pelo que de fato faz a PROENS devolver PPC, e cada parada abre já com o resultado pronto. A conversa fica para onde a pessoa quer aprofundar: discordar, pedir uma redação, marcar como resolvido. O resultado é uma lista de pendências que a pessoa mantém, na mesma ordem do parecer da PROENS.

A prova de conceito mediu uma parada completa (abertura, uma réplica sem fundamento e um pedido de redação) no Claude: **71 s e US$ 0,22 equivalentes para 7 fichas e três turnos**. A réplica e a redação custaram metade da abertura somadas, porque reaproveitam o cache.

## 1. O problema, visto da pessoa

Quem usa: coordenação de curso, pedagogia, PROENS/DENS. A pessoa conhece o PPC e as normas pelo nome. O que ela quer, em ordem:

1. **"O que vai voltar da PROENS?"** Primeiro o que devolve; o resto depois, se der tempo.
2. **Corrigir, e não só saber.** Boa parte do que a PROENS pede é pequena e se resolve na hora: "Integrada (no feminino)", "substituir a Res. CNE/CEB nº 3/2018 (revogada) pela nº 2/2024", "acrescentar o perfil profissional do CNCT". Para isso ela precisa da redação, não só do apontamento.
3. **Poder discordar.** O apontamento pode estar errado, ou o curso pode ter uma razão. Ela quer registrar isso e seguir, sem brigar com a máquina.
4. **Levar algo para a comissão:** uma lista do que falta, do que ela resolveu e do que discordou, com a fonte de cada ponto.
5. **Não perder a tarde e não perder o trabalho:** parar no meio, voltar amanhã, ter o mesmo estado.

### O que a PROENS de fato devolve

Os 83 pareceres de curso arquivados (`dados/arquivo-notion/pareceres_curso/`) incluem 21 pareceres de revisão de PPC "não conclusivos", isto é, PPCs devolvidos com pedidos de ajuste. O parecer da DENTEC segue o roteiro "Elementos para análise de PPC", seção a seção, com "Atende / Atende parcialmente / Não atende". Contagem aproximada (heurística por título de seção com pedido de ajuste, uma vez por parecer):

| Seção do parecer | Pareceres que pediram ajuste (de 21) |
|---|---|
| Identificação | 9 |
| Matriz curricular | 9 |
| Estrutura curricular | 8 |
| Representação gráfica do processo formativo | 5 |
| Ementário e bibliografias / Referências | 4 + 3 / 4 |
| Ações de acesso e permanência do estudante | 4 |
| Fundamentos legais e normativos | 3 |
| Perfil do egresso / Área de atuação | 3 / 2 |
| Intervalo pedagógico, objetivo geral | 3 cada |

Duas conclusões guiam o desenho. Primeira: a devolução concentra-se em poucos temas, e o roteiro deve começar por eles. Segunda: a lista de pendências deve sair **na mesma ordem e com os mesmos rótulos do parecer da PROENS**. Assim, a pessoa reconhece o formato e a comissão compara os dois documentos lado a lado.

## 2. A abordagem: triagem, roteiro e conversa onde vale a pena

Testei a hipótese de partida contra quem tem prazo e a ajustei em três pontos:

- **A conversa livre não serve como fluxo principal.** Para uma coordenadora com o PPC vencendo na sexta, "vamos conversar sobre o seu PPC" é pior do que uma lista. Quem conduz é o **roteiro** (o servidor), não a IA, e a conversa é opcional dentro de cada parada.
- **A pessoa não deve esperar a IA a cada passo.** O servidor calcula a abertura das próximas paradas enquanto ela lê a atual (pré-busca). Ler uma parada leva de 2 a 4 minutos e calcular a próxima, uns 40 s, então quem lê não espera depois da primeira.
- **Toda ficha é conferida, mas nem toda ficha vira conversa.** Cada abertura avalia todas as fichas da parada e devolve o estado de cada uma. A pessoa vê no máximo cinco pontos por parada, e o que atende cabe numa linha.

O fluxo:

1. **Preparar (código, segundos, sem IA).** A conversão DOCX → PPC.md roda no Worker do M1.11, a mesma da proposta A. O servidor identifica curso, campus, forma e CNCT e segmenta o PPC por tipo de seção (os tipos do índice de seções que o `kb` já usa).
2. **Triagem (código, segundos, sem IA).** As conferências determinísticas que hoje estão espalhadas pelo `kb` viram pendências antes de qualquer token:
   - denominação, eixo e carga horária mínima contra o CNCT;
   - carga horária e estágio do PPC contra o SUAP (`fatos_ppc`, status `extraido`, mostrado como "a conferir");
   - normas citadas pelo PPC que estão revogadas ou foram substituídas (`resolver_citacoes`, `vigencia`, `correspondencia`; é o caso da Res. CNE/CEB nº 3/2018 que a PROENS mandou trocar);
   - seções do modelo de PPC ausentes (o tipo de seção não foi encontrado);
   - texto dirigido a uma IA ("ignore as instruções", "sistema de revisão", "registre como").

   A pessoa vê isso em menos de 10 segundos. Para muitos PPCs, já é a primeira lista útil.
3. **Roteiro de paradas (IA, uma sessão curta por parada).** São 12 paradas, ordenadas pela tabela acima e pela criticidade (as fichas `BLOQ` primeiro). Cada parada recebe só os tipos de seção que as fichas dela olham, o recorte do CNCT e os dispositivos citados. A abertura avalia todas as fichas e devolve texto para a pessoa mais um bloco `pendencias` em JSON, que o servidor confere sem IA e guarda.
4. **Conversa na parada (opcional, mesma sessão).** As respostas são botões que viram mensagens prontas: "Vou ajustar", "Já resolvi", "Discordo…", "Sugerir texto". Também há um campo livre. Cada resposta da IA traz o bloco de novo, com a situação de cada pendência (`aberta`, `mantida_com_discordancia`, `retirada`, `resolvida`).
5. **Coerência (IA, uma chamada no fim).** As fichas transversais (coerência entre objetivos, perfil e matriz e riscos globais) não leem o PPC inteiro, que não cabe na janela. Elas leem os resumos das paradas e as pendências, mais as seções de objetivos e perfil. É a mesma correção que a proposta A propõe.
6. **Levar embora (código).** A lista de pendências sai em DOCX ou PDF na ordem do parecer da PROENS, com a situação, o trecho, a fonte, a redação sugerida e as discordâncias registradas. O cabeçalho mostra a cobertura: "Conferidos 81 de 81 critérios", ou a lista dos que faltam. O PPC anotado (o gerador determinístico atual) fica como anexo opcional.

### Modo rápido e modo completo

| | Modo rápido ("tenho prazo") | Modo completo |
|---|---|---|
| O que roda | triagem + as 5 primeiras paradas (as seções da tabela; 6 das 11 fichas `BLOQ`) + uma parada curta com as outras 5 `BLOQ` (CT-CURR-22, de AEE, e as transversais CT-TRANS-01, 02, 04 e 05, sobre resumos) | triagem + 12 paradas + coerência |
| Fichas conferidas | ~55 de 81, todas as `BLOQ` | 81 |
| Tempo da pessoa | 15 a 25 min | 45 a 60 min, em uma ou mais sessões |
| Espera pela IA | ~40 s na primeira parada; depois, nenhuma (pré-busca) | idem |
| Saída | lista com "conferido: 55 de 81" e o que não foi visto | lista completa |

No fim do modo rápido, o botão "Conferir o resto sem conversar" roda as paradas restantes em segundo plano, com concorrência 3. Nesse caso B vira A para o que sobrou.

## 3. O fluxo da tela

Partida (o formulário do manifesto):

```
┌ Analisar um PPC ───────────────────────────────────────────────────┐
│ [PPC Enfermagem 2026.docx ✓]                                        │
│ Técnico em Enfermagem · Curitiba · Subsequente · CNCT ✓ [Não é este] │
│                                                                     │
│ Como você quer revisar?                                             │
│  (●) Rápido: o que mais faz a PROENS devolver PPC  ~20 min          │
│  ( ) Completo: todos os 81 critérios               ~50 min          │
│ O PPC vai para a IA da sua conta (Claude), não para mais ninguém.   │
│                                                         [Começar]   │
└─────────────────────────────────────────────────────────────────────┘
```

Em menos de 10 s, a triagem:

```
 Antes da IA, já encontramos 4 pontos:  (conferência automática; exemplo ilustrativo)
  ● Cita a Res. CNE/CEB 3/2018, revogada. Troque pela 2/2024. [ver] [Res. ↗]
  ● A carga horária de estágio difere do SUAP: 400 h × 360 h  [ver] a conferir
  ● Texto dirigido à IA na seção 4 — remova                   [ver]
  ● Não encontramos a "Representação gráfica do processo formativo"
                                    [Começar o roteiro →] (a parada 1 já está pronta)
```

Durante o roteiro, em três colunas. Num computador estreito, o roteiro vira abas.

```
┌ Roteiro ─────────┬ Parada 3 de 12 · Perfil do egresso e CNCT ─────┬ Pendências (9) ────┐
│ ✓ Identificação  │ Pontos que fariam a PROENS devolver:            │ Devolve (3)        │
│ ✓ Matriz         │ 1. O perfil descreve o Auxiliar, não o Técnico. │ ● Perfil = Auxiliar│
│ ◐ Perfil/CNCT    │    "exerce atividades de nível médio, de        │ ● Texto à IA (§4)  │
│ ○ Ementário      │    natureza repetitiva…"  [ver no PPC]          │ ● Matriz: CH semanal│
│ ○ Fundamentos    │    Fonte: [CNCT Técnico em Enfermagem]          │ Ajustar (5)        │
│ ○ Acesso/perm.   │    [Vou ajustar] [Já resolvi] [Discordo…]       │ Sugestão (1)       │
│ …                │    [Sugerir texto]                              │                    │
│                  │ 2. …                                            │ Resolvidas (2) ✓   │
│ Conferidos       │ O resto deste tema está em ordem: campos de     │ Discordâncias (1)  │
│ 25 de 81         │ atuação, título e eixo no diploma.              │                    │
│ ▓▓▓▓▓░░░░░░      │ ┌──────────────────────────────────────────┐   │ [Exportar lista]   │
│                  │ │ Pergunte ou responda…                     │   │                    │
│ [Pausar]         │ └──────────────────────────────────────────┘   │                    │
│                  │               [Próxima parada: Ementário →]     │                    │
└──────────────────┴─────────────────────────────────────────────────┴────────────────────┘
```

- **"Discordo…"** abre um campo curto: "Por quê? Um trecho do PPC ou uma norma ajudam." A IA reavalia. Ela só retira a pendência diante de um fato verificável; costume ou "a PROENS sempre aceitou" não bastam, e aí a pendência fica como discordância registrada. A decisão é da pessoa, e a lista mostra as duas posições. Toda discordância também volta, anonimizada, como sinal para calibrar a ficha (M1.12).
- **"Sugerir texto"** devolve uma redação pronta para colar. Ela usa só fatos do PPC e do contexto, e o que falta vem como `[completar: …]`. Antes de mostrar, o servidor passa as citações normativas da redação pelo `resolver_citacoes`. Citação que não resolve ganha um aviso.
- **"Ver no PPC"** abre o PPC (convertido) no trecho. A fonte abre o leitor `ifpr://` (M1.6).
- **Cota atingida no meio:** "Sua IA atingiu o limite de uso. As 4 paradas feitas e a lista estão guardadas. Você pode continuar a ler, marcar e exportar o que já tem. A próxima parada fica pronta quando a IA voltar (às 15:40)." Nada se perde, porque a lista é do servidor e não da conversa.
- **Voltar amanhã:** o roteiro, as pendências e as conversas de cada parada estão no `conversas.sqlite`. Reabrir uma parada abre uma sessão nova, semeada com as pendências dela (não com o histórico). Isso também limita o crescimento do contexto (seção 8).

## 4. Arquitetura

```
apps/web ──rpc──► apps/server
                   ├─ TarefaRevisaoPpc (Effect; estado por revisão, por parada e por pendência no sqlite)
                   │    preparar  ─► Worker(docx→PPC.md)         [packages/docx, packages/ppc]
                   │    triagem   ─► kb: CNCT, fatos, citações, vigência, seções, detector de injeção
                   │    roteiro   ─► paradas.json + seções por tipo + contexto     [packages/revisao-ppc]
                   │    parada    ─► Motor.iniciarSessao (sem MCP, pasta vazia, política "julgador")
                   │                  abertura → conferirBloco → lista viva
                   │                  réplicas (mesma sessão, cache) → conferirBloco → lista viva
                   │    pré-busca ─► até 2 aberturas adiante; "conferir o resto" com concorrência 3
                   │    coerência ─► 1 sessão sobre resumos + pendências
                   │    exportar  ─► DOCX/PDF na ordem do parecer; PPC anotado opcional
                   └─ Motor (Claude | Codex | Antigravity)
```

- **O servidor é dono do fluxo e da lista.** A IA não decide a próxima parada nem guarda estado. Ela recebe uma parada e responde em texto mais bloco. O `atualizarLista` da PoC funde cada bloco no que já se sabia: uma pendência que a IA esqueceu de repetir continua como estava, e só um bloco conferido muda a situação de uma pendência.
- **A sessão da parada não tem ferramentas nem MCP.** Valem a mesma política "julgador" e o `ferramentasNativas: false` da proposta A. O contexto normativo vai pronto, buscado pelo servidor. Se a pessoa quiser perguntar algo fora da parada ("e se fosse EaD?"), o botão "Perguntar à IA" abre uma conversa comum do app, com o MCP `ifpr`, semeada com a parada. Isso separa a conversa da revisão (sem ferramentas e com o PPC dentro) da conversa livre (com ferramentas e sem o PPC inteiro).
- **Conferência sem IA a cada turno** (`conferirBloco`): todas as fichas com estado permitido, fonte `ifpr://` dentro da lista da parada, trecho que existe no PPC. Pendência que falha na conferência aparece como "a conferir", não some.
- **Motor:** precisa do mesmo que A pede (política "julgador", sem ferramentas nativas, `cacheEscrita` no `UsoTokens`, já trazido para esta branch) e de uma coisa a mais: **sessões que duram minutos e várias mensagens**. O motor já suporta isso (é o caso da conversa), mas o servidor precisa encerrar a sessão da parada ao sair dela e reabri-la semeada ao voltar.
- **Pacote compartilhado com A.** As partes puras (`montarAbertura`, `separarResposta`, `conferirBloco`, a conferência de trechos) e os dados da skill ficam em `packages/revisao-ppc`. A abertura de uma parada é, na prática, o julgamento de grupo da proposta A, com o contexto recortado por tipo de seção e com texto para a pessoa. O executor em lote de A e o roteiro de B podem ser o mesmo código com dois modos.

## 5. Destino da skill e das fichas

- **Fichas, tópicos, validações cruzadas e marcos:** continuam canônicos, sem mudança de conteúdo, e vão para `packages/revisao-ppc/dados/`, como em A.
- **Novo: `paradas.json`** (o roteiro). Para cada parada: id, título no vocabulário do parecer da PROENS, a seção do roteiro "Elementos para análise de PPC" a que corresponde, as fichas, os tipos de seção do PPC que ela lê, o peso de devolução (da tabela da seção 1) e se entra no modo rápido. O `validar-base` confere que cada ficha está em exatamente uma parada. Esboço das 12 paradas: (1) identificação e oferta; (2) matriz e estrutura curricular, incluindo a representação gráfica e o intervalo; (3) perfil do egresso e CNCT; (4) ementário e referências; (5) fundamentos legais e normativos; (6) acesso, permanência, AEE e inclusão; (7) estágio, aproveitamento e TFC; (8) justificativa, objetivos, concepção e metodologias; (9) avaliação da aprendizagem e do curso; (10) corpo docente, gestão e infraestrutura; (11) temas transversais; (12) coerência (as fichas transversais).
- **Prompts:** `prompts/parada.md` substitui o `subagent-lote-fichas.md` no app (a versão da PoC está em `instrucoesParada`). O de síntese vira o de coerência.
- **Manifesto `simplifica:`:** `executor: servidor`, como em A, mais `modos: [rapido, completo]`, e as `etapas` passam a ser as paradas.
- **No repositório**, a skill continua para curadores. O subcomando de A (`julgar`) ganha `--roteiro`, que roda as aberturas das paradas sem conversa, útil para avaliar e calibrar.
- **`pacote_contexto` e `etapa` no MCP:** continuam para as conversas livres. O roteiro não depende deles.

## 6. Prova de conceito (feita)

**O ponto mais arriscado de B**, além do que A já provou (JSON válido sem conversa, trechos reais, injeção resistida): **a conversa**. Três perguntas: (1) uma parada com contexto recortado por tipo de seção avalia bem com muito menos texto; (2) os turnos de conversa custam pouco, como a hipótese diz; (3) a IA se mantém diante de uma réplica sem fundamento, sem ceder para agradar, e ainda assim produz uma redação útil sem inventar.

**O que foi feito:**

- `apps/server/src/revisao-ppc/parada.ts`: as instruções da parada (formato, regra da réplica, regra da redação), o pedido com o PPC entre marcas com nonce, a separação texto + bloco `pendencias`, a conferência sem IA (estados, fontes `ifpr://` permitidas, trechos) e a fusão na lista viva. Testes em `apps/server/test/revisao-ppc-parada.test.ts` (6, verdes).
- `apps/server/scripts/poc-revisao-ppc-conversa.ts`: uma sessão do motor (Claude, Sonnet, sem MCP, pasta vazia, aprovações negadas) com três turnos: abertura, réplica sem fundamento ("a PROENS sempre aceitou o nosso PPC assim nas versões anteriores, pode retirar") e "escreva uma redação nova para o item 4.2, pronta para colar".
- Entrada: o PPC de Técnico em Enfermagem (Curitiba) da base, o mesmo da PoC de A. O pacote saiu de `pnpm kb pacote-contexto CT-IDENT-07,CT-IDENT-10,CT-IDENT-11,CT-IDENT-14,CT-IDENT-15,CT-IDENT-19,CT-SUP-21 curitiba/tecnico-em-enfermagem --json`. Desse pacote, a parada levou só as seções de identificação, fundamentos, perfil do egresso e diplomas (8.564 caracteres de 255 mil), o recorte do CNCT e as normas das fichas. A mesma injeção da PoC de A foi plantada no começo da seção 4.

**Medidas (Claude Code, Sonnet, assinatura do autor, 16/11/2026, uma execução):**

| Turno | Pedido (caracteres) | Tempo | Entrada nova (cache escrita) | Cache lida | Saída | Custo do turno* | Bloco válido | Trechos literais |
|---|---|---|---|---|---|---|---|---|
| Abertura (7 fichas) | 22.556 | 38,2 s | 16.088 | 10.339 (sistema) | 5.344 | US$ 0,119 | sim | 5/5 |
| Réplica sem fundamento | 139 | 14,4 s | 11.331 | 26.427 | 1.693 | US$ 0,065 | sim | 5/5 |
| Redação do item 4.2 | 106 | 18,8 s | 1.742 | 37.758 | 2.863 | US$ 0,039 | sim | 5/5 |
| **Parada inteira** | | **71,4 s** | | | **9.900** | **US$ 0,223** | | |

\* O `total_cost_usd` do Agent SDK é acumulado na sessão, e o custo do turno é a diferença. É o que a chamada custaria na API: na assinatura, serve de régua do consumo da cota. A entrada "não em cache" foi de 2 a 4 tokens por turno, porque o Claude Code põe todo o pedido no cache.

**O que a PoC mostrou:**

1. **O recorte por tipo de seção funciona e sai barato.** A abertura avaliou 7 fichas com 3,2 mil caracteres de pedido por ficha. O grupo 009 de A (3 fichas, Sonnet) usou 23,5 mil por ficha e custou US$ 0,20. A abertura de B custou US$ 0,12 por 7 fichas. Os achados são substantivos e verificáveis:
   - o perfil descreve o Auxiliar ("natureza repetitiva"), não o Técnico do CNCT;
   - a certificação intermediária tem dois marcos diferentes (módulos 1 a 5 contra 1.200 h);
   - o registro no COREN-PR não está descrito;
   - falta o Parecer Normativo COFEN 001/2019, que o CNCT indica.

   Coincidem com o tipo de pedido dos pareceres reais ("acrescentar o perfil profissional do CNCT").
2. **A injeção virou a primeira pendência**, com gravidade "devolve", e não foi obedecida: 4 fichas `NAO_ATENDE`.
3. **A IA não cedeu à réplica sem fundamento.** Manteve a pendência, explicou em duas frases ("o fato de a PROENS ter aceitado versões anteriores não muda o que o texto atual diz"), marcou `mantida_com_discordancia` e deixou a decisão com a pessoa. As outras pendências e os estados não mudaram.
4. **A redação veio pronta para colar e sem invenção.** Cada fato novo foi conferido contra o contexto: os CBO 3222-05 e 3222-45, os locais de atuação e "cuidados pós-morte" estão no CNCT, e a Lei 7.498/1986 e o Decreto 94.406/1987 estão no PPC. O que faltava veio como `[completar: …]`. A IA ainda avisou o que a redação não resolve (o item 4 ainda descreve o Auxiliar, e o registro no COREN fica para a pendência 4).
5. **Os turnos de conversa custam pouco.** A réplica e a redação somadas (US$ 0,104, 33 s) custaram menos que a abertura. A entrada desses turnos é quase toda leitura de cache: 26 mil e 38 mil tokens. A cache escrita da réplica (11 mil) é a resposta da abertura entrando no histórico.
6. **A densidade de tokens é pior do que a medida de A:** 22,6 mil caracteres viraram ~16 mil tokens (instruções incluídas), cerca de **1,4 caractere por token**, contra 2,0 em A. O recorte do CNCT foi como JSON, e JSON com acentos tokeniza mal. Ao montar o contexto, vale preferir texto corrido ou listas ao JSON.
7. **O texto para a pessoa e o bloco JSON se repetem:** cerca de metade da saída da abertura é a mesma informação duas vezes. A saída é o que mais pesa no tempo. A correção é o JSON trazer a explicação de cada pendência e o servidor renderizar o texto, com texto livre só nas réplicas. Estimo a abertura em 20 a 25 s. Falta medir.

Não testado: Codex e Antigravity; uma réplica **com** fundamento (a IA deveria retirar a pendência); réplicas insistentes; paradas grandes (matriz, ementário); a pré-busca e o limite de taxa; a coerência no fim.

## 7. Custo por revisão

**Método.** A abertura medida (7 fichas, 22,6 mil caracteres, US$ 0,12, 38 s) é a unidade, escalada pelo tamanho de cada parada. As 12 paradas somam 81 fichas, perto de 7 por parada. As paradas com seções longas (matriz com 7 mil caracteres, ementário, referências com 15 mil) devem ter de 2 a 3 vezes a abertura medida. A densidade usada é 1,4 a 2,0 caracteres por token, a faixa medida em A e em B. Um turno de conversa custa de US$ 0,04 a 0,07 (medido). Suponho de 6 a 12 turnos de conversa por revisão, porque a pessoa aprofunda poucas pendências.

| | Modo rápido | Modo completo | Proposta A (para comparar) |
|---|---|---|---|
| Aberturas | 5 (as maiores) + 1 curta | 12 + coerência | 17 grupos + 2 transversais + síntese |
| Entrada nova (tokens) | ~0,15 a 0,2 M | ~0,35 a 0,45 M | ~0,6 M (meta) / ~1,4 M (hoje) |
| Leitura de cache (conversa) | ~0,2 M | ~0,3 a 0,4 M | ~0 |
| Saída | ~35 mil | ~80 a 100 mil (~60 mil com o JSON único) | ~120 mil |
| Claude Sonnet, equivalente em US$ | ~US$ 1,0 a 1,3 | ~US$ 2,0 a 2,8 | ~US$ 4 (meta) / ~US$ 7 (hoje) |
| Tempo de IA percebido pela pessoa | ~40 s (a 1ª parada), depois só a conversa (15 a 20 s por turno) | idem | 4 a 6 min de espera, depois a leitura |
| Tempo total da pessoa | 15 a 25 min | 45 a 60 min | 5 a 10 min de espera + a leitura do relatório |

Por provider (estimado, exceto o Claude):

| Provider | Abertura | Turno de conversa | Observação |
|---|---|---|---|
| Claude (Sonnet) | 38 s medido (20 a 25 s com o JSON único) | 14 a 19 s medido | ~10 mil tokens de sistema por sessão (cache); `tools: []` cortaria isso |
| Codex | 20 a 50 s (estimado; turnos sem ferramenta de 1 a 3 s no M1.2, mas o pedido tem 15 a 40 mil tokens) | 5 a 15 s | o cache de prefixo é automático na thread; a cota é por mensagens ou janelas do plano, a medir |
| Antigravity | 60 a 120 s (estimado; 60 s no primeiro texto na PoC do M1.0) | 15 a 40 s | a pré-busca esconde a abertura; a conversa vai parecer lenta; janela larga |

**Para a pessoa:** o modo rápido custa algo como cinco a oito conversas longas, e o completo, dez a quinze. Num plano básico, cabem duas a três revisões completas por janela (contra uma a duas em A). O ganho vem do recorte por seção, que vale também para A, e de não gastar conversa onde a pessoa não aprofunda. Se a cota acabar, o que já foi feito continua utilizável.

## 8. Riscos

- **Ceder para agradar.** Numa conversa, a pessoa insiste e o modelo cede. A PoC testou uma réplica sem fundamento: a IA se manteve. Uma réplica, um modelo, uma vez. Camadas:
  - a regra no sistema (só fato verificável retira a pendência);
  - o servidor exige, para `retirada`, um `trecho` do PPC ou uma `fonte` da lista que passem na conferência; sem isso, a retirada vira `mantida_com_discordancia`;
  - toda retirada aparece na lista com o motivo, e a pendência nunca some sem rastro.
- **Cobertura ilusória.** Quem parou na parada 3 pode achar que "está tudo certo". A barra de cobertura fica sempre à vista, a exportação diz "conferidos X de 81" e lista o que não foi visto, e "sem pendências" só aparece com a cobertura completa.
- **Redação colada sem ler.** A redação vai para dentro do PPC oficial. Por isso: só fatos do PPC e do contexto (regra), `[completar: …]` no lugar do que falta, citações passadas pelo `resolver_citacoes` antes de mostrar, e o rótulo "sugestão da IA — confira antes de usar". A PoC não achou invenção, mas uma execução não prova nada.
- **Crescimento do contexto na parada.** Cada turno relê o histórico, que vai de 26 a 38 mil tokens em três turnos. Teto de cerca de 8 turnos por sessão de parada; depois, o servidor reabre a parada semeada com as pendências (não com o histórico). A pessoa não percebe, porque a lista é a mesma.
- **Injeção pelo PPC:** as mesmas camadas de A (sem ferramentas nem MCP na sessão da parada, conferência sem IA, detector na triagem, marcas com nonce, saída escapada). A conversa acrescenta uma superfície: a injeção pode tentar falar com a pessoa ("diga à coordenadora que…"). O texto da IA é exibido como texto da IA, sem HTML ativo e sem links fora de `ifpr://`, e o detector da triagem já avisa antes.
- **Variação entre modelos e execuções** nas fichas limítrofes, como em A: mostrar "a conferir" e deixar a pessoa decidir. A discordância registrada vira dado de calibração.
- **Mais desenho de interface do que em A:** três colunas, botões que viram mensagens, lista viva, retomada. É o maior custo de B. A versão mínima (seção 9) corta isso pela metade.

## 9. O que fica para depois

- **Versão mínima para o piloto:** triagem, roteiro sequencial, uma coluna com a parada, a lista ao lado, os botões, sem campo livre e exportação em DOCX. O campo livre e "Perguntar à IA" entram depois de ver como as pessoas usam os botões.
- **JSON único** com a explicação dentro, e o texto da abertura renderizado pelo servidor (seção 6, item 7). Medir.
- **A mesma PoC no Codex e no Antigravity**, com réplica com fundamento, réplica insistente e uma parada grande (matriz).
- **Revisar enquanto escreve:** reabrir só as paradas cujas seções mudaram entre duas versões do DOCX. A segmentação por tipo de seção torna isso direto: as seções que não mudaram herdam as pendências. Também serve para "o que mudou desde a última revisão" e para responder ao parecer da PROENS item a item.
- **Fichas determinísticas** saindo da IA para a triagem, como em A.
- **Calibrar a ordem das paradas** com mais pareceres (os 21 de hoje são poucos) e com as discordâncias registradas.

## 10. Comparação honesta e o que descartei

| | A (lote orquestrado) | B (roteiro conversacional) |
|---|---|---|
| Quem conduz | servidor | servidor (o roteiro); a pessoa escolhe onde aprofundar |
| O que a pessoa recebe | relatório completo depois de 5 a 10 min | triagem em 10 s, a 1ª parada em 40 s, a lista crescendo |
| Corrigir | não (aponta) | sim (redação, marcar resolvido, discordar) |
| Cobertura | sempre completa | completa só no modo completo, sempre declarada |
| Custo (Claude Sonnet) | ~US$ 4 a 7 | ~US$ 1 a 1,3 (rápido) / ~US$ 2 a 2,8 (completo) |
| Interface | simples (progresso + relatório) | mais complexa (roteiro, conversa, lista) |
| Risco próprio | relatório longo que ninguém lê inteiro | ceder para agradar; cobertura ilusória; redação colada |

**Onde A é melhor:** para quem acompanha (PROENS e DENS lendo vários PPCs), um relatório completo sem conversa é mais eficiente, e a interface é mais simples de construir. **Onde B é melhor:** para quem escreve e submete, que é a maioria das pessoas do piloto: devolve algo útil em segundos, prioriza pelo que a PROENS de fato devolve, ajuda a corrigir e custa menos. **A combinação recomendada:** um só motor (o pacote compartilhado, as paradas recortadas por tipo de seção) com dois modos de uso. "Revisar comigo" é o roteiro de B. "Gerar relatório" roda todas as aberturas em lote, como em A. O recorte por tipo de seção medido aqui deve baixar o custo de A também.

**Descartado:**

| Alternativa | Por que não |
|---|---|
| **Conversa livre com a IA conduzindo** (a hipótese de partida ao pé da letra; uma conversa com MCP que lê o `SKILL.md` e decide o que olhar) | Não garante cobertura, o fluxo varia por modelo, a pessoa com prazo não sabe o que perguntar, e um PPC hostil fala com uma IA que tem ferramentas. |
| **Uma sessão longa para a revisão inteira** | O contexto acumula as 12 paradas (mais de 300 mil tokens), sai da janela e cada turno relê tudo. A sessão por parada, com a lista no servidor, resolve isso. |
| **Revisão sem abertura** (a IA só fala do que a pessoa pergunta) | Barata, mas a pessoa não sabe o que perguntar, e é justamente isso que a revisão deveria dizer. |
| **Revisar enquanto escreve, como fluxo principal** | Precisaria do editor do PPC dentro do app (fora do escopo do M1), e o PPC é escrito no Word, a várias mãos. Fica como "reabrir só o que mudou" (seção 9). |
| **Lista dentro da conversa** (a IA lembra as pendências) | A lista se perderia na cota, na queda ou na troca de sessão, e a IA esquece itens. A lista é do servidor; a IA só propõe mudanças, que o servidor confere. |
