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
```

## Antes de abrir o PR

```bash
pnpm fmt && pnpm lint && pnpm typecheck && pnpm test   # se mexeu em código
node scripts/gerar_base.ts                               # se mexeu em base-conhecimento/
node scripts/gerar_indice_ppcs.ts                        # se mexeu em registros institucionais ou PPCs
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
