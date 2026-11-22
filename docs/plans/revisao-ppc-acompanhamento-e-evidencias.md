# Revisar um PPC: evidências, leitura completa, andamento da IA e resultados parciais

Plano de 22/11/2026, consolidado após duas revisões críticas independentes contra o código real (antes de qualquer implementação), a partir de uso real do revisor redesenhado ([revisao-ppc-interface.md](revisao-ppc-interface.md)). Alpha: sem compatibilidade nem migração; o que muda no contrato muda.

## Problemas observados

1. **Trecho pouco legível e falso positivo em `CT-CURR-16`.** Na linha aberta, a citação do PPC aparece sem rótulo nem atalho para localizar no Word, e pendências vindas da IA hoje têm `secao: null` ([packages/ppc/src/revisao-previa.ts:443](../../packages/ppc/src/revisao-previa.ts)). No caso real observado, o verificador `CT-CURR-16` ([packages/ppc/src/verificadores/curriculo.ts](../../packages/ppc/src/verificadores/curriculo.ts)) acusou *"O PPC fala em ensino médio concluído no ingresso"* a partir da frase *"cumprirem os requisitos exigidos pelo curso, os estudantes receberão o Histórico Escolar de Conclusão do Ensino Médio"* na seção `4.1 EXPEDIÇÃO DE DIPLOMAS E CERTIFICADOS` — falso positivo causado por `RE_CONTEXTO_INGRESSO` aceitar `requisit` genérico e por não excluir a seção `certificados_diplomas`.
2. **Mensagem da pendência cortada mesmo aberta.** Em [LinhaPendencia.tsx:101](../../apps/web/src/revisao/LinhaPendencia.tsx), `line-clamp-2` vale tanto com a linha recolhida quanto aberta, truncando mensagens longas com `…` sem nenhum lugar onde ler o texto completo — e sem `whitespace-pre-line` para preservar quebras de linha (`\n`) produzidas por `legivel()` ([revisao-previa.ts:469-475](../../packages/ppc/src/revisao-previa.ts)).
3. **Leitura com IA opaca e timeout que desperdiça trabalho paralelo.** A [FaixaIa.tsx](../../apps/web/src/revisao/FaixaIa.tsx) mostra uma frase única (`Lendo Identificação e oferta — 0 de 4 temas`), escondendo que há 2 blocos em paralelo (`PARALELISMO = 2`), quais blocos já terminaram e se o provider está respondendo. Em [julgamento.ts](../../apps/server/src/revisao-ppc/julgamento.ts), `TEMPO_TURNO` (6 min) pausa sem dizer *qual* bloco/tema travou nem se chegou a emitir texto parcial — e o `Effect.forEach` com `concurrency: 2` ([RevisaoIa.ts:272](../../apps/server/src/revisao-ppc/RevisaoIa.ts)) interrompe imediatamente o bloco irmão, jogando fora até 6 minutos de resposta em curso.
4. **Resultados já revisados presos no banco na pausa/timeout.** Embora `RevisaoIa.ts` grave cada bloco concluído em `blocos_ia`, a lista de pendências (`criarLista`) só é montada depois que **todos** os blocos terminam ([RevisaoIa.ts:297-315](../../apps/server/src/revisao-ppc/RevisaoIa.ts)). Quando ocorre timeout, cota ou pausa manual, o aviso diz *"O que já foi revisado está guardado"*, mas a pessoa não tem acesso a nenhum achado dos blocos já prontos e só pode clicar em "Retomar".

---

## Direção e decisões de arquitetura

Mantém-se o princípio de [revisao-ppc-interface.md](revisao-ppc-interface.md): a tela principal continua quieta (sem poluição na lista recolhida nem console de debug vazando para o topo); o acompanhamento detalhado da IA abre sob demanda.

### Frente 1 — Mensagem completa, evidência clara e correção de `CT-CURR-16`

1. **Mensagem completa quando aberta ([LinhaPendencia.tsx:101](../../apps/web/src/revisao/LinhaPendencia.tsx)):**
   - Aplicar `line-clamp-2` apenas quando `!aberta`, e acrescentar `whitespace-pre-line` quando `aberta` (preservando as quebras de linha de `legivel()`, como em *"Regras de transição"*).
2. **Clareza no trecho do PPC ([LinhaPendencia.tsx](../../apps/web/src/revisao/LinhaPendencia.tsx), [pre-conferencia.ts](../../packages/ppc/src/pre-conferencia.ts) e [revisao-previa.ts](../../packages/ppc/src/revisao-previa.ts)):**
   - Acima do `blockquote`, mostrar apenas o rótulo discreto **`Trecho no PPC`** e o botão **`Copiar trecho`** (para `Ctrl+F` no Word), sem repetir a seção que já aparece no cabeçalho via `localizacao(p)`.
   - Preencher `secao` também para pendências vindas da IA (`itensDaIa`, hoje sempre `null`): fazer `preConferir` devolver também `secoes` (hoje interno ao `PpcPreparado`) e localizar o trecho da IA pelo maior pedaço normalizado (reaproveitando a lógica de pedaços de [conferencia.ts:85-110](../../packages/ppc/src/revisao-ia/conferencia.ts), que lida com reticências).
   - **Decisão:** não adicionar campo `destaque` (`<mark>`) no contrato agora; se ainda faltar clareza após os ajustes acima e a correção do falso positivo, avalia-se depois.
3. **Corrigir falso positivo em `CT-CURR-16` ([curriculo.ts](../../packages/ppc/src/verificadores/curriculo.ts)):**
   - Excluir seções do tipo **`certificados_diplomas`** (tipo real da taxonomia em [packages/kb/src/ppcs/secoes.ts](../../packages/kb/src/ppcs/secoes.ts)) tanto no loop de frases (`RE_CONTEXTO_INGRESSO`) quanto no bloco de rótulo na linha seguinte (`RE_ROTULO_INGRESSO`, linhas 127 e 202-209).
   - Adicionar filtro negativo para frases sobre `diploma|certificad|historico escolar|conclusao do curso` (texto já normalizado por `chave()`, sem acentos).
   - Medir primeiro na base com `node packages/ppc/scripts/pre-conferencia.ts --base --check` antes de apertar `requisit` em `RE_CONTEXTO_INGRESSO` (evitando regressão em *"requisito para ingresso"* ou *"requisito mínimo"* fora da seção `requisitos_acesso`; se precisar apertar, aceitar `(de|para)`).
   - Adicionar caso de teste unitário com o trecho real e atualizar `packages/ppc/PRECISAO.md` se a medição mudar.

---

### Frente 2 — Acompanhamento ao vivo da leitura com IA (enxuto e em memória)

1. **Modelo enxuto de estado ao vivo ([packages/contratos-app/src/revisao-ppc.ts](../../packages/contratos-app/src/revisao-ppc.ts)):**
   - Manter `BlocoRevisaoIa.estado` com os 3 valores já existentes (`"pendente" | "em_andamento" | "pronto"`), acrescentando apenas:
     - `etapa`: `"aguardando" | "recebendo" | "conferindo" | "nova_tentativa" | null` (só preenchida quando `estado === "em_andamento"`);
     - `titulosFichas: string[]` (títulos humanos dos critérios do bloco);
     - `iniciadoEm: string | null` e `ultimaAtividadeEm: string | null` (tempo decorrido *"há 42 s"* calculado no cliente, sem enviar ticks periódicos no `PubSub`);
     - `pendenciasEncontradas: number` (nos blocos prontos).
   - Em `EstadoRevisaoIa`, acrescentar apenas `blocoPausado: string | null` (id do bloco que falhou/deu timeout, ao lado de `motivo`, em memória — sem criar estado redundante `"pausado"` em cada bloco nem array de `eventos` no contrato; o diagnóstico técnico detalhado já existe nos traces do app via `pnpm traces --codigo`).
2. **Servidor sem gargalo de SQLite e sem jogar fora trabalho irmão ([RevisaoIa.ts](../../apps/server/src/revisao-ppc/RevisaoIa.ts) e [julgamento.ts](../../apps/server/src/revisao-ppc/julgamento.ts)):**
   - **Memória em vez de reler `plano`:** durante a execução, manter em memória o resumo dos blocos do plano (`id/tipo/tema/ordemTema/fichas/titulosFichas`) e o `Map` de etapas ativas, lendo `blocos`/`usoTotal` do SQLite só quando um bloco termina — evitando `SELECT *` + `JSON.parse` da coluna `plano` (centenas de KB) a cada mensagem do `PubSub`.
   - **Ouvir `TextoParcial` com throttle:** em `turnoSemFerramentas` ([julgamento.ts:249](../../apps/server/src/revisao-ppc/julgamento.ts)), adicionar `case "TextoParcial"` para mudar a etapa para `"recebendo"`, atualizar `ultimaAtividadeEm` (com throttle) e informar na mensagem de timeout **qual tema/bloco** expirou e se chegou a responder parcialmente.
   - **Não matar o bloco irmão em timeout:** no `Effect.forEach` com `concurrency: 2` ([RevisaoIa.ts:272](../../apps/server/src/revisao-ppc/RevisaoIa.ts)), quando um bloco pausa por timeout (`limite === false`), registrar a pausa num `Ref`, parar de iniciar blocos novos e **deixar o bloco irmão em andamento terminar e ser gravado** (em limite de cota/taxa `limite === true`, interromper imediatamente continua certo).
   - **Decisão sobre timeout de inatividade:** manter `TEMPO_TURNO = 6 min`. Os 3 drivers do `Motor` (`claude.ts`, `codex.ts`, `antigravity.ts`) descartam eventos de raciocínio (*thinking* / `agent_thought_chunk`), então um timeout curto baseado em `TextoParcial` geraria falsos timeouts no Gemini/Antigravity.
3. **Interface ([FaixaIa.tsx](../../apps/web/src/revisao/FaixaIa.tsx) e [ia.ts](../../apps/web/src/revisao/ia.ts)):**
   - `textoAndamento` passa a citar os temas ativos em paralelo (ex.: *"Lendo Identificação e oferta e Matriz curricular — 1 de 4 temas"*).
   - Botão discreto **`Ver andamento`** na `FaixaIa` (em `em_andamento`, `pausada` e `falhou`), expandindo um painel limpo logo abaixo da faixa com:
     - Lista por bloco/tema na ordem do parecer: pronto (tempo e nº de pontos), lendo (etapa humana + tempo decorrido + critérios do bloco), pausado (destacando o bloco indicado em `blocoPausado` com o motivo) e na fila.
     - Rodapé discreto opcional com modelo e uso acumulado de tokens (sem console técnico nem prompt/`nonce`).

---

### Frente 3 — Entrega incremental in-place e encerramento parcial

A ideia central é tratar a lista viva como uma **projeção recalculada** dos blocos prontos, sempre na **mesma `lista.id`**, e tornar a lista **dona dos resultados da IA**.

1. **Lista dona dos resultados da IA + trava compartilhada ([0001_Inicial.ts](../../apps/server/src/persistencia/migracoes/0001_Inicial.ts), [Listas.ts](../../apps/server/src/persistencia/Listas.ts), [ListaViva.ts](../../apps/server/src/revisao-ppc/ListaViva.ts)):**
   - Adicionar coluna `resultados_ia` (JSON com `{ resultados, fora }`, opcional/nula) em `listas_pendencias` e mudar a FK `revisao_id` para `ON DELETE SET NULL` na migração `0002_ResultadosIaNaLista.ts` (congelando `0001_Inicial.ts`), com backfill de `leituraIa` nos JSONs antigos e backup `.bak` automático em `Banco.ts` antes de aplicar migrações pendentes. `ListaViva.resultadosIa` passa a ler direto de `listas_pendencias.resultados_ia` (em vez de depender de `blocos_ia` via `revisao_id`).
   - Levar o semáforo de escrita (hoje local à `ListaViva`, linhas 267-269) para a camada `Listas` (ex.: `Listas.exclusivo(efeito)`), garantindo serialização entre `ListaViva` (`marcar`, `contestar`, `sugerir`, `gerarCopia`, `trocarCurso`, `revisarArquivoNovo`) e `RevisaoIa` (`mesclarIa`).
2. **Função pura única de montagem ([packages/ppc/src/revisao-previa.ts](../../packages/ppc/src/revisao-previa.ts) e [RevisorPpc.ts](../../apps/server/src/revisao-ppc/RevisorPpc.ts)):**
   - Extrair de `revisarDocx` uma função pura `montarResultado(preConferencia, ia, base)` (itens, deduplicação `[ficha, mensagem, trecho]`, critérios, contagens), usada tanto no caminho completo com `.docx` quanto na mesclagem incremental — evitando duas implementações que possam divergir.
   - Expor método leve em `RevisorPpc` que roda essa montagem usando a `base` já em cache no processo principal ([RevisorPpc.ts:295](../../apps/server/src/revisao-ppc/RevisorPpc.ts)), **sem Worker, sem reler `.docx` e sem `comentarDocx`**, preservando `arquivoComentado` e marcando `noDocumento` provisório (`trecho ? "no-trecho" : "no-inicio"`).
3. **Mesclagem idempotente e conclusão na mesma `lista.id` ([RevisaoIa.ts](../../apps/server/src/revisao-ppc/RevisaoIa.ts) e [Listas.ts](../../apps/server/src/persistencia/Listas.ts)):**
   - A cada bloco concluído (gravando o bloco e mesclando na mesma transação ou logo em seguida sob `Listas.exclusivo`), e também no início de `executar` (para recuperar de fechamento abrupto do app):
     - Localizar a lista por `(arquivo, sha256, cnct, forma)`. Se a lista foi apagada (`apagarLista`), encerrar/pausar a revisão sem recriá-la; se o `sha256` mudou (`revisarArquivoNovo`), não mesclar.
     - Recalcular o resultado com todos os blocos prontos, atualizar `resultado`, `resultados_ia`, `revisao_id`, `provider`, `modelo` e `versao` **na mesma `lista.id`** e inserir apenas as pendências novas com `INSERT OR IGNORE` (preservando 100% do que o usuário já marcou, contestou ou sugeriu).
   - **Conclusão no último bloco:** remover `criarLista` de `RevisaoIa.ts`. Ao terminar todos os blocos, mesclar o último bloco e chamar a lógica de `regravarCopia` sobre a mesma lista. Ao gravar a cópia comentada, atualizar também o JSON `pendencia` por chave em `pendencias_vivas` (dentro da mesma transação) para sincronizar o `noDocumento` real retornado por `comentarDocx` (ex.: `so-na-lista` em caixas de texto).
4. **Bloqueios no servidor e consistência de estado ([ListaViva.ts](../../apps/server/src/revisao-ppc/ListaViva.ts), [RevisaoIa.ts](../../apps/server/src/revisao-ppc/RevisaoIa.ts), [revisao-previa.ts](../../packages/ppc/src/revisao-previa.ts)):**
   - `trocarCurso` e `revisarArquivoNovo` recusam no servidor quando a revisão ligada estiver `em_andamento`; se estiver `pausada`, o servidor apaga a revisão pausada na mesma operação (e a UI avisa/desabilita de acordo).
   - `RevisaoIa.iniciar` recusa se a lista já estiver ligada a outra revisão não concluída (uma revisão por lista).
   - Ajustar `textoDoAviso` ([revisao-previa.ts:649-653](../../packages/ppc/src/revisao-previa.ts)) para permitir as duas frases juntas quando houver critérios fora do modo rápido **e** critérios ainda não lidos (encerramento parcial).
5. **Estado explícito na interface e "Encerrar leitura por aqui" ([packages/contratos-app/src/revisao-ppc.ts](../../packages/contratos-app/src/revisao-ppc.ts), [Leitura.tsx](../../apps/web/src/revisao/Leitura.tsx), [useLeituraIa.ts](../../apps/web/src/revisao/useLeituraIa.ts), [ReguaCriterios.tsx](../../apps/web/src/revisao/ReguaCriterios.tsx)):**
   - Acrescentar `leituraIa: "nenhuma" | "parcial" | "completa"` em `ResultadoRevisaoPpc` em vez de inferir `passouPelaIa` de `conferidosIa > 0`: isso governa de forma clara `fraseResultado`, "Sobre esta revisão", `ativa` em `useLeituraIa` (que continua ativa em `"nenhuma"` e `"parcial"`) e a visibilidade da `FaixaIa`.
   - Sempre que a contagem de blocos prontos aumentar (e na conclusão), recarregar `revisaoPpc.lista({ lista: lista.id })` e marcar como `Novo` apenas o **diff** de chaves que não existiam antes.
   - Na [ReguaCriterios.tsx](../../apps/web/src/revisao/ReguaCriterios.tsx), remover/simplificar a pintura cinza intermediária (`temasLidosPelaIa` / *"lido, resultado no fim"*), já que os critérios recebem a cor real ao vivo.
   - **"Encerrar leitura por aqui"** (quando `pausada` e `blocosProntos > 0`): como a lista já é dona de `resultados_ia`, basta chamar o `revisaoPpc.apagarIa` já existente (sem RPC novo `concluirParcialIa`, sem reler `.docx` na hora — a cópia comentada é atualizada quando a pessoa clicar "Abrir no Word").
6. **Fica fora deste escopo (opcional depois): "Retomar com outra IA".**
   - Exige estender `AlteracaoRevisaoIa`, recalcular estimativa só dos blocos pendentes e tratar autoria mista no texto de conclusão e em `usoTotal`. Como a entrega incremental + "Encerrar leitura por aqui" já eliminam o bloqueio, fica para avaliação posterior.

---

## Ordem de entrega

1. **Etapa 1 (rápida, isolada):** `line-clamp-2` condicional + `whitespace-pre-line` aberta + cabeçalho `Trecho no PPC` / `Copiar trecho` em `LinhaPendencia.tsx` + `secao` nas pendências da IA (`preConferir` + `itensDaIa`) + correção de `CT-CURR-16` (`certificados_diplomas`, filtro negativo, testes e `pre-conferencia.ts --base --check`).
2. **Etapa 2 (andamento ao vivo e resiliência em timeout):** resumo de blocos e `etapa` em memória no `RevisaoIa`, `TextoParcial` com throttle e mensagem de timeout com tema/bloco em `julgamento.ts`, preservar bloco irmão em timeout, `textoAndamento` paralelo e painel expansível "Ver andamento" na `FaixaIa.tsx`.
3. **Etapa 3 (resultados parciais in-place e encerramento parcial):**
   1. `resultados_ia` em `listas_pendencias` + FK `ON DELETE SET NULL` + `Listas.exclusivo`.
   2. `montarResultado` puro extraído de `revisarDocx` e exposto no `RevisorPpc`.
   3. Mesclagem idempotente por bloco e no início de `executar`.
   4. Conclusão na mesma `lista.id` (`regravarCopia` + sync de `noDocumento` em `pendencias_vivas`).
   5. Bloqueios no servidor, `leituraIa` na interface, diff de `novas`, simplificação da `ReguaCriterios`, `textoDoAviso` e botão "Encerrar leitura por aqui" (via `apagarIa`).
