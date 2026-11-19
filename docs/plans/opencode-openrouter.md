# OpenCode e OpenRouter: pesquisa inicial

Registro de 19/11/2026. Nada aqui está decidido nem implementado: é o ponto de partida para quando o app ganhar um caminho com modelos do OpenRouter.

## Por que

O app usa hoje a assinatura da pessoa em três providers (Claude, ChatGPT pelo Codex, Gemini pelo Antigravity). Falta um caminho em que a pessoa escolha modelos com retenção zero (ZDR), por privacidade. O OpenRouter oferece esse roteamento, e nenhum dos três harnesses atuais foi feito para ele.

O plano de segurança ([app-seguranca-dados.md](app-seguranca-dados.md)) já previa um driver `opencode` para modelos locais (Ollama, LM Studio). O mesmo driver serviria aos dois fins.

## O que foi medido

No checkout do T3 Code (`5ec4f500ef`, 19/11/2026):

| Peça do T3 | Tamanho | Mudou desde a nossa cópia (`a6d9140972`, 14/11) | Depende de |
|---|---|---|---|
| `packages/provider-acp/src/server/adapter.ts` | 10.287 linhas | 977 linhas | orquestração do T3 (subagentes, terminais, instruções) |
| `packages/provider-acp/src/server/AcpSessionRuntime.ts` | 3.028 linhas | 80 linhas | `shared/shell`, `HostProcess`, `AgentScope`, `provider-core/processGroup` |
| `AntigravityAcpSupport.ts` e `AntigravityDriver.ts` | 1.128 linhas | 38 commits em 60 dias | `contracts` e o runtime acima |
| `packages/provider-acp/src/server/sessionConfig.ts` | 150 linhas | 10 linhas | `contracts` |
| `packages/provider-opencode` | 16.201 linhas | não medido | `@opencode-ai/sdk`, `@opencode/client` |

- O T3 integra o OpenCode pelo servidor dele (`opencode serve` com o SDK), e não por ACP. Há duas gerações de adaptador convivendo (`adapter.ts` e `v2/adapter.ts`).
- Foram 50 commits em cinco dias na área de ACP e Antigravity do T3.

No `agy` 1.5.9 desta máquina (lista e troca conferidas também no 1.5.12), pelo motor (o que entrou em `packages/motor/src/acp/opcoes-sessao.ts`):

- o `session/new` devolve `configOptions` com a opção `model` (9 modelos na conta de teste, entre eles Claude e GPT-OSS) e a `thought_level`, que muda com o modelo;
- `session/set_config_option` troca os dois; a escolha vale por sessão e volta no `session/load`;
- a detecção com a sondagem dos modelos levou cerca de 3 s para os três providers juntos.

## Direção sugerida

1. **OpenCode por ACP, não pelo servidor dele.** Tentar primeiro o `opencode acp`: seria o segundo agente ACP do app e reaproveitaria o que o Gemini usa (`@simplifica-if/effect-acp`, a ponte de MCP, `acp/opcoes-sessao.ts`). A integração do T3 pelo servidor é grande e está em troca.
2. **Com dois agentes ACP, avaliar trazer o `AcpSessionRuntime` do T3 inteiro**, sem edição, no lugar do runtime mínimo (`packages/motor/src/t3/antigravityAcpRuntime.ts`) e da abertura de sessão do driver. É onde moram as armadilhas de sessão, muda pouco e depende de pouco. O `adapter.ts` e o `AntigravityDriver.ts` não entram: traduzem ACP para o produto do T3.
3. **A fronteira continua sendo o `Driver` do motor.** O servidor e a interface só conhecem `ConfigSessao`, `Evento` e `DeteccaoProvider`; nada fora de `packages/motor` importa de `t3/`. Arquivo copiado inteiro sincroniza por cópia (`pnpm upstream:t3 status|diff`); trecho adaptado, por leitura.
4. **ZDR imposto pela nossa camada.** "ZDR é contrato, não sinal técnico" (plano de segurança). No OpenRouter, é uma restrição de roteamento: o pedido só vai a provedores que o OpenRouter classifica como retenção zero. O driver geraria a configuração do OpenCode a cada sessão, isolada da configuração da pessoa, só com o OpenRouter e a exigência de ZDR em todo pedido, e a lista de modelos viria filtrada pelos que têm rota ZDR.

## O que muda no app

- **Chave de API.** O app não guarda segredo hoje (decisão 6 do [plano do app](app-simplifica-if.md)). O OpenRouter exige guardar a chave da pessoa, no cofre do sistema.
- **Cobrança por uso**, e não a assinatura que a pessoa já tem: a interface precisa dizer isso.
- **ZDR não resolve a LGPD.** Dado pessoal enviado ao exterior depende de instrumento do IFPR (plano de segurança, item 4).

## Não verificado

1. Se o `opencode acp` aceita MCP por HTTP (ou só pela ponte stdio), pedidos de aprovação e a escolha de modelo pela sessão (`configOptions` ou a API antiga `models`; o módulo de opções trata as duas).
2. Se a configuração do OpenCode repassa ao OpenRouter a exigência de ZDR em cada pedido, e o nome atual do parâmetro.
3. Se o Codex com provedor customizado apontando para o OpenRouter funciona: seria o caminho sem harness novo, mas depende de compatibilidade de API.
4. Quanto o `AcpSessionRuntime` arrasta de `AgentScope` e `processGroup`.

## Próximo passo, quando voltar

Um teste de um ou dois dias, sem mexer no app: `opencode acp` com uma chave do OpenRouter contra o motor (`pnpm motor:poc`), respondendo aos itens 1 e 2, e uma sondagem do item 3.
