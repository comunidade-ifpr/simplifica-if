# Análise de PPC

Esta skill analisa Projetos Pedagógicos de Curso técnico do IFPR a partir de um arquivo Word (`.docx`) ou Markdown (`.md`). A IA roda por sub-agentes na conversa atual; os scripts preparam o `PPC.md`, organizam as fichas e geram o PPC HTML anotado final.

## Formato aceito

Forneça o PPC em Word ou Markdown:

- Aceito: `.docx`
- Aceito: `.md`
- Não aceito diretamente: `.pdf`

Se o PPC estiver em PDF, converta ou solicite a versão original em Word antes de iniciar a análise.

## Como pedir para a IA usar a skill

Depois de instalar a skill no projeto, peça ao agente algo neste formato:

```text
Use a skill analise-ppc para analisar o PPC em /caminho/para/PPC.docx
```

Ou, se estiver usando um caminho relativo ao projeto:

```text
Use a skill analise-ppc para analisar o PPC em documentos/PPC_Curso_Tecnico.docx
```

Ao final, a IA deve informar um link para abrir o relatório:

```text
Relatório pronto: [abrir relatório](https://analise-ppc-<rodada>.surge.sh)
```

## Onde ficam os resultados

Cada análise cria uma rodada em:

```text
.agents/skills/analise-ppc/output/<rodada>/
```

Dentro da rodada:

- `relatorio-analise.html` é o PPC anotado final que deve ser aberto.
- `assets/` guarda CSS e JavaScript do leitor anotado.
- `arquivos-suporte/` guarda os arquivos usados para produzir o relatório.

Ao gerar o relatório, a skill publica no Surge por padrão e retorna `publicacao_url`/`surge_url`. Use `--sem-surge` quando quiser gerar somente o arquivo local.

## Fluxo técnico

O ponto de entrada é `scripts/analise_ppc.ts` (Bun), e todos os subcomandos rodam em TypeScript, inclusive `gerar-relatorio-html` e a publicação no Surge. Só a conversão de entrada `.docx` em `preparar-documento` ainda depende de Python: `scripts/converter_docx.py` (`python-docx`), chamado por subprocesso até a trilha T3 do `PLANO-ARQUITETURA.md`. Com PPC em `.md`, a skill inteira dispensa Python. `ANALISE_PPC_PYTHON` escolhe o interpretador da conversão DOCX (padrão `python3`). Em testes e diferenciais, `ANALISE_PPC_AGORA` (data ISO 8601) fixa o relógio da rodada: nome do diretório, `criado_em` e `data_conversao`. Fora da skill, o conversor de PDF de PPCs da base (`scripts/converter_ppcs_markdown.py`) também continua em Python, até a trilha T5.

```bash
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts preparar-documento caminho/PPC.docx
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts montar-grupos-subagents --rodada-dir .agents/skills/analise-ppc/output/<rodada>
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts preparar-prompts-subagents --rodada-dir .agents/skills/analise-ppc/output/<rodada>
```

Depois, o agente principal spawna um sub-agente por grupo em `arquivos-suporte/grupos-subagents.json` ou usa os pacotes prontos de `arquivos-suporte/prompts-subagents/`. Passe também os blocos `contextos` de cada grupo, incluindo `contextos.cnct`, `contextos.estrutura`, `contextos.fundamentacao_normativa` e eventuais `contextos.anexos_visuais`. O CNCT vem da base unificada em `base-conhecimento/catalogos/cnct/`. Em seguida, colete as respostas em `arquivos-suporte/resultados-subagents.json`, rode a síntese transversal com `prompts/sintese-transversal.md` e `validacoes_cruzadas`, e gere o relatório:

```bash
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts gerar-relatorio-html --rodada-dir .agents/skills/analise-ppc/output/<rodada> --resultados resultados-subagents.json
```

Para reavaliar fichas específicas, use `montar-grupo-avulso`, execute um sub-agente com o grupo retornado e depois `mesclar-resultados-avulsos`.

## Manutenção de fichas

Ao criar, atualizar ou corrigir uma ficha em `base-analise/fichas/`:

1. Garanta que a ficha declare `topicos_tematicos`, `tipo_escopo` e `ancoras_semanticas`.
2. Cite em `referencias_normativas` apenas normas vigentes. Regras de transição e a norma vigente de cada tema ficam em `base-analise/marcos-normativos.json`; o validador acusa ficha que cite norma revogada no `base-conhecimento/manifest.json`.
3. Atualize `base-analise/topicos-fichas.json` quando a cobertura temática mudar.
4. Atualize ou crie teste quando a ficha cobrir comportamento novo, regra normativa específica ou regressão já observada.
5. Regenere os artefatos derivados e valide a base.

Comandos obrigatórios a partir da raiz do repositório:

```bash
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts validar-base
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts gerar-mapa
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts gerar-indice
bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts validar-base
bun test ./.agents/skills/analise-ppc
python3 -m pytest .agents/skills/analise-ppc/tests
```

O `bun test` cobre a skill inteira; o `pytest` cobre só os extratores da conversão DOCX, que ainda é Python.
