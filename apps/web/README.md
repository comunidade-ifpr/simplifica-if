# @simplifica-if/web

A interface do app desktop Simplifica IF (M1.1): React 19, TanStack Router com rotas por arquivo, Tailwind 4 e shadcn sobre Base UI, na stack do T3 Code. Fala com o servidor local (`apps/server`) só por `effect/rpc` sobre WebSocket, com os contratos de [`@simplifica-if/contratos-app`](../../packages/contratos-app/src/contratos.ts). Toda a interface é em português; as cores e a tipografia são as da identidade do IFPR (skill `ifpr-design`), em tema claro e escuro.

Este é o shell funcional. O Modo Servidor completo (tarefas, etapas da skill, pasta de trabalho, "Desfazer") é o M1.9; o leitor `ifpr://` completo é o M1.6.

## Telas

- **Início** (`/`): Claude, ChatGPT (Codex) e Gemini (Antigravity), cada um com `providers.detectar` (instalado, login, versão, plano), "Instalar" (`providers.instalar`, com a barra de progresso de `EstadoInstalacao`) e "Entrar" (`providers.entrar`; em `aguardando`, a URL de login aparece como link, e o desktop a abre no navegador do sistema). Os botões só aparecem quando a detecção diz que o app oferece a operação (`podeInstalar`, `podeEntrar`); senão, a orientação provisória para fazer no Terminal (`orientacao` em `src/providers.ts`): instalar o Claude Code pelo instalador oficial e entrar com `claude`; entrar no Codex com `codex login`.
- **Conversa** (`/conversa`): escolhe o provider e a pasta de trabalho (no desktop, o seletor de pastas do sistema; no navegador, um campo de texto) e conversa: texto parcial e final em Markdown, ferramentas como etapas (nome e resumo), pedido de aprovação com "Permitir" e "Negar", "Interromper" e "Nova conversa". Os links `ifpr://` das respostas, na sintaxe de link do Markdown ou soltos no texto (`src/components/linksIfpr.ts`), abrem um painel lateral com o `lerLink` do `GrupoLeitura`, em Markdown.
- No cabeçalho, o estado da conexão (conectado, reconectando com a contagem e "Tentar agora") e o tema (sistema, claro, escuro).

## Rodar em desenvolvimento

O caminho mais curto é o servidor de teste: o `apps/server` de verdade, com drivers de demonstração (nenhum provider real é chamado) e o banco de fixture do MCP.

```bash
# terminal 1: imprime {"porta":…,"urlServidor":…,"token":…,"pasta":…}
pnpm --filter @simplifica-if/web servidor:teste

# terminal 2
pnpm --filter @simplifica-if/web dev          # http://localhost:5190
```

Abra `http://localhost:5190/?servidor=<porta>&token=<token>`. A interface guarda as credenciais no `sessionStorage` da aba e as tira da barra de endereço. Para conversar, use a `pasta` da linha do servidor de teste. Na demonstração, uma mensagem com "escrev" pede aprovação, e uma com "demor" só termina com "Interromper".

Contra o servidor com os providers reais:

```bash
pnpm kb:compilar
SIMPLIFICA_SERVIDOR_TOKEN=$(openssl rand -base64 32) \
  node apps/server/src/bin.ts --banco tmp/kb.sqlite --origem http://localhost:5190
# {"servidor":"simplifica-if","pid":…,"porta":61885,…}
```

e abra `http://localhost:5190/?servidor=61885&token=<o mesmo token>`. O `--origem` é obrigatório: o servidor recusa (403) o `Origin` que não conhece, e a página do `vp dev` tem a origem `http://localhost:5190`.

Em vez dos parâmetros na URL, o `vp dev` também lê `VITE_SIMPLIFICA_SERVIDOR` (a porta ou `http://127.0.0.1:<porta>`) e `VITE_SIMPLIFICA_TOKEN`.

## Conexão

1. **De onde vêm as credenciais** (`src/conexao/origem.ts`): no desktop, de `window.simplifica.conexao()` (o `preload`; contrato em `src/ponte-desktop.ts`), chamada a cada conexão; no navegador, de `?servidor=…&token=…` ou das variáveis `VITE_`.
2. **Ingresso** (`src/conexao/ingresso.ts`): `POST /ingresso` com o token no `Authorization` e depois `ws://127.0.0.1:<porta>/rpc?ingresso=…`. O ingresso vale uma conexão só; o token nunca vai numa URL.
3. **Reconexão** (`src/conexao/Conexao.ts`): o protocolo do `effect/rpc` não reabre o socket; quando ele cai (ou o ping passa de 15 s), o laço pede as credenciais de novo, compra outro ingresso e abre outro socket, com espera de 0,5 s a 10 s. As chamadas feitas sem conexão esperam a próxima; as que estavam em andamento falham, e a conversa no servidor fica órfã por 2 minutos à espera de ser adotada.
4. **Interface** (`src/conexao/api.ts`, `src/contexto.tsx`): `api.chamar`, `api.acompanhar` (streams) e o estado da conexão para o React. A conversa vive fora do React (`src/conversa/ControleConversa.ts`, com o redutor puro `src/conversa/estado.ts`) e sobrevive à troca de tela.

## Build

```bash
pnpm --filter @simplifica-if/web build     # apps/web/dist, com caminhos relativos (base "./")
```

O desktop serve o `dist/`. Num arquivo local (`file:`), o roteador usa o histórico no `#`.

## Testes

```bash
pnpm --filter @simplifica-if/web test      # os dois projetos
pnpm --filter @simplifica-if/web exec vp test run --project unidade
pnpm --filter @simplifica-if/web exec vp test run --project navegador
```

- **`unidade`** (Node): a origem da conexão, os erros, o redutor da conversa e, contra o `apps/server` de verdade no próprio processo (drivers de demonstração), o ingresso, as recusas, a reconexão quando o servidor cai e volta na mesma porta, a conversa inteira pela `ControleConversa` (aprovação, link `ifpr://`, interromper, nova conversa) e instalar e entrar.
- **`navegador`** (Chromium headless pelo Playwright, como o T3): o app inteiro conectado ao `test/servidor-teste.ts`, que um comando do `vite.config.ts` sobe num processo Node; percorre o Início e a Conversa e confere que não aparece texto em inglês dos componentes copiados. Precisa do Chromium do Playwright 1.65 (`pnpm --filter @simplifica-if/web exec playwright install chromium` numa máquina nova; o CI instala só o headless shell, com `--only-shell`, e o guarda em cache pela versão do Playwright).

## Código do T3

Os componentes de `src/components/ui` (button, badge, input, textarea, alert, separator, spinner) e o `cn` de `src/lib/utils.ts` são cópias do T3 Code, com cabeçalho de atribuição e `LICENSE-T3`; ficam fora do `vp fmt`. O registro, com as adaptações, está em [`docs/upstream-t3.md`](../../docs/upstream-t3.md).

## Pendências

- **Persistência e retomada (M1.2):** recarregar a interface perde a conversa; os eventos de um turno que chegam enquanto a conexão está fora se perdem (o servidor não guarda nem reenvia).
- **Etapas da skill e "detalhes técnicos" (M1.9):** as ferramentas aparecem todas como etapas, sem agrupamento.
- **Leitor completo (M1.6):** o painel mostra só o Markdown do `lerLink`.
- **Login do Claude e do Codex, instalação do Claude (M1.8):** o motor só oferece `entrar` no Antigravity e `instalar` no Codex e no Antigravity. Nos outros, a Início mostra uma orientação provisória para o Terminal; o passo guiado é do M1.8.
- **Erros dos providers em português (M1.14):** `src/conexao/erros.ts` traduz as falhas conhecidas (sem login, CLI ausente, MCP que não subiu, modelo fora da conta, tempo esgotado) pela `operacao`, pelo provider e por padrões do detalhe, e as outras viram "não conseguiu <operação>"; o texto original fica em "Detalhes técnicos", recolhido. Falta a tradução completa por tipo de erro, com os erros reais de cada CLI catalogados.
- **Ícone e identidade final:** sem ícone; o nome e as cores seguem a skill `ifpr-design`.
- **knip:** a tabela da stack prevê o knip, que o repositório ainda não usa.
