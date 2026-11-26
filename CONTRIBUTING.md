# Como contribuir

Correções de dado da base, normas novas, fichas da revisão de PPC e código do app são bem-vindos.

## Antes de começar

- Leia o [`AGENTS.md`](AGENTS.md). Ele traz o mapa do repositório, as regras de curadoria da base e as convenções do código, e vale para pessoas e para agentes de IA.
- Para mudança grande, abra uma issue antes e combine o caminho.
- Erro de conteúdo: abra uma issue ou use "Isto está errado" no app.
- Falha de segurança ou dado pessoal publicado: não abra issue; siga o [`SECURITY.md`](SECURITY.md).

## Ambiente

Node da versão em `.node-version` e o pnpm do `packageManager` do `package.json`:

```bash
pnpm install
pnpm kb:compilar   # tmp/kb.sqlite, a base que o servidor lê
pnpm app:dev       # o app em desenvolvimento (veja apps/desktop/README.md)
```

## O que há no repositório

O repositório traz o app, a base que o alimenta e as skills e os scripts que agentes de IA usam para curar a base. A consulta da base pela CLI `kb`, as regras de curadoria e as convenções do código estão no [`AGENTS.md`](AGENTS.md); o desenvolvimento das skills, em [`base-conhecimento/docs/desenvolvimento-skills.md`](base-conhecimento/docs/desenvolvimento-skills.md); os planos, em [`docs/plans/`](docs/plans/README.md).

| Parte | O quê |
|---|---|
| [`apps/desktop`](apps/desktop/README.md) | Electron: inicia o servidor local e abre a interface |
| [`apps/server`](apps/server/README.md) | servidor local: motor, MCP `ifpr`, leitura da base, revisão de PPC, pastas, atualização |
| [`apps/web`](apps/web/README.md) | interface em React |
| [`packages/kb`](packages/kb/README.md) | núcleo da base e CLI `kb` |
| [`packages/mcp`](packages/mcp/README.md) | `simplifica-mcp`: as consultas à base, no app e como executável à parte ([guia de instalação](docs/guia-simplifica-mcp.md)) |
| [`packages/motor`](packages/motor/README.md) | motor de conversa com Claude, ChatGPT e Gemini |
| [`packages/ppc`](packages/ppc/README.md), [`packages/docx`](packages/docx/README.md), [`packages/pdf`](packages/pdf/README.md) | conversão, pré-conferência e revisão de PPC em `.docx`; leitura dos anexos |
| [`packages/atualizacao`](packages/atualizacao/README.md) | atualização da base e das skills |
| `base-conhecimento/` | a base: normas, dados institucionais, catálogos e fichas da revisão de PPC |
| `catalogo/` | o que viaja para o app como dado: as tarefas (`tarefas/`) e as skills do app (`skills/`) |
| `.agents/skills/` | skills de quem mantém o repositório (curadoria; não vão para o app) |
| `scripts/` | geração e validação da base, fábrica da atualização, avaliação |

## Antes de abrir o PR

```bash
pnpm fmt && pnpm lint && pnpm typecheck && pnpm test   # se mexeu em código
node scripts/gerar_base.ts                               # se mexeu em base-conhecimento/
node scripts/validar_base.ts
```

O CI roda as mesmas verificações em cada PR.

## Dados pessoais

A base é pública. Não inclua CPF, RG, celular, matrícula, SIAPE nem e-mail particular. O `validar_base.ts` recusa os cinco primeiros; o e-mail particular fica por sua conta. O que fica e o que sai está em [Dados pessoais e URLs internas](base-conhecimento/docs/curadoria-metadados-institucionais.md#dados-pessoais-e-urls-internas).

## Licença das contribuições

Ao enviar uma contribuição, você concorda que ela entra sob a licença da parte em que entra:

- código, scripts e skills: MIT ([`LICENSE`](LICENSE));
- conteúdo curatorial da base: CC BY 4.0 ([`LICENSE-DADOS`](LICENSE-DADOS)); texto oficial e documento institucional reproduzidos mantêm o regime de origem.

Assine cada commit com `git commit -s`. A linha `Signed-off-by: Nome <e-mail>` que ele acrescenta é a sua declaração do [Developer Certificate of Origin 1.1](https://developercertificate.org/): você atesta que tem o direito de enviar a contribuição sob a licença do projeto. Use o mesmo e-mail do commit; o e-mail `noreply` do GitHub serve.

Trecho copiado de outro projeto entra com a origem e a licença dele, como o código do T3 Code em [`docs/upstream-t3.md`](docs/upstream-t3.md). Não copie de fonte com licença incompatível com a MIT nem de fonte sem licença.
