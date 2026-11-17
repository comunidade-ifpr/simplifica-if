---
name: revisar-ppc
description: Revisar Projetos Pedagógicos de Curso técnico do IFPR antes da submissão à PROENS, em Word DOCX ou Markdown, preparando o PPC.md, coordenando sub-agentes na conversa com fichas canônicas e gerando o relatório de revisão (PPC HTML anotado determinístico). É uma revisão prévia; não substitui a análise oficial da PROENS nem emite parecer. Use quando o usuário pedir revisão ou análise de PPC, conferência de PPC antes de submeter, conformidade de Projeto Pedagógico de Curso com normas, CNCT, matriz curricular, ementário, estágio ou fundamentação legal.
---

# Revisão de PPC

Skill autocontida para revisar PPCs de cursos técnicos do IFPR em Word (`.docx`) ou Markdown (`.md`) antes da submissão à PROENS. É uma revisão prévia, para quem elabora ou acompanha o PPC: o produto é um relatório de revisão, não um parecer, e não substitui a análise oficial da PROENS. A execução de IA ocorre apenas por sub-agentes na conversa atual. Os scripts fazem somente a preparação do documento, a organização dos grupos de fichas e a geração determinística do PPC HTML anotado.

## Uso rápido

Para orientação de uso por uma pessoa, leia também:

```text
Read .agents/skills/revisar-ppc/README.md
```

Antes de executar uma revisão, leia as instruções completas:

```text
Read .agents/skills/revisar-ppc/instrucoes.md
```

## Fluxo principal

1. Preparar o documento para criar a rodada e o `PPC.md`.
2. Montar os grupos de fichas por tópico para sub-agentes: cada ficha em um grupo, o do seu tópico principal, e as fichas transversais num grupo com o PPC inteiro. Cada grupo recebe só as seções do `PPC.md` dos tópicos das suas fichas (segmentação e taxonomia do índice de seções do kb), além de contexto CNCT, contexto estrutural, validações cruzadas e anexos visuais quando disponíveis.
3. Incluir contexto de fundamentação normativa para grupos com fichas que citam ou dependem de base legal: o texto dos dispositivos citados, as regras de transição e os marcos, do `kb.sqlite`, e o protocolo da skill `verificar-fundamentacao-normativa`.
4. Gerar pacotes de prompt por grupo com `preparar-prompts-subagents`.
5. Spawnar um sub-agente por grupo na conversa atual.
6. Coletar as respostas em `arquivos-suporte/resultados-subagents.json`, incluindo evidências estruturadas e achados opcionais em `fundamentacao_normativa`.
7. Executar síntese transversal por sub-agente usando `validacoes_cruzadas`; cada alerta deve trazer `validacao_id`.
8. Gerar o relatório de revisão (PPC HTML anotado determinístico, com busca/filtros) e publicar no Surge por padrão.

A situação geral do relatório é de revisão prévia: `APTO_PARA_SUBMISSAO` (Apto para submissão), `APTO_COM_RESSALVAS` (Apto com ressalvas: há ficha inconclusiva ou revisão humana obrigatória), `AJUSTES_NECESSARIOS` (Ajustes necessários: ficha obrigatória não atendida ou alerta transversal `OBRIG`) ou `REVISAO_SUBSTANCIAL` (Revisão substancial necessária: ficha bloqueante não atendida ou alerta transversal `BLOQ`). Ao relatar, não as apresente como aprovação, diligência ou reprovação da PROENS.

Ao final, informe explicitamente o link de abertura do relatório retornado pelo comando, preferencialmente `surge_url` ou `publicacao_url`. O relatório local fica em `output/<rodada>/relatorio-revisao.html`; os assets ficam em `output/<rodada>/assets/`; a pasta enviada ao Surge fica em `arquivos-suporte/surge-site/`; os metadados da publicação ficam em `arquivos-suporte/surge-publicacao.json`; e os demais arquivos de suporte da rodada ficam em `output/<rodada>/arquivos-suporte/`. Use `--sem-surge` apenas quando a publicação externa não for desejada.

## Ponto de entrada

Execute os comandos a partir da raiz deste repositório:

```bash
node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts --help
```

O ponto de entrada é `scripts/revisar_ppc.ts` (Node), e todos os subcomandos rodam em TypeScript, inclusive `gerar-relatorio-html`, a publicação no Surge e a conversão de entrada `.docx` em `preparar-documento` (pacotes `@simplifica-if/ppc` e `@simplifica-if/docx` do workspace, com leitor OOXML próprio). A skill só precisa do Node: não usa MS Word nem poppler.
