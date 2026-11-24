# Base de Conhecimento do IFPR

A base reúne normas, legislação, resoluções, portarias, metadados institucionais, PPCs, catálogos e outros documentos de referência usados em análises relacionadas ao IFPR. Ela alimenta o Simplifica IF, app desktop que a entrega, com tarefas prontas, à IA de cada servidor; o app e a base ficam no mesmo repositório.

> Aviso: esta base é uma curadoria operacional. Para decisões administrativas, jurídicas ou acadêmicas, confira sempre a publicação oficial indicada no campo `fonte_url` (ou, sem link, em `fonte_referencia`) de cada documento.

## Como consultar

A base é lida pelo app, pelo servidor MCP `simplifica-mcp` (ferramentas `ifpr`; instruções em [`packages/mcp/instrucoes.md`](../packages/mcp/instrucoes.md)) e, dentro do repositório, pela CLI `kb` (`pnpm kb`; comandos no [`packages/kb/README.md`](../packages/kb/README.md#cli)). Os três leem o banco `kb.sqlite`, compilado destes arquivos. Toda resposta traz o arquivo e a linha de onde o texto veio; abra esse Markdown antes de citar.

## PPCs convertidos

Os Projetos Pedagógicos de Curso (PPCs) do IFPR estão convertidos para Markdown em `institucional/ifpr/ppcs/`, como repertório institucional para consulta, comparação e apoio à elaboração ou revisão de PPCs. O índice de PPCs (`institucional/ifpr/ppcs/index.json`) e os índices de seções por tipo (`institucional/ifpr/ppcs/secoes/*.jsonl`, com as linhas de cada seção no Markdown) são gerados por `gerar_indice_ppcs.ts` e compilados no banco.

Cada PPC começa com front matter de proveniência (`id: ppc:<campus>/<curso>/<versao>`, ano do documento com o trecho que o comprova, URL de origem, hash do arquivo-fonte, data e versão do conversor). PPC sem o ano comprovado não entra: fica fora da base publicada, em `curadoria/pendencias/` na raiz do repositório. Todo PPC que entra na base fica nela, com esse ID permanente: o PPC novo de um curso entra como versão nova (`institucional/ifpr/ppcs/<campus>/<curso>/<versao>.md`, a versão é o ano do documento), o registro do curso passa a apontá-lo como vigente, e o anterior fica, substituído. As consultas usam o PPC vigente, salvo pedido dos substituídos. Um PPC novo entra a partir do DOCX enviado pela coordenação do curso, sem dados pessoais (passo a passo em [Curadoria de metadados institucionais](docs/curadoria-metadados-institucionais.md)); PDF não é convertido.

Ao usar PPCs como apoio para redigir ou revisar textos, diferencie exemplos observados em PPCs de obrigações normativas. Para fundamentação regulatória, combine os PPCs com as normas da base e, quando se tratar de curso técnico, com o CNCT.

## Manutenção

A partir da raiz do projeto unificado:

```bash
node scripts/gerar_base.ts
node scripts/gerar_indice_ppcs.ts
node scripts/validar_base.ts
```

## Documentos de apoio à manutenção

- [Curadoria de metadados institucionais](docs/curadoria-metadados-institucionais.md)
- [Padrão de front matter para legislação](docs/padrao-front-matter-legislacao.md)

## Estrutura

Esta é a raiz lógica da base. No projeto unificado ela fica em `base-conhecimento/`.

- `normas/`: leis, resoluções, portarias, notas técnicas e compilações, organizadas por jurisdição e tipo documental.
- `institucional/ifpr/`: registros institucionais, um JSON por registro (`campi/`, `cursos/`, `processos-seletivos/`, `editais/`, `ofertas/`, `conselhos/`).
- `institucional/ifpr/ppcs/`: PPCs convertidos para Markdown e índices globais de PPCs e seções.
- `catalogos/`: catálogos estruturados, como o CNCT.
- `revisao-ppc/`: as fichas (critérios) da tarefa "Revisar um PPC" do app, com a taxonomia de tópicos e os marcos normativos ([README](revisao-ppc/README.md)).
- `schemas/`: JSON Schemas dos manifestos e índices, aplicados pelo `validar_base.ts`.
- `docs/`: documentação de apoio à manutenção e curadoria da base, não conteúdo principal da base de conhecimento.
- `docs/padrao-front-matter-legislacao.md`: contrato de metadados.

## Licença

Conteúdo curatorial publicado sob CC BY 4.0. Textos normativos oficiais podem estar sujeitos ao regime próprio de documentos públicos; mantenha atribuição e consulte as fontes oficiais.
