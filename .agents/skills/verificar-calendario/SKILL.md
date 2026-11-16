---
name: verificar-calendario
description: Verificar calendário acadêmico do IFPR (2026 ou 2027) em XLSX ou PDF por análise visual, conforme a resolução de calendário de referência do ano (Resolução CONSUP/IFPR nº 259/2025 para 2026, nº 292/2026 para 2027)
argument-hint: [caminho-do-arquivo.xlsx|caminho-do-arquivo.pdf]
simplifica:
  titulo: Verificar um calendário acadêmico
  resumo: Confere o calendário acadêmico do campus com a resolução de calendário do ano e gera um relatório item a item, com status e evidência.
  area: ensino
  publico: [direcao-ensino, secretaria-academica, dens]
  entradas:
    - { id: calendario, tipo: arquivo, aceita: [.pdf, .xlsx], rotulo: "Calendário acadêmico" }
    - { id: eventos, tipo: arquivo, aceita: [.pdf, .xlsx], rotulo: "Tabela de eventos ou incisos", opcional: true }
  ferramentas:
    - buscar_norma
    - ler_dispositivos
    - ficha_norma
    - sobre_a_base
  arquivos:
    - instrucoes.md
    - referencias/2026.md
    - referencias/2027.md
  duracao_estimada: 15min
---

# Verificar Calendário Acadêmico

Analisa calendários acadêmicos do IFPR em formato `xlsx` ou `pdf` e gera relatório de conformidade com a resolução de calendário de referência do ano. A saída é sempre um relatório em `Markdown`; dentro do repositório, também em `PDF` (ver [Onde a skill roda](#onde-a-skill-roda)).

## Base normativa por ano

| Ano do calendário | Resolução | ID na base | Referência da skill |
|:---:|:---|:---|:---|
| 2026 | Resolução CONSUP/IFPR nº 259, de 27 de novembro de 2025 (alterada pela nº 263/2025) | `ifpr/consup/res/2025/259` | `referencias/2026.md` |
| 2027 | Resolução CONSUP/IFPR nº 292, de 5 de outubro de 2026 | `ifpr/consup/res/2026/292` | `referencias/2027.md` |

A numeração dos artigos e a quantidade de incisos mudam de uma resolução para outra. Identifique o ano do calendário antes de citar qualquer dispositivo.

## Onde a skill roda

### No app Simplifica IF (ou com as ferramentas `ifpr`)

- Os arquivos da skill (`instrucoes.md`, `referencias/`) ficam na pasta desta skill; o calendário a verificar fica na pasta de trabalho.
- Leia o texto da resolução pelas ferramentas `ifpr`: `ler_dispositivos` com o ID do dispositivo (por exemplo, `ifpr/consup/res/2026/292#art11`), `buscar_norma` com a citação e `ficha_norma` para a vigência. Cite o link `ifpr://` devolvido.
- Não há comandos nem scripts: leia o PDF com a ferramenta de leitura de arquivos, que entrega as páginas para análise visual. Se a planilha `xlsx` não puder ser lida, peça ao usuário o calendário exportado em PDF.
- O resultado é o relatório em Markdown, gravado na pasta de trabalho com o nome indicado em `instrucoes.md`. O PDF do relatório não é gerado no app.

### Dentro do repositório

- Os arquivos da skill ficam em `.agents/skills/verificar-calendario/`, e o texto local das resoluções em `base-conhecimento/normas/ifpr/resolucoes/` (ou pela CLI `pnpm kb dispositivo`).
- Para orientação de uso por uma pessoa, leia também `.agents/skills/verificar-calendario/README.md`.
- O resultado é o par de arquivos: o relatório em Markdown e o PDF gerado a partir dele (requer `pnpm install` na raiz):

```text
node .agents/skills/verificar-calendario/scripts/render_relatorio_pdf.ts caminho/relatorio.md caminho/relatorio.pdf
```

## Uso

```text
/verificar-calendario caminho/para/calendario.xlsx
/verificar-calendario caminho/para/calendario.pdf
```

## O que faz

1. Identifica o ano do calendário e carrega `referencias/[ANO].md`, que aponta a resolução do ano (o ID na base e o texto local em `base-conhecimento/normas/ifpr/resolucoes/`).
2. Identifica o formato de entrada e escolhe o fluxo correto:
   - `xlsx`: leitura estrutural das planilhas.
   - `pdf`: inspeção visual das páginas (renderizadas em imagem no repositório; lidas pela ferramenta de leitura no app).
3. Verifica todos os incisos obrigatórios do artigo de itens do calendário (25 incisos do art. 7º em 2026; 26 incisos do art. 11 em 2027).
4. Valida os marcos obrigatórios do Art. 2º do ano.
5. Confere dias letivos anuais e semestrais e a janela do ano letivo.
6. Detecta inconsistências entre documentos complementares, como:
   - calendário principal x tabela de eventos;
   - resolução citada no documento x resolução vigente para o ano;
   - numeração de artigos ou quantidade de incisos da resolução anterior;
   - datas do ano corrente x sobras de anos anteriores.
7. Gera relatório em Markdown no formato de **tabela única**, com as colunas `Item`, `Status` e `Observação/Evidência`, copiando a tabela do arquivo de referência do ano.
8. Dentro do repositório, converte o relatório Markdown em PDF em orientação retrato, preservando a tabela completa com cabeçalho repetido e sem quebrar linhas no fim da página.
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

- Em PDF, a fonte primária deve ser a **análise visual das páginas**, e não a extração bruta do texto do arquivo.
- Se a página estiver densa, recortar por mês, bloco ou faixa antes de concluir a leitura (no app, olhar com atenção cada bloco da página e registrar o que ficou ilegível).
- Se existirem dois PDFs complementares, tratá-los como fontes distintas e fazer validação cruzada entre eles.

## Instruções completas

Antes de executar, leia `instrucoes.md`, na pasta desta skill (no repositório, `.agents/skills/verificar-calendario/instrucoes.md`).
