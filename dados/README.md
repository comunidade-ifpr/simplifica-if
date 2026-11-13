# Dados institucionais de origem

Fonte de verdade dos dados institucionais de gestão do IFPR, versionada no git. Os JSONs públicos de `base-conhecimento/institucional/ifpr/campi/` e `processos-seletivos/` são gerados a partir daqui por `scripts/exportar_base_publica.ts`.

- `institucional/`: campi, cursos (com PPC, SUAP e horários), processos seletivos, editais e ofertas, um arquivo por registro, com relações por chave canônica. Formato e regras em [Curadoria de metadados institucionais](../base-conhecimento/docs/curadoria-metadados-institucionais.md); schemas em `scripts/dados/institucional.ts`.
- `arquivo-notion/`: cópia somente leitura das bases do Notion sem consumidor no código (Pareceres de Curso e bases do Consepe), com propriedades e texto das páginas. Relações para registros migrados aparecem como `campus:<id>`, `curso:<campus_id>/<curso_slug>`, `processo:<id>` ou `edital:<id>`; as demais como `notion:<page_id>`.

Gerado pela migração única `scripts/migrar_notion_para_dados.ts` em 13/11/2026. Valide com `bun run scripts/validar_base.ts`.
