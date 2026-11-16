# Verificar Calendário

Esta skill verifica calendários acadêmicos do IFPR, com foco na conformidade com a resolução de calendário de referência do ano, e gera relatório em Markdown e, dentro do repositório, também em PDF. A skill também vai para o app Simplifica IF (bloco `simplifica:` do front matter do `SKILL.md`), onde o resultado é só o relatório em Markdown.

## Base normativa por ano

| Ano do calendário | Resolução | Arquivo de referência |
|:---:|:---|:---|
| 2026 | Resolução CONSUP/IFPR nº 259/2025 (alterada pela nº 263/2025) | `referencias/2026.md` |
| 2027 | Resolução CONSUP/IFPR nº 292/2026 | `referencias/2027.md` |

Os textos integrais das resoluções ficam em `base-conhecimento/normas/ifpr/resolucoes/`. Cada arquivo em `referencias/` resume, para o ano, a numeração dos artigos, as datas obrigatórias, a janela do ano letivo, os requisitos críticos dos incisos e a tabela obrigatória do relatório.

## Manutenção

Quando sair a resolução de calendário de referência de um novo ano:

1. Incluir o texto da resolução em `base-conhecimento/normas/ifpr/resolucoes/` e rodar `node scripts/gerar_base.ts`, `node scripts/validar_base.ts` e `node scripts/gerar_site.ts`.
2. Criar `referencias/[ANO].md` com a mesma estrutura dos arquivos existentes: mapa de dispositivos, janela do ano letivo, datas do Art. 2º, requisitos críticos dos incisos e tabela obrigatória do relatório com a redação literal dos incisos.
3. Acrescentar a linha do ano nas tabelas deste README, de `SKILL.md` e de `instrucoes.md`.
4. Acrescentar `referencias/[ANO].md` à lista `simplifica.arquivos` do front matter do `SKILL.md`: só os arquivos listados ali vão para o app.

Depois de alterar os arquivos, conferir se as referências a artigos e incisos batem com o texto da resolução na base.

O PDF é gerado por `scripts/render_relatorio_pdf.ts` (`pdfmake`; a quebra de linhas que reproduz a do antigo script `reportlab` fica em `scripts/quebra-linhas.ts`). Depois de alterar esses scripts, rodar `pnpm exec vp test run .agents/skills/verificar-calendario`, `pnpm fmt` e `pnpm typecheck` na raiz.

## Formatos aceitos

A skill aceita calendários nos seguintes formatos:

- `.xlsx`
- `.pdf`

Use `.xlsx` quando houver planilha estruturada do calendário. Use `.pdf` quando o calendário estiver publicado ou recebido como documento visual.

## Como pedir para a IA usar a skill

Depois de instalar a skill no projeto, peça ao agente algo neste formato:

```text
Use a skill verificar-calendario para verificar o calendário em /caminho/para/calendario.xlsx
```

Ou, para PDF:

```text
Use a skill verificar-calendario para verificar o calendário em /caminho/para/calendario.pdf
```

Se houver dois arquivos complementares, como calendário principal e tabela de eventos/incisos, informe os dois caminhos:

```text
Use a skill verificar-calendario para verificar o calendário principal em /caminho/calendario.pdf e a tabela de eventos em /caminho/eventos.pdf
```

## O que a skill verifica

A análise confere, entre outros pontos:

- mínimo de 200 dias letivos anuais;
- mínimo de 100 dias letivos semestrais, quando aplicável;
- janela do ano letivo e prazo máximo de início;
- datas obrigatórias do Art. 2º da resolução do ano;
- incisos obrigatórios do artigo de itens do calendário (25 incisos do art. 7º em 2026; 26 incisos do art. 11 em 2027);
- coerência entre calendário principal e documentos complementares;
- sinais de documento reaproveitado de outro ano, com resolução, artigo ou quantidade de incisos antigos.

## No app Simplifica IF

No app, a skill roda sem o repositório: o servidor do app entrega o `SKILL.md`, o `instrucoes.md` e as `referencias/` listadas em `simplifica.arquivos`, e a IA lê a resolução pelas ferramentas MCP `ifpr` (`ler_dispositivos`, `buscar_norma`, `ficha_norma`). Não há scripts nem comandos: o PDF do calendário é lido pela ferramenta de leitura de arquivos, e o resultado é o relatório em Markdown na pasta de trabalho. `node scripts/validar_base.ts` confere o bloco `simplifica:` e os arquivos listados.

## Saídas esperadas

Dentro do repositório, ao final, a IA deve entregar dois arquivos (no app, só o Markdown):

- relatório em Markdown (`.md`);
- relatório em PDF (`.pdf`) gerado a partir do Markdown.

O nome recomendado é:

```text
relatorio_verificacao_[CAMPUS]_[ANO]_[FONTE]_[AAAAMMDDHHMMSS].md
relatorio_verificacao_[CAMPUS]_[ANO]_[FONTE]_[AAAAMMDDHHMMSS].pdf
```

Exemplo:

```text
relatorio_verificacao_Irati_2027_xlsx_20261201153000.md
relatorio_verificacao_Irati_2027_xlsx_20261201153000.pdf
```
