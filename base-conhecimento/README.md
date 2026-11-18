# Base de Conhecimento do IFPR

A base reúne normas, legislação, resoluções, portarias, metadados institucionais, PPCs, catálogos e outros documentos de referência usados em análises relacionadas ao IFPR. Ela alimenta o Simplifica IF, app desktop que a entrega, com tarefas prontas, à IA de cada servidor; o app e a base ficam no mesmo repositório.

> Aviso: esta base é uma curadoria operacional. Para decisões administrativas, jurídicas ou acadêmicas, confira sempre a publicação oficial indicada no campo `fonte` de cada documento.

## Como consultar

A base é lida pelo app, pelo servidor MCP `simplifica-mcp` (ferramentas `ifpr`; instruções em [`packages/mcp/instrucoes.md`](../packages/mcp/instrucoes.md)) e, dentro do repositório, pela CLI `kb` (`pnpm kb`; comandos no [`AGENTS.md`](../AGENTS.md#consulta-local-da-base)). Os três leem o banco `kb.sqlite`, compilado destes arquivos. Toda resposta traz o arquivo e a linha de onde o texto veio; abra esse Markdown antes de citar.

## PPCs convertidos

Os Projetos Pedagógicos de Curso (PPCs) do IFPR estão convertidos para Markdown em `institucional/ifpr/ppcs/`, como repertório institucional para consulta, comparação e apoio à elaboração ou revisão de PPCs. O índice de PPCs (`institucional/ifpr/ppcs/index.json`) e os índices de seções por tipo (`institucional/ifpr/ppcs/secoes/*.jsonl`, com as linhas de cada seção no Markdown) são gerados por `gerar_indice_ppcs.ts` e compilados no banco.

Cada PPC começa com front matter de proveniência (`id: ppc:<campus>/<curso>`, URL de origem, hash do arquivo-fonte, data e versão do conversor). A base guarda só o PPC vigente de cada curso; versões anteriores ficam no histórico do git. Um PPC novo entra a partir do DOCX enviado pela coordenação do curso, sem dados pessoais (passo a passo em [Curadoria de metadados institucionais](docs/curadoria-metadados-institucionais.md)); PDF não é convertido.

Ao usar PPCs como apoio para redigir ou revisar textos, diferencie exemplos observados em PPCs de obrigações normativas. Para fundamentação regulatória, combine os PPCs com as normas da base e, quando se tratar de curso técnico, com o CNCT.

## PPCPs da Rede Certifica

A coleção `institucional/ifpr/ppcps/` reúne a pesquisa comparada e a proposta de modelo institucional de Projeto Pedagógico de Certificação Profissional para o IFPR:

- [Pesquisa comparada de PPCPs](institucional/ifpr/ppcps/pesquisa-comparada-ppcps-rede-certifica.md)
- [Proposta de PPCP para revisão institucional](institucional/ifpr/ppcps/proposta-ppcp-rede-certifica-ifpr.md)

A proposta é preenchível e não autoriza oferta. Cada perfil profissional exige PPCP específico, análise do CONSEPE, aprovação do CONSUP e cadastro no SISTEC.

## Manutenção

A partir da raiz do projeto unificado:

```bash
node scripts/gerar_base.ts
node scripts/gerar_indice_ppcs.ts
node scripts/validar_base.ts
```

## Documentos institucionais de referência

- [Matriz orçamentária da Rede Federal](institucional/ifpr/referencias/matriz-orcamentaria-rede-federal.md)

## Documentos de apoio à manutenção

- [Curadoria de metadados institucionais](docs/curadoria-metadados-institucionais.md)
- [Operação do Notion por agentes](docs/notion-operacao-agentes.md)
- [Padrão de front matter para legislação](docs/padrao-front-matter-legislacao.md)

## Estrutura

Esta é a raiz lógica da base. No projeto unificado ela fica em `base-conhecimento/`.

- `normas/`: leis, resoluções, portarias, notas técnicas e compilações, organizadas por jurisdição e tipo documental.
- `institucional/ifpr/`: registros institucionais, um JSON por registro (`campi/`, `cursos/`, `processos-seletivos/`, `editais/`, `ofertas/`, `conselhos/`), e notas de referência (`referencias/`).
- `institucional/ifpr/ppcs/`: PPCs convertidos para Markdown e índices globais de PPCs e seções.
- `institucional/ifpr/ppcps/`: pesquisa comparada e proposta de PPCP para a Rede Certifica.
- `catalogos/`: catálogos estruturados, como o CNCT.
- `manifest.json`: índice das normas, gerado do front matter e lido pelo kb.
- `institucional_manifest.json` e `catalogos_manifest.json`: manifestos das coleções institucionais e dos catálogos, passados aos sub-agentes da `revisar-ppc`.
- `schemas/`: JSON Schemas dos manifestos e índices, aplicados pelo `validar_base.ts`.
- `docs/`: documentação de apoio à manutenção e curadoria da base, não conteúdo principal da base de conhecimento.
- `docs/padrao-front-matter-legislacao.md`: contrato de metadados.

## Licença

Conteúdo curatorial publicado sob CC BY 4.0. Textos normativos oficiais podem estar sujeitos ao regime próprio de documentos públicos; mantenha atribuição e consulte as fontes oficiais.
