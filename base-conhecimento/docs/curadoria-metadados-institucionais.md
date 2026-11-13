# Curadoria de metadados institucionais

Este documento reúne as regras práticas para manter os metadados institucionais do IFPR e publicar os JSONs desta base.

## Fonte de verdade

Campi, cursos (com metadados de PPC e SUAP e horários dos campi), processos seletivos, editais e ofertas de ingresso têm como fonte os arquivos em `dados/institucional/`, versionados no git. Cada registro é um arquivo JSON cujo caminho é a chave canônica:

| Entidade | Arquivo | Chave |
|---|---|---|
| Campus | `dados/institucional/campi/<campus_id>.json` | `campus_id` |
| Curso | `dados/institucional/cursos/<campus_id>/<curso_slug>.json` | `campus_id/curso_slug` |
| Processo seletivo | `dados/institucional/processos-seletivos/<processo_seletivo_id>.json` | `processo_seletivo_id` |
| Edital | `dados/institucional/editais/<edital_id>.json` | `edital_id` |
| Oferta | `dados/institucional/ofertas/<processo_seletivo_id>/<oferta_id>.json` | `processo_seletivo_id/oferta_id` |

Relações usam essas chaves, nunca IDs de página do Notion: `cursos[].campus_id`, `editais[].processos`, `ofertas[].campi`, `ofertas[].cursos` (`campus_id/curso_slug`) e `ofertas[].editais`. O campo `notion_page_id` é só referência histórica da migração e continua publicado enquanto o schema público o exigir. Os formatos estão em `scripts/dados/institucional.ts` (schemas zod).

`Movimentações de Cursos` é a única base institucional que continua no Notion; veja [Operação do Notion por agentes](notion-operacao-agentes.md). Pareceres de Curso e as bases do Consepe foram arquivados em `dados/arquivo-notion/`, somente para consulta.

Os JSONs em `base-conhecimento/institucional/ifpr/campi/` e `base-conhecimento/institucional/ifpr/processos-seletivos/` são artefatos públicos gerados. Não os edite: altere o registro em `dados/institucional/` e publique.

## Como alterar e publicar

1. Edite ou crie o registro em `dados/institucional/`. Campo vazio é campo ausente: não grave `""` nem `null`.
2. Registre a evidência no próprio registro quando houver campo para isso (`trecho_vagas`, `trecho_fonte`, `ppc.observacoes`) e atualize as datas de coleta ou curadoria.
3. Valide e publique:

```bash
bun run scripts/validar_base.ts
bun run scripts/exportar_base_publica.ts
bun run scripts/gerar_indice_ppcs.ts
bun run scripts/validar_base.ts
bun run scripts/gerar_site.ts
```

`validar_base.ts` confere schema, caminho de cada arquivo e as regras da auditoria institucional (chaves únicas, relações existentes, caminho esperado do PPC, URLs HTTPS). `exportar_base_publica.ts` lê `dados/institucional/` e, do Notion, só as movimentações; por isso precisa de `NOTION_TOKEN`.

Ao criar um curso novo, use `curso_slug` em minúsculas com hífens, único no campus, e não preencha `notion_page_id`.

## Organização da base

Use `docs/` apenas para documentação de apoio à manutenção e curadoria. Conteúdos destinados à consulta pública devem ficar na coleção temática correspondente, como `normas/`, `catalogos/`, `institucional/ifpr/referencias/`, `institucional/ifpr/campi/` ou `institucional/ifpr/processos-seletivos/`.

Para referências institucionais transversais do IFPR que não sejam cadastro de campus, PPC ou processo seletivo, use `institucional/ifpr/referencias/` e atualize o índice da coleção quando necessário.

## Cursos

Cada arquivo em `dados/institucional/cursos/` representa uma oferta de curso em um campus.

Ao pesquisar cursos em páginas dos campi:

1. Prefira fontes oficiais do IFPR.
2. Quando existir, use a origem `https://ifpr.edu.br/<campus_id>/`.
3. Em sites WordPress do IFPR, use a REST API para localizar páginas: `https://ifpr.edu.br/<campus_id>/wp-json/wp/v2/pages?per_page=100`.
4. Use a página oficial do curso para preencher `nome`, `nivel`, `forma_oferta`, `modalidade`, `situacao` e `pagina_oficial`.
5. Não cadastre páginas auxiliares, notícias, páginas históricas ou ofertas temporárias como cursos ativos sem evidência clara de vigência atual.
6. Para FIC e programas institucionais, preserve a distinção entre curso regular, oferta temporária e programa.

## SUAP

Os metadados administrativos do SUAP ficam no objeto `suap` do curso: `id`, `codigo`, `vagas`, `coletado_em`, `atualizado_em` e `matrizes`.

No JSON público, esses dados aparecem em `cursos[].suap`. `cursos[].suap.vagas` representa vagas cadastradas no sistema acadêmico. Não confunda com:

- `cursos[].ppc.metadados.vagas`, que vem do PPC;
- `processos-seletivos[].ofertas[].vagas`, que vem de edital de ingresso.

Para relatórios brutos do SUAP com coluna `DIRETORIA`, use `institucional/ifpr/referencias/suap-diretorias.json` como apoio para associar diretoria a `campus_id`.

### Matrizes e cargas horárias

A coleta consulta todos os cursos com `suap.id`, usando três sessões simultâneas e cookies somente em memória. A coleta é somente leitura no SUAP; a gravação nos arquivos dos cursos é uma etapa explícita separada.

```bash
bun run scripts/suap_coletar_matrizes.ts
bun run scripts/suap_coletar_matrizes.ts --apply-report tmp/suap-matrizes/resultado.json
```

Para restringir a consulta, use `--suap-id 211` (repetível). O relatório identifica cada curso por `curso_id` (`campus_id/curso_slug`), e a gravação confere `suap.id` e `suap.codigo` antes de escrever. Depois de gravar, publique com os comandos acima.

Campos gravados em `suap.matrizes`:

- `resumo`: IDs, descrições, carga exibida e informação de estágio de todas as matrizes marcadas `Ativa = Sim`;
- `urls`: uma URL direta por matriz ativa (`https://suap.ifpr.edu.br/edu/matriz/<id>/`);
- `carga_horaria_comum_h`: carga do cabeçalho da matriz, só quando todas as ativas exibem o mesmo valor;
- `situacao`: `Única ativa`, `Múltiplas — mesma CH`, `Múltiplas — CH divergentes` ou `Sem matriz ativa`;
- `coletado_em`: momento da consulta das matrizes.

`Ativa = Sim` não comprova vigência para novos ingressos. Não selecione automaticamente a matriz de maior ID ou mais recente. Estágio e extensão devem ser conferidos separadamente: a rotina preserva o cabeçalho de carga horária e a carga mínima de estágio informada, sem somá-los.

## Horários de aula

Registre a fonte principal de horários no arquivo do campus. Como a informação muda por período letivo, preencha sempre `horarios_coletado_em`.

- `horarios_url`, quando houver uma fonte confiável;
- `horarios_coletado_em`, sempre que a busca for revisada.

Aceite fontes externas, como Google Sheets ou Edupage, somente quando forem apontadas pelo site oficial do campus. Não use horário de atendimento, monitorias, ônibus, laboratórios ou secretaria como substituto de horário das aulas.

## PPCs

Quando a página oficial do curso indicar o Projeto Pedagógico de Curso, registre o PPC vigente no objeto `ppc` do curso.

**Política de versão: a base guarda só o PPC vigente de cada curso.** Quando o curso ganha PPC novo (por exemplo, nas reformulações exigidas pelo art. 71 da Res. CNE/CP nº 2/2026), atualize `ppc.url`, reconverta e substitua o Markdown no mesmo caminho. A versão anterior continua recuperável pelo histórico do git (`git log --follow -- base-conhecimento/<markdown_path>` e `git show <commit>:base-conhecimento/<markdown_path>`); o `conversao_commit` do front matter aponta o commit de cada conversão reconstruída. Por isso o ID do PPC não tem versão: é `ppc:<campus_id>/<curso_slug>`. PPCs históricos relevantes para a gestão ficam documentados nas movimentações e nas evidências SEI.

Regras:

1. Use como fonte primária a página oficial do curso.
2. Aceite documentos descritos como PPC, Projeto Pedagógico do Curso, Projeto Político Pedagógico do Curso ou Plano de Curso equivalente.
3. Não use matriz curricular, edital, resolução, formulário, manual, notícia ou documento auxiliar como substituto de PPC.
4. Quando houver mais de um PPC, registre como vigente o documento mais recente ou explicitamente marcado como vigente.
5. Registre `ppc.url` com HTTPS absoluto.
6. Registre `ppc.markdown_path` quando o PPC convertido existir, no formato `institucional/ifpr/ppcs/<campus_id>/<curso_slug>.md`.
7. Registre `ppc.ano_documento` e `ppc.vagas` somente com evidência textual (`ppc.trecho_vagas`, `ppc.observacoes`) e status de curadoria (`ppc.curadoria`, `ppc.data_curadoria`).

`ppc.vagas` é texto: use número simples, como `40`, ou intervalo, como `20-40`. A publicação normaliza esses dados em `ppc.metadados.vagas`.

Hoje `ppc.curadoria` e `ppc.data_curadoria` valem ao mesmo tempo para o ano do documento e para as vagas. Não marque o PPC como revisado quando só um dos dois foi conferido; registre a conferência parcial em `ppc.observacoes`.

Para converter PDFs em Markdown, use `scripts/converter_ppcs_markdown.py`. Depois de converter ou alterar PPCs, regenere os índices:

```bash
bun run scripts/gerar_indice_ppcs.ts
bun run scripts/validar_base.ts
```

### Proveniência do PPC convertido

Todo PPC em `institucional/ifpr/ppcs/<campus_id>/<curso_slug>.md` começa com front matter YAML (contrato em `packages/kb/src/ppcs/front-matter.ts`):

| Campo | Conteúdo |
|---|---|
| `id` | `ppc:<campus_id>/<curso_slug>` |
| `fonte_url` | URL do arquivo convertido; deve ser igual ao `ppc.url` vigente |
| `fonte_sha256` | SHA-256 dos bytes baixados, ou `desconhecido` |
| `convertido_em` | data da conversão (AAAA-MM-DD) |
| `conversor` | script, versões do `pymupdf4llm` e do PyMuPDF e uso de OCR, ou `desconhecido` |
| `proveniencia` | `registrada` (gravada pelo conversor) ou `reconstruida` (preenchida depois) |
| `conversao_commit`, `pos_processamento_commits`, `nota_proveniencia` | só na reconstruída: commit da conversão, commits de limpeza posteriores e o motivo do que ficou `desconhecido` |

O conversor grava a proveniência `registrada` em toda conversão nova. Os 202 PPCs convertidos antes de 13/11/2026 têm proveniência `reconstruida` pelo histórico do git: `convertido_em` é a data do commit em que o texto entrou na base, e `fonte_url` é o `ppc.url` do campus JSON nesse commit. O hash e a versão do conversor ficaram `desconhecido`, porque o PDF da época não foi guardado e o PDF baixado hoje não prova ser o mesmo; não os preencha à mão. Ao reconverter um PPC, a proveniência passa a `registrada`.

`validar_base.ts` acusa PPC sem front matter, `id` fora do caminho e `fonte_url` diferente do `ppc.url` vigente: se o curso trocou de PPC, reconverta (ou, se só a URL mudou de endereço, confira o documento e reconverta mesmo assim, para registrar o hash).

Quem lê o Markdown por código deve ignorar o front matter: `corpoPpc` e `mascararFrontMatter` (que mantém os números de linha) estão no mesmo módulo.

## Movimentações e SEI

`Movimentações de Cursos` continua no Notion e registra processos administrativos do histórico do curso, como abertura, ajuste, atualização, suspensão, reversão de suspensão ou extinção. As regras de preenchimento e a sincronização com o SEI estão em [Operação do Notion por agentes](notion-operacao-agentes.md) e [Sincronização SEI → Notion](sincronizacao-sei-notion.md).

Quando uma movimentação mudar a situação do curso, atualize `situacao` no arquivo do curso em `dados/institucional/` e publique.

## Processos seletivos

Use:

- `processos-seletivos/` para a campanha ou ano de ingresso;
- `editais/` para cada edital, com `processos` apontando para o processo seletivo;
- `ofertas/<processo_seletivo_id>/` para cada oferta de vagas.

Regras:

1. Não registre vagas de processo seletivo dentro do cadastro do curso.
2. Sempre que possível, relacione a oferta ao curso (`cursos`) e ao campus (`campi`). Sem curso cadastrado, preencha `campus_id_original` e `curso_slug_original` com o que o edital informa.
3. Preserve a fonte oficial do edital ou anexo em `url_fonte`.
4. Use `trecho_fonte` para evidenciar a quantidade de vagas.
5. Quando houver cotas, registre total e detalhamento.

## Índices globais de PPCs

A coleção `institucional/ifpr/ppcs/` contém PPCs convertidos e índices derivados:

- `institucional/ifpr/ppcs/index.json` (schema `ppcs_index`, versão 2): um item por PPC, com `taxonomia` e o resumo da proveniência;
- `institucional/ifpr/ppcs/secoes/<tipo>.jsonl` (schema `ppcs_secao`): uma linha por seção, com `preview` (500 primeiros caracteres do texto limpo), `linha_inicio` e `linha_fim` no arquivo `.md` (contadas desde 1, com o front matter), `heading`, `numeracao` e `origem_tipo`.

**Texto integral fora do git.** O git guarda só preview e linhas: o texto integral das seções duplicaria o dos PPCs (cerca de 64 MB) e incharia o histórico e o `site/` a cada regeneração. Quem precisar dele lê as linhas do próprio Markdown, com `lerTextoSecao` (`packages/kb/src/ppcs/citacoes.ts`) ou `textoDaSecao` (`packages/kb/src/ppcs/secoes.ts`). O texto integral indexado vai para o `kb.sqlite` da fase 6, derivado e fora do git.

Esses arquivos são gerados automaticamente por `scripts/gerar_indice_ppcs.ts` (lógica em `packages/kb/src/ppcs/secoes.ts`). Não os edite manualmente; ajuste o registro em `dados/institucional/` ou o Markdown convertido e rode novamente os comandos de publicação.

**Taxonomia por nível.** Cursos de nível médio usam a taxonomia `tecnico`, em que cada tipo aponta os incisos do art. 28 da Res. CNE/CP nº 2/2026 que cobre (`identificacao` I, `formato_oferta` II, `justificativa` e `objetivos` III, `requisitos_acesso` IV, `acessibilidade_inclusao` V, `perfil_egresso` VI, `itinerario_formativo` VII, `carga_horaria` VIII, `organizacao_curricular` e `matriz_curricular` IX, `aproveitamento_estudos` X, `avaliacao` XI, `infraestrutura` XII, `mundo_trabalho` XIII, `corpo_docente` XIV, `certificados_diplomas` XV, `prazo_integralizacao` XVI, `estagio_praticas` XVII, `acompanhamento_egresso` XVIII e § 4º), mais tipos do modelo do IFPR sem inciso próprio. Graduação, pós-graduação e FIC usam a taxonomia `geral`, sem os tipos próprios do art. 28 e com `contexto_institucional` e `atividades_complementares`. A lista completa, com rótulos e incisos, fica em `secoes.taxonomias` do índice.

**Como o tipo é decidido.** Cabeçalhos de página ("Campus Curitiba do IFPR", "PROENS") não abrem seção, e rótulos internos ("EMENTA:", "Bibliografia básica", "1º ano") ficam no texto da seção. No ementário, cada "Componente curricular: …" abre uma seção. O tipo vem das regras sobre o título (`origem_tipo: titulo`); sem regra, herda do título numerado ancestral (`numeracao`) ou da seção anterior (`contexto`). O que vem antes do primeiro título numerado é `pretextual`, e tudo depois do primeiro anexo é `anexos`. `pretextual` e `outros` (não classificado) não ganham arquivo. Seções com menos de 40 caracteres de texto ficam fora do índice.
