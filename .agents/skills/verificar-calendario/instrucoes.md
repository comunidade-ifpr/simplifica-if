# Instruções para Verificação de Calendário Acadêmico

> A base normativa depende do ano do calendário. Antes de qualquer verificação, identificar o ano e ler o arquivo de referência correspondente em `referencias/`, que indica a resolução vigente, o texto local da norma, a numeração dos artigos, as datas obrigatórias, a janela do ano letivo e a tabela obrigatória do relatório.

## Base normativa por ano

| Ano do calendário | Resolução de referência | Arquivo de referência da skill |
|:---:|:---|:---|
| 2026 | Resolução CONSUP/IFPR nº 259/2025 (alterada pela nº 263/2025) | `referencias/2026.md` |
| 2027 | Resolução CONSUP/IFPR nº 292/2026 | `referencias/2027.md` |

Se o calendário for de um ano sem arquivo de referência, não improvisar. Dentro do repositório, localizar a resolução de calendário de referência daquele ano em `base-conhecimento/manifest.json`, criar o arquivo `referencias/[ANO].md` seguindo a estrutura dos existentes e só então verificar; os textos das normas ficam em `base-conhecimento/normas/ifpr/resolucoes/`. No app, procurar a resolução com `buscar_norma` e, sem arquivo de referência, informar ao usuário que a skill ainda não cobre aquele ano.

A numeração dos artigos muda entre resoluções. Em 2026, o conceito de dia letivo está no art. 4º, § 2º, a janela do ano letivo no art. 5º e os itens obrigatórios no art. 7º (25 incisos). Em 2027, o conceito de dia letivo está no art. 5º, a janela no art. 8º e os itens obrigatórios no art. 11 (26 incisos). Nunca citar artigo ou inciso sem conferir no arquivo de referência do ano.

## Onde a skill roda

- **No app Simplifica IF (ou com as ferramentas `ifpr`):** não há comandos nem scripts. O texto da resolução vem das ferramentas `ifpr` (`ler_dispositivos` com o ID do dispositivo, `buscar_norma`, `ficha_norma`), citando o link `ifpr://`. O PDF do calendário é lido pela ferramenta de leitura de arquivos, que entrega as páginas para análise visual; uma planilha `xlsx` que não puder ser lida pede ao usuário o calendário exportado em PDF. O resultado é só o relatório em Markdown, gravado na pasta de trabalho; os passos de renderização com `pdftoppm` e de geração do PDF do relatório valem só no repositório.
- **Dentro do repositório:** os textos locais das resoluções, a renderização das páginas com `pdftoppm` e a geração do PDF do relatório pelo script da skill, como descrito abaixo.

## Objetivo

Verificar calendários acadêmicos do IFPR em `xlsx` ou `pdf`, com foco em conformidade normativa, consistência documental e qualidade da evidência apresentada.

Dentro do repositório, o resultado deve ser sempre um par de arquivos (no app, só o primeiro):

- relatório em Markdown;
- relatório em PDF retrato, gerado a partir do Markdown final.

Os artefatos devem ser suficientemente claros para subsidiar ajuste do calendário antes da aprovação.

## Princípio central para PDF

Quando a entrada for PDF, a leitura deve ser feita **pela imagem renderizada das páginas**. Não usar a extração embutida do PDF como fonte primária de verdade.

Fluxo esperado (no app, os passos 1 e 3 se fazem pela leitura do PDF com a ferramenta de leitura de arquivos, sem comandos):

1. Renderizar as páginas em PNG.
2. Inspecionar visualmente cada página.
3. Se a página estiver densa, recortar por mês, tabela ou faixa.
4. Registrar no relatório quando algum trecho permanecer ilegível.

Se a evidência visual não for suficiente para cravar um item, usar `EVIDÊNCIA INSUFICIENTE`, nunca `OK` por inferência frágil.

## Formatos suportados

### 1. XLSX

Fluxo tradicional com:

- planilha principal com calendário mensal e dias letivos;
- planilha de incisos/eventos;
- validação cruzada entre as duas.

### 2. PDF principal do calendário

Padrão mais comum:

- páginas em retrato;
- grade mensal com cores;
- listas de eventos por mês;
- legenda;
- quadro de dias letivos.

Este PDF substitui, na prática, a leitura visual da planilha principal.

### 3. PDF complementar de eventos/incisos

Padrão mais comum:

- páginas em paisagem;
- tabela corrida de itens obrigatórios;
- colunas de item, descrição, datas previstas e observações.

Este PDF costuma cumprir o papel da antiga “planilha 2”, mas pode estar desatualizado. Nunca assumir equivalência sem conferir:

- número e ano da resolução;
- artigo citado;
- quantidade e redação dos itens;
- datas do ano correto.

## Nomes de arquivos de relatório

Salvar o relatório Markdown como:

```text
relatorio_verificacao_[CAMPUS]_[ANO]_[FONTE]_[AAAAMMDDHHMMSS].md
```

Dentro do repositório, salvar o PDF com o mesmo nome-base, trocando apenas a extensão:

```text
relatorio_verificacao_[CAMPUS]_[ANO]_[FONTE]_[AAAAMMDDHHMMSS].pdf
```

Exemplos:

```text
relatorio_verificacao_Centro_de_Referencia_Ponta_Grossa_2026_pdf_principal_20260401153000.md
relatorio_verificacao_Centro_de_Referencia_Ponta_Grossa_2026_pdf_eventos_20260401153000.md
relatorio_verificacao_Irati_2026_xlsx_20260401153000.md
relatorio_verificacao_Centro_de_Referencia_Ponta_Grossa_2026_pdf_principal_20260401153000.pdf
```

## Geração obrigatória do PDF (dentro do repositório)

No app, este passo não existe: o relatório em Markdown é o resultado. Dentro do repositório, depois de concluir e revisar o relatório em Markdown, gerar obrigatoriamente a versão em PDF com o script da própria skill:

```bash
node .agents/skills/verificar-calendario/scripts/render_relatorio_pdf.ts caminho/relatorio.md caminho/relatorio.pdf
```

### Dependência

O script é TypeScript (Node) e usa o `pdfmake`, instalado com `pnpm install` na raiz do repositório. As fontes são Helvetica e Courier, padrão do PDF, sem arquivo embutido; elas cobrem os acentos do português. Caracteres fora da codificação WinAnsi (por exemplo, `≥` ou emoji) saem na fonte Roboto do próprio `pdfmake` ou como `■`: prefira escrever o status por extenso, sem emoji.

### Critérios de qualidade do PDF

- orientação retrato (`A4`);
- tabela integralmente renderizada;
- cabeçalho da tabela repetido na virada de página;
- nenhuma linha da tabela cortada no rodapé;
- conclusão preservada após a tabela, sem sobreposição.

## Procedimento comum a qualquer formato

1. Identificar no documento:
   - campus;
   - ano;
   - tipo de curso;
   - referência de aprovação;
   - resolução citada pelo próprio documento.
2. Ler o arquivo `referencias/[ANO].md` da skill e o texto da resolução que ele indica (no app, pelas ferramentas `ifpr`; no repositório, o texto local).
3. Confirmar se o documento está alinhado com a resolução de referência do ano.
4. Verificar se há sinais de material reaproveitado de outro ano:
   - menção ao ano anterior em datas, cabeçalhos ou tabelas;
   - resolução antiga (por exemplo, calendário de 2027 citando a Resolução nº 259/2025);
   - artigo/inciso com numeração da resolução anterior;
   - quantidade de incisos diferente da resolução do ano;
   - datas incompatíveis com o próprio cabeçalho.
5. Definir as fontes da validação:
   - fonte A: calendário mensal e quadro de dias letivos;
   - fonte B: tabela de itens/eventos, se existir.

## Fluxo para XLSX

### Estrutura esperada

#### Planilha principal

Contém:

- calendários mensais;
- detalhamento textual por mês;
- legenda de cores;
- quadro consolidado de dias letivos.

#### Planilha de incisos

Contém:

- relação dos incisos obrigatórios;
- datas e períodos previstos;
- eventuais observações.

### Regras de leitura

1. Ler cada seção mensal com contexto de mês.
2. Expandir intervalos:
   - `05 a 09` = 05, 06, 07, 08 e 09.
3. Contar períodos inclusivamente para férias e recessos.
4. Validar todos os intervalos de um inciso, não apenas o primeiro.
5. Se houver divergência entre planilha principal e planilha de incisos, reportar.

## Fluxo para PDF por visão

### Renderização

Dentro do repositório, preferencialmente usar `pdftoppm`. No app, ler o PDF com a ferramenta de leitura de arquivos.

Exemplo:

```bash
mkdir -p tmp/pdfs/meu-calendario
pdftoppm -r 170 -png caminho/para/arquivo.pdf tmp/pdfs/meu-calendario/pagina
```

Se a leitura ficar pequena:

- renderizar com resolução maior; ou
- recortar as imagens por faixa/mês.

### Estratégia de inspeção

#### PDF principal

Conferir visualmente:

- cabeçalho do calendário;
- mês a mês;
- listas de eventos;
- legenda;
- quadro “Dias Letivos”.

#### PDF complementar de eventos

Conferir visualmente:

- resolução citada no cabeçalho;
- artigo citado;
- correspondência com a resolução vigente;
- preenchimento das linhas obrigatórias;
- coerência do ano em todas as datas.

### Regra de ouro

No PDF, o agente deve priorizar o que está **legível na imagem**. Se um item não puder ser confirmado com segurança:

- marcar como `EVIDÊNCIA INSUFICIENTE`; e
- explicar o motivo.

## Eixos de validação

### 1. Dias letivos anuais

Verificar se o calendário prevê no mínimo 200 dias letivos anuais.

### 2. Dias letivos semestrais

Verificar se cada semestre atinge no mínimo 100 dias letivos.

Quando existir quadro consolidado, usá-lo como evidência visual. Se houver dúvida relevante, recortar o quadro e registrar os números observados.

### 3. Janela do ano letivo

Confirmar se o início e o término do ano letivo respeitam a janela e o prazo máximo de início definidos no arquivo de referência do ano.

### 4. Datas obrigatórias do Art. 2º

Conferir a presença dos feriados, recessos e demais marcos listados no arquivo de referência do ano.

Se houver data adicional municipal, tratar como acréscimo local, não como substituição das datas obrigatórias. O feriado escolar do Dia do Professor é o único que pode ser remanejado, e o remanejamento deve estar explícito.

### 5. Incisos obrigatórios

Validar todos os incisos do artigo de itens obrigatórios da resolução do ano, na quantidade e na redação indicadas no arquivo de referência, observando os requisitos críticos ali listados (férias docentes, limites de OBR e Mostra de Cursos, cargas mínimas de formação e planejamento, semanas temáticas).

### 6. Consistência entre documentos

Se houver mais de um arquivo para o mesmo calendário, validar:

- coerência entre datas do calendário principal e da tabela de eventos;
- coerência entre resolução citada e resolução vigente;
- coerência do ano civil;
- coerência dos artigos e incisos citados.

Regra adicional:

- se o documento complementar adotar outra resolução, outra quantidade de itens ou outra redação normativa, ele **não pode** ser aceito como substituto automático da tabela correspondente ao artigo de itens obrigatórios da resolução do ano, ainda que contenha algumas datas úteis.

## Tipos de inconsistência a reportar

- **Tipo A:** item aparece na tabela de incisos/eventos, mas não aparece no calendário principal.
- **Tipo B:** item aparece no calendário principal, mas não aparece na tabela de incisos/eventos.
- **Tipo C:** as duas fontes tratam o mesmo item com datas diferentes.
- **Tipo D:** documento complementar cita resolução, artigo ou ano incompatível com a base normativa vigente.
- **Tipo E:** evidência quantitativa insuficiente para horas mínimas, apesar de haver datas.

## Armadilhas recorrentes

1. PDF complementar herdado de ano anterior.
2. Cabeçalho com resolução antiga, mesmo quando o calendário mensal já foi atualizado.
3. Linha preenchida com ano incorreto, como `07/03/2026` em material de 2027.
4. Tabela com número de itens ou numeração de artigo da resolução anterior (por exemplo, 25 incisos do art. 7º em calendário de 2027, que exige os 26 incisos do art. 11).
5. Inferir horas mínimas de formação ou planejamento sem indicação explícita de carga horária.
6. Considerar item atendido apenas porque há uma linha ou um rótulo correspondente, sem conferir se o campo está efetivamente preenchido, no ano correto e compatível com a exigência normativa.

## Como julgar formação pedagógica e planejamento

Não presumir automaticamente a carga horária apenas pelo intervalo de datas.

Use:

- `ATENDE`, quando houver horas explícitas ou evidência institucional inequívoca;
- `ATENDE COM RESSALVAS`, quando o conjunto sugere atendimento, mas a carga horária não está claramente declarada;
- `NÃO ATENDE`, quando a evidência aponta insuficiência;
- `EVIDÊNCIA INSUFICIENTE`, quando não for possível confirmar.

## Estrutura obrigatória do relatório

```markdown
# Relatório de Verificação do Calendário Acadêmico [ANO]
## [Campus] - [Tipo/Fonte]

**Documento analisado:** [nome-do-arquivo]
**Formato:** [xlsx|pdf principal|pdf eventos]
**Método de leitura:** [estrutura do arquivo | análise visual das páginas renderizadas]
**Base normativa:** [resolução indicada no arquivo de referência do ano]
**Data da análise:** [DD/MM/AAAA]

[Tabela obrigatória copiada integralmente de `referencias/[ANO].md`]
```

## Regras de preenchimento da tabela

1. A tabela do arquivo de referência do ano é obrigatória e deve aparecer no relatório exatamente naquela ordem.
2. A coluna `Item` deve reproduzir integralmente os textos do arquivo de referência, sem adaptar a redação ou a numeração de outro ano.
3. A coluna `Status` deve usar apenas:
   - `ATENDE`
   - `NÃO ATENDE`
   - `ATENDE COM RESSALVAS`
   - `EVIDÊNCIA INSUFICIENTE`
4. A coluna `Observação/Evidência` nunca pode ficar vazia.
5. Mesmo quando o item `ATENDE`, a observação deve registrar a evidência concreta, por exemplo:
   - datas;
   - intervalos;
   - total de dias;
   - carga horária;
   - menção textual encontrada no documento;
   - comparação entre documentos.
6. Nunca marcar item como `ATENDE` apenas porque existe um título, uma linha na tabela ou um campo reservado. É obrigatório verificar se o conteúdo está preenchido, no ano correto e aderente à exigência normativa.
7. Quando o item `NÃO ATENDE`, a observação deve explicar objetivamente o motivo e apontar a ausência, divergência ou insuficiência.
8. Quando o item for `ATENDE COM RESSALVAS`, a observação deve separar o que foi encontrado do que permaneceu incompleto.
9. Quando o item for `EVIDÊNCIA INSUFICIENTE`, a observação deve dizer por que a comprovação não pôde ser feita, por exemplo:
   - imagem ilegível;
   - campo em branco;
   - documento complementar desatualizado;
   - falta de carga horária explícita.

## Critério final de julgamento

Ao concluir, responder às quatro perguntas abaixo:

1. O calendário está alinhado com a resolução de referência do ano?
2. As datas do ano letivo e os dias letivos atendem aos mínimos?
3. Todos os incisos obrigatórios da resolução do ano aparecem com evidência suficiente?
4. Existe coerência entre todos os documentos apresentados?

Se qualquer uma dessas respostas for “não”, isso deve ficar refletido nos status da tabela e nas respectivas observações/evidências.
