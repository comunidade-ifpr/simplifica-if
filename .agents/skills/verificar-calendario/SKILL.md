---
name: verificar-calendario
description: Verificar calendário acadêmico do IFPR (2026 ou 2027) em XLSX ou PDF por análise visual, conforme a resolução de calendário de referência do ano (Resolução CONSUP/IFPR nº 259/2025 para 2026, nº 292/2026 para 2027)
argument-hint: [caminho-do-arquivo.xlsx|caminho-do-arquivo.pdf]
---

# Verificar Calendário Acadêmico

Analisa calendários acadêmicos do IFPR em formato `xlsx` ou `pdf` e gera relatório de conformidade com a resolução de calendário de referência do ano, sempre com saída em `Markdown` e `PDF`.

## Base normativa por ano

| Ano do calendário | Resolução | Referência da skill |
|:---:|:---|:---|
| 2026 | Resolução CONSUP/IFPR nº 259, de 27 de novembro de 2025 (alterada pela nº 263/2025) | `referencias/2026.md` |
| 2027 | Resolução CONSUP/IFPR nº 292, de 5 de outubro de 2026 | `referencias/2027.md` |

A numeração dos artigos e a quantidade de incisos mudam de uma resolução para outra. Identifique o ano do calendário antes de citar qualquer dispositivo.

## Uso

Para orientação de uso por uma pessoa, leia também:

```text
Read .agents/skills/verificar-calendario/README.md
```

```text
/verificar-calendario caminho/para/calendario.xlsx
/verificar-calendario caminho/para/calendario.pdf
```

## O que faz

1. Identifica o ano do calendário e carrega `referencias/[ANO].md`, que aponta o texto local da resolução em `base-conhecimento/normas/ifpr/resolucoes/`.
2. Identifica o formato de entrada e escolhe o fluxo correto:
   - `xlsx`: leitura estrutural das planilhas.
   - `pdf`: renderização das páginas em imagem e inspeção visual.
3. Verifica todos os incisos obrigatórios do artigo de itens do calendário (25 incisos do art. 7º em 2026; 26 incisos do art. 11 em 2027).
4. Valida os marcos obrigatórios do Art. 2º do ano.
5. Confere dias letivos anuais e semestrais e a janela do ano letivo.
6. Detecta inconsistências entre documentos complementares, como:
   - calendário principal x tabela de eventos;
   - resolução citada no documento x resolução vigente para o ano;
   - numeração de artigos ou quantidade de incisos da resolução anterior;
   - datas do ano corrente x sobras de anos anteriores.
7. Gera relatório em Markdown no formato de **tabela única**, com as colunas `Item`, `Status` e `Observação/Evidência`, copiando a tabela do arquivo de referência do ano.
8. Converte o relatório Markdown em PDF em orientação retrato, preservando a tabela completa com cabeçalho repetido e sem quebrar linhas no fim da página.
9. Exige evidência textual mesmo quando o item atende, por exemplo:
   - datas;
   - períodos;
   - contagens de dias;
   - trechos observados no documento;
   - justificativa da insuficiência ou da não conformidade.
10. Usa os seguintes status por item:
   - `ATENDE`
   - `NÃO ATENDE`
   - `ATENDE COM RESSALVAS`
   - `EVIDÊNCIA INSUFICIENTE`

## Regras importantes para PDF

- Em PDF, a fonte primária deve ser a **análise visual das páginas renderizadas**, e não a extração bruta do arquivo.
- Se a página estiver densa, recortar por mês, bloco ou faixa antes de concluir a leitura.
- Se existirem dois PDFs complementares, tratá-los como fontes distintas e fazer validação cruzada entre eles.

## Instruções completas

Antes de executar, leia:

```text
Read .agents/skills/verificar-calendario/instrucoes.md
```

Para gerar o PDF a partir do Markdown final, usar (requer `pnpm install` na raiz):

```text
node .agents/skills/verificar-calendario/scripts/render_relatorio_pdf.ts caminho/relatorio.md caminho/relatorio.pdf
```
