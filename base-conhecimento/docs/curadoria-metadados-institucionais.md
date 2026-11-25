# Curadoria de metadados institucionais

Este documento reúne as regras práticas para manter os metadados institucionais do IFPR e publicar os JSONs desta base.

## Fonte de verdade

Campi, cursos (com metadados de PPC e SUAP e horários dos campi), processos seletivos, editais e ofertas de ingresso têm como fonte os registros em `base-conhecimento/institucional/ifpr/`, versionados no git e publicados como estão. Cada registro é um arquivo JSON cujo caminho é a chave canônica:

| Entidade | Arquivo (em `institucional/ifpr/`) | Chave |
|---|---|---|
| Campus | `campi/<campus_id>.json` | `campus_id` |
| Curso | `cursos/<campus_id>/<curso_slug>.json` | `campus_id/curso_slug` |
| Processo seletivo | `processos-seletivos/<processo_seletivo_id>.json` | `processo_seletivo_id` |
| Edital | `editais/<edital_id>.json` | `edital_id` |
| Oferta | `ofertas/<processo_seletivo_id>/<oferta_id>.json` | `processo_seletivo_id/oferta_id` |

Relações usam essas chaves: `cursos[].campus_id`, `editais[].processos`, `ofertas[].campi`, `ofertas[].cursos` (`campus_id/curso_slug`) e `ofertas[].editais`. Os formatos estão em `scripts/dados/institucional.ts` (Effect Schema, estrito: campo a mais é erro).

As coleções não têm índice: o kb lê os registros direto.

As reuniões do Consepe estão em `institucional/ifpr/conselhos/` (veja [Conselhos](#conselhos)). Pareceres de Curso, Servidores e Conselheiros não fazem parte do repositório.

## Como alterar e publicar

1. Edite ou crie o registro em `base-conhecimento/institucional/ifpr/`. Campo vazio é campo ausente: não grave `""` nem `null`. URL pré-assinada (com `AWSAccessKeyId`, `Signature`, `X-Amz-*`, como as do S3 do SUAP) não entra: grave o endereço sem a query string, ou, se o arquivo for privado sem a assinatura (anexo do SUAP), deixe `ppc.url` vazio com nota em `ppc.observacoes` até achar o PDF público.
2. Registre a evidência no próprio registro quando houver campo para isso (`trecho_vagas`, `trecho_fonte`, `ppc.observacoes`) e atualize as datas de coleta ou curadoria.
3. Regenere os índices e valide:

```bash
node scripts/gerar_base.ts
node scripts/validar_base.ts
```

`validar_base.ts` confere schema, caminho de cada arquivo e as regras da auditoria institucional (chaves únicas, relações existentes, caminho esperado do PPC e o Markdown existente, URLs HTTPS), o índice dos campi e que os arquivos gerados estão em dia com o `gerar_base.ts`.

Ao criar um curso novo, use `curso_slug` em minúsculas com hífens, único no campus.

## Organização da base

Use `docs/` apenas para documentação de apoio à manutenção e curadoria. Conteúdos destinados à consulta pública devem ficar na coleção temática correspondente, como `normas/`, `catalogos/` ou as coleções de registros institucionais (`institucional/ifpr/campi/`, `cursos/`, `processos-seletivos/`, `editais/`, `ofertas/`, `conselhos/`).

## Dados pessoais e URLs internas

A base é pública. A regra fica em `packages/kb/src/ppcs/dados-pessoais.ts`, com os casos de teste em `dados-pessoais.casos.json`; o `validar_base.ts` aplica a regra a todo arquivo de `base-conhecimento/` e recusa o que ela acharia, com só as contagens na mensagem. A importação de PPC (`importar_ppc_docx.ts`) aplica a mesma limpeza ao texto convertido.

São omitidos, com o rótulo e o resto da frase mantidos:

- CPF → `[CPF omitido]`: o número depois do rótulo `CPF` (inclusive com `|` ou `<br>` no meio, como em célula de tabela) e o `000.000.000-00` sem rótulo com dígito verificador válido;
- RG → `[RG omitido]`: o número depois de `RG`, `R.G.`, `R.G`, `Registro Geral`, `cédula`/`carteira`/`doc. de identidade` ou `Identidade:`, com UF (`MG-12.345.678`) ou grupos separados por espaço; `RG/CPF:` com dois números vira os dois marcadores;
- celular → `[telefone omitido]`: 9 dígitos começando por 9, com DDD (com ou sem parênteses, `+55`) ou, sem DDD, com separador;
- matrícula de estudante → `[matrícula omitida]`: 11 dígitos começando pelo ano (`20xx…`);
- SIAPE → `[SIAPE omitido]`: o número depois do rótulo `SIAPE` e os números da coluna `SIAPE` de tabela Markdown.

Ficam: o nome de pessoa em ato oficial, quadro docente ou declaração; e-mail institucional; telefone fixo; endereço e contato de campus e de parceiros. Não são CPF nem RG: onze dígitos soltos (IDs do Lattes e ISBN partidos pela conversão), número de até 4 dígitos depois de `RG` (um ano) e `R.G.` depois de iniciais de autor em referência bibliográfica (`JORDÃO, R.G. 2010`). E-mail particular não tem regra automática: tire à mão.

Também não entram, e o `validar_base.ts` recusa: URL pré-assinada (`AWSAccessKeyId`, `Signature`, `X-Amz-*`; grave sem a query string), link de planilha do Google (`docs.google.com/spreadsheets`; o texto da referência fica sem o link, salvo o `horarios_url` de um campus, grade pública apontada pelo site oficial) e parâmetros de sessão do SEI (`infra_hash`, `infra_sistema`, `infra_unidade_atual`; o `hash_download` da autenticação pública fica).

## Cursos

Cada arquivo em `institucional/ifpr/cursos/` representa uma oferta de curso em um campus.

Ao pesquisar cursos em páginas dos campi:

1. Prefira fontes oficiais do IFPR.
2. Quando existir, use a origem `https://ifpr.edu.br/<campus_id>/`.
3. Em sites WordPress do IFPR, use a REST API para localizar páginas: `https://ifpr.edu.br/<campus_id>/wp-json/wp/v2/pages?per_page=100`.
4. Use a página oficial do curso para preencher `nome`, `nivel`, `forma_oferta`, `modalidade`, `situacao` e `pagina_oficial`.
5. Em curso técnico (nível `médio`), registre a habilitação do CNCT em `cnct_id`, no formato `cnct:<id>` com o `id` de `catalogos/cnct/index.json` (por exemplo, `cnct:tecnico-em-enfermagem`). O casamento é pela denominação: "Administração – PROEJA" e "Técnico em Administração" são `cnct:tecnico-em-administracao`. Se o curso não tem habilitação no CNCT, como uma oferta experimental, não invente: grave `cnct_ausencia` com o motivo e a evidência (por exemplo, a seção do PPC que declara a oferta experimental). Os dois campos são excludentes. A auditoria acusa curso técnico ativo ou em oferta sem nenhum dos dois, e `validar_base.ts` acusa `cnct_id` que não existe no catálogo.
6. Não cadastre páginas auxiliares, notícias, páginas históricas ou ofertas temporárias como cursos ativos sem evidência clara de vigência atual.
7. Para FIC e programas institucionais, preserve a distinção entre curso regular, oferta temporária e programa.

## SUAP

Os metadados administrativos do SUAP ficam no objeto `suap` do curso: `id`, `codigo`, `vagas`, `coletado_em`, `atualizado_em` e `matrizes`.

No registro do curso, esses dados ficam em `suap`. `suap.vagas` representa vagas cadastradas no sistema acadêmico. Não confunda com:

- `cursos[].ppc.metadados.vagas`, que vem do PPC;
- `processos-seletivos[].ofertas[].vagas`, que vem de edital de ingresso.

### Matrizes e cargas horárias

As matrizes chegam à base por um relatório de coleta (veja [Dado coletado fora do repositório](#dado-coletado-fora-do-repositório)). A coleta, somente leitura no SUAP, roda fora deste repositório e não grava nos registros; a aplicação do relatório é uma etapa explícita separada.

```bash
node scripts/aplicar_matrizes_suap.ts <relatório.json>           # lista as mudanças
node scripts/aplicar_matrizes_suap.ts <relatório.json> --apply
```

O relatório identifica cada curso por `curso_id` (`campus_id/curso_slug`), `suap_id` e `codigo`, e a aplicação confere `suap.id` e `suap.codigo` de todos antes de gravar. Depois de gravar, siga o pipeline da seção abaixo.

Campos gravados em `suap.matrizes`:

- `resumo`: IDs, descrições, carga exibida e informação de estágio de todas as matrizes marcadas `Ativa = Sim` (ausente quando não há nenhuma);
- `urls`: uma URL direta por matriz ativa (`https://suap.ifpr.edu.br/edu/matriz/<id>/`);
- `carga_horaria_comum_h`: carga do cabeçalho da matriz, só quando todas as ativas exibem o mesmo valor;
- `situacao`: `Única ativa`, `Múltiplas — mesma CH`, `Múltiplas — CH divergentes` ou `Sem matriz ativa`;
- `coletado_em`: momento da coleta que mudou as matrizes por último (uma coleta sem mudança não o atualiza).

`resumo`, `urls`, `carga_horaria_comum_h` e `situacao` são calculados na aplicação, a partir das matrizes brutas do relatório (`scripts/dominio/matriz-suap.ts`).

`Ativa = Sim` não comprova vigência para novos ingressos. Não selecione automaticamente a matriz de maior ID ou mais recente. Estágio e extensão devem ser conferidos separadamente: a rotina preserva o cabeçalho de carga horária e a carga mínima de estágio informada, sem somá-los.

## Dado coletado fora do repositório

Dado que vem de sistema com login (hoje, as matrizes do SUAP) é coletado por ferramenta que não grava na base. Ela entrega um **relatório de coleta** em JSON, e um comando `aplicar_*` daqui o confere e o aplica nos registros. A entrada de PPC novo pelo DOCX da coordenação (`importar_ppc_docx.ts`, em "Entrada de PPC novo na base") é outro caminho: a entrada dela é o documento, não um relatório.

O relatório traz:

- `esquema`: o nome e a versão do formato (por exemplo, `matrizes-suap/1`); o comando recusa versão que não conhece;
- `coletado_em`: o momento da coleta, gravado nos registros que mudam;
- `erros`: os itens que falharam na coleta, cada um com a identidade e a mensagem; o comando recusa relatório com algum erro, para não gravar às cegas;
- os itens, cada um com a identidade (para o curso, `curso_id`, `suap_id` e `codigo`) e o **dado bruto** coletado. Derivações (como a situação e a carga comum das matrizes) são calculadas aqui, na aplicação, para que a regra fique num lugar só. O que só interessa a quem coleta (tempo, conexões, critério, título da página) vai para o terminal da coleta, não para o relatório.

O esquema do relatório e um relatório de exemplo ficam aqui, junto da aplicação, e vão copiados para o repositório de quem coleta, cujos testes validam o exemplo.

O comando `aplicar_*`:

1. valida o relatório contra o esquema daqui e recusa `esquema` desconhecido e relatório com `erros`;
2. confere **todos** os itens contra os registros antes de gravar qualquer um: um item ausente da base, repetido, cuja identidade mudou desde a coleta ou cujo registro resultante não passaria no esquema recusa o relatório inteiro, sem gravar nada;
3. sem `--apply`, lista as mudanças substantivas e conta à parte os itens sem mudança, sem gravar nada;
4. com `--apply`, grava só as mudanças substantivas e relê os registros para confirmar. Uma coleta que não mudou nada não mexe em arquivo nenhum, nem no `coletado_em`. Se a gravação parar no meio (disco cheio, arquivo sem permissão), o comando diz o que já gravou e onde parou; corrija a causa e rode de novo: o que já foi gravado conta como sem mudança.

A revisão é o diff no PR: o PR da aplicação deve mostrar só os campos que o relatório alimenta. Depois de aplicar, rode o pipeline da base e confira o dado pela CLI:

```bash
node scripts/gerar_base.ts
node scripts/validar_base.ts
pnpm kb:compilar
pnpm kb fatos-ppc --ppc <campus>/<curso>   # para matrizes, os fatos cruzados com o SUAP
```

Exemplo: `scripts/aplicar_matrizes_suap.ts` aplica o relatório `matrizes-suap/1` (esquema em `scripts/dominio/matriz-suap.ts`, exemplo em `scripts/dominio/fixtures/relatorio-matrizes-suap.json`) em `suap.matrizes` dos cursos (veja [Matrizes e cargas horárias](#matrizes-e-cargas-horárias)).

## Horários de aula

Registre a fonte principal de horários no arquivo do campus. Como a informação muda por período letivo, preencha sempre `horarios_coletado_em`.

- `horarios_url`, quando houver uma fonte confiável;
- `horarios_coletado_em`, sempre que a busca for revisada.

Aceite fontes externas, como Google Sheets ou Edupage, somente quando forem apontadas pelo site oficial do campus. Não use horário de atendimento, monitorias, ônibus, laboratórios ou secretaria como substituto de horário das aulas.

## PPCs

Quando a página oficial do curso indicar o Projeto Pedagógico de Curso, registre o PPC vigente no objeto `ppc` do curso.

**Política de versão: todo PPC que entra na base fica nela.** Cada PPC tem ID permanente `ppc:<campus_id>/<curso_slug>/<versao>` e mora em `institucional/ifpr/ppcs/<campus_id>/<curso_slug>/<versao>.md`. A versão é o ano do documento (`2023`), com sufixo quando o curso tem dois PPCs do mesmo ano (`2023-2`); uma vez gravado, o ID não muda. O registro do curso aponta o PPC vigente (`ppc.markdown_path`, `ppc.url`), que é sempre a versão mais recente. Quando o curso ganha PPC novo (por exemplo, nas reformulações exigidas pelo art. 71 da Res. CNE/CP nº 2/2026), peça o DOCX à coordenação e importe-o (passo a passo em "Entrada de PPC novo na base", abaixo): ele entra como versão nova, o registro do curso passa a apontá-lo e o anterior fica na base, substituído, porque documentos e pareceres o citam. Arquivo de PPC só sai da base por erro de curadoria (documento de outro curso, por exemplo). As consultas (`buscar-secoes`, `fatos-ppc`, `citacoes-da-norma`, `impacto-da-norma`, Explorar) usam só os vigentes, salvo `--incluir-substituidos`; `campus/curso` sem versão vale pelo PPC vigente.

**Ano do documento com evidência, obrigatório.** O ano fica no front matter do próprio PPC, com o trecho literal que o traz (`ano_documento`, `ano_evidencia`, `ano_fonte`; abaixo), e a versão do ID começa por ele. Não se deduz ano: nem do nome ou da data de publicação do arquivo, nem do ano da matriz no SUAP, nem das normas citadas. PPC sem o ano com evidência não entra na base.

**Pendências: o que está fora da base.** Documento incompleto fica em `curadoria/pendencias/` (na raiz do repositório, fora de `base-conhecimento/`: não é publicado nem compilado), com a lista `pendencias` no front matter, uma por grupo de campos que falta (`ano: <o que falta e o que já se tentou>`). O repositório é público: o `validar_base.ts` confere as pendências também (contrato do front matter, curso existente, dados pessoais e URLs internas). Para ver tudo o que falta completar:

```bash
pnpm pendencias            # PPCs pendentes, versões conhecidas sem texto e cursos com PPC publicado sem texto na base
pnpm pendencias --json
```

Versão de PPC que se sabe existir mas não tem texto (o PDF anexo a uma matriz ativa do SUAP mais novo que o PPC da base, por exemplo) fica registrada em `curadoria/pendencias/versoes-ppc/<campus>/<curso>/suap-matriz-<id>.json`, com o trecho da capa que a mostra e o PDF público, quando há ([formato](../../curadoria/README.md)). O ano da matriz não é o do PPC. Importado o DOCX dessa versão, apague o registro.

Completou o que faltava, promova o PPC: ele ganha o ID da versão do ano e, se for a versão mais recente, o curso passa a apontá-lo.

```bash
node scripts/promover_ppc.ts curadoria/pendencias/ppcs/<campus>/<curso>/<rotulo>.md --ano <AAAA> --evidencia "<trecho>" [--fonte-ano <url>]
```

Regras:

1. Use como fonte primária a página oficial do curso.
2. Aceite documentos descritos como PPC, Projeto Pedagógico do Curso, Projeto Político Pedagógico do Curso ou Plano de Curso equivalente.
3. Não use matriz curricular, edital, resolução, formulário, manual, notícia ou documento auxiliar como substituto de PPC.
4. Quando houver mais de um PPC, registre como vigente o documento mais recente ou explicitamente marcado como vigente.
5. Registre `ppc.url` com HTTPS absoluto.
6. `ppc.markdown_path` aponta o PPC vigente, `institucional/ifpr/ppcs/<campus_id>/<curso_slug>/<versao>.md`; os scripts de importação, promoção e versão o mantêm.
7. Registre `ppc.vagas` somente com evidência textual (`ppc.trecho_vagas`) e com o status de curadoria. O ano do documento não fica no registro do curso: fica no PPC, com a evidência.

`ppc.vagas` é texto: use número simples, como `40`, ou intervalo, como `20-40`. A publicação normaliza esses dados em `ppc.metadados.vagas`.

As vagas têm curadoria própria: `ppc.curadoria_vagas` e `ppc.data_curadoria_vagas` valem para `ppc.vagas`, `ppc.trecho_vagas` e `ppc.periodicidade_vagas`. Os status aceitos são `Revisado`, `Precisa de revisão`, `Pendente` e `Inconsistente`; a auditoria recusa status desconhecido e data sem status. Trocar o PPC vigente reabre essa curadoria.

O ano do documento é o desta versão do PPC: o da capa ou folha de rosto, ou o do ato de aprovação ou ajuste que o próprio documento traz ("AJUSTE PARECER CONSEPE Nº 51/2023"). A evidência é o trecho literal: no texto do PPC (`ano_fonte: texto`, que o `validar_base.ts` confere no corpo) ou na fonte (`ano_fonte` com a URL, como `<fonte_url>#page=1`, quando o trecho só está no PDF publicado). Ano da criação do curso, de normas citadas, da matriz no SUAP ou da URL do arquivo não serve. Quando a capa e o ato divergem e não dá para dizer de que versão é o texto, o PPC fica pendente, com a divergência descrita na pendência.

### Entrada de PPC novo na base

Um PPC entra na base, como primeiro PPC do curso ou como versão nova, a partir do DOCX que a coordenação do curso envia. PDF não é convertido: se o curso só tem o PDF publicado, peça o DOCX à coordenação. A conversão é a mesma da revisão prévia (`converterPpc`, em `packages/ppc`), e o script grava o Markdown da base como versão nova do PPC do curso:

```bash
node scripts/importar_ppc_docx.ts <campus_id>/<curso_slug> <arquivo.docx> --fonte-url <url> \
  --ano <AAAA> --evidencia "<trecho com o ano>" [--fonte-ano <url>] [--reconverter]
```

1. Confira que o registro do curso existe em `institucional/ifpr/cursos/<campus_id>/<curso_slug>.json`; curso novo ganha registro antes, como na seção "Cursos". O script recusa curso inexistente.
2. Ache o endereço público do PPC na página oficial do curso (em geral, o PDF publicado do mesmo documento) e passe-o em `--fonte-url`. Ele vai para o `fonte_url` do front matter e para `ppc.url` do registro, que o `validar_base.ts` exige iguais. URL que não seja `https`, URL pré-assinada, planilha do Google e link de sessão do SEI são recusados.
3. Passe em `--ano` o ano do documento e em `--evidencia` o trecho literal que o traz (acima); por padrão o trecho é conferido no texto convertido, e `--fonte-ano <url>` diz que ele está na fonte. O ano é a versão no ID; se o curso já tem PPC desse ano, a versão ganha sufixo (`2026-2`); PPC mais antigo que o vigente é recusado. Sem `--ano` ou sem `--evidencia`, o PPC não entra na base: vai para `curadoria/pendencias/ppcs/<campus>/<curso>/<ano ou sem-ano>.md`, com a pendência `ano`, e o registro do curso não muda (promova depois, acima). `--reconverter` é só para converter de novo o mesmo documento do PPC vigente (conversor corrigido, DOCX mais fiel): grava por cima dele, com o mesmo ID, e exige o ano e a evidência dele.
4. Rode o script. Ele recusa arquivo que não é `.docx` ou não é um DOCX legível e documento sem texto (vazio ou digitalizado como imagem).
5. O script grava:
   - o Markdown em `institucional/ifpr/ppcs/<campus_id>/<curso_slug>/<versao>.md`, com o front matter de proveniência `registrada` (abaixo): o hash do DOCX vai em `arquivo_convertido_sha256`, e o `fonte_sha256` fica `desconhecido`, porque ele é o hash dos bytes de `fonte_url` (em geral o PDF), que o script não baixa;
   - sem CPF, RG, celular, matrícula de estudante e SIAPE (marcadores como `[CPF omitido]`; regra em `packages/kb/src/ppcs/dados-pessoais.ts`, descrita em [Dados pessoais e URLs internas](#dados-pessoais-e-urls-internas), que o `validar_base.ts` aplica a toda a base), sem link de planilha do Google (um link Markdown `[texto](planilha)` vira `texto (planilha interna, link omitido)`), sem parâmetros de sessão do SEI e sem query de URL pré-assinada. A saída informa só as contagens do que omitiu;
   - no lugar da representação gráfica, um aviso: a figura não é publicada na base;
   - no registro do curso, `ppc.url` e `ppc.markdown_path`, nas posições dos outros registros (`ppc` na posição do schema, `markdown_path` logo depois de `url`). Se o registro já tem vagas, o status de curadoria delas volta a `Precisa de revisão`, com a data do dia, porque o valor veio do texto anterior. `ppc.observacoes` fica como está, e a saída a aponta como "a reconferir".

   O Markdown e o registro são gravados juntos: se a gravação do segundo falha, o primeiro volta ao que era.
5. Leia o Markdown gerado. E-mail particular não tem regra automática: tire à mão. Confira as vagas contra o texto novo e atualize a curadoria (acima). Se a saída apontou `ppc.observacoes`, releia a observação contra o texto novo: corrija, ou apague se ela não vale mais.
6. Rode o pipeline da base e comite o PPC, o registro e os arquivos gerados juntos:

```bash
node scripts/gerar_base.ts
node scripts/validar_base.ts
```

O script não roda esses comandos: o passo 5 vem antes deles, e o pipeline é o mesmo de qualquer outra mudança nos registros. A lógica está em `scripts/base/importar-ppc.ts`, com testes em `importar-ppc.test.ts`.

### Proveniência do PPC convertido

Todo PPC em `institucional/ifpr/ppcs/<campus_id>/<curso_slug>/<versao>.md` começa com front matter YAML (contrato em `packages/kb/src/ppcs/front-matter.ts`):

| Campo | Conteúdo |
|---|---|
| `id` | `ppc:<campus_id>/<curso_slug>/<versao>`; a versão começa por `ano_documento` |
| `ano_documento` | ano do documento (AAAA); obrigatório |
| `ano_evidencia` | trecho literal que traz o ano; obrigatório |
| `ano_fonte` | `texto` (o trecho está no corpo do PPC, e o `validar_base.ts` confere) ou a URL https da fonte (`<fonte_url>#page=1`); obrigatório |
| `fonte_url` | endereço publicado do PPC; deve ser igual ao `ppc.url` vigente |
| `fonte_sha256` | SHA-256 dos bytes de `fonte_url`, ou `desconhecido` (sempre, na importação do DOCX: o script não baixa a URL) |
| `convertido_em` | data da conversão (AAAA-MM-DD) |
| `conversor` | conversor e versão (`simplifica-if/packages/ppc@<commit>`, com `-modificado` se o checkout tinha alteração não comitada em arquivo rastreado fora de `base-conhecimento/`, `tmp/` e `outputs/`), ou `desconhecido` |
| `arquivo_convertido`, `arquivo_convertido_sha256` | só quando o arquivo convertido não é o de `fonte_url`: o tipo (`docx`) e o SHA-256 dos bytes; o índice `ppcs/index.json` os publica como `arquivo_convertido: { tipo, sha256 }` |
| `proveniencia` | `registrada` (gravada na conversão) ou `reconstruida` (preenchida depois) |
| `conversao_commit`, `pos_processamento_commits` | só na reconstruída: commit da conversão e commits de limpeza posteriores |
| `nota_proveniencia` | na reconstruída, o motivo do que ficou `desconhecido`; na importação do DOCX, que o texto veio do DOCX e por que `fonte_sha256` é `desconhecido` |

Um PPC importado pelo `importar_ppc_docx.ts` tem proveniência `registrada`, com o hash em `arquivo_convertido_sha256`: quem baixa o `fonte_url` e confere o hash não acha divergência, porque o `fonte_sha256` não diz nada sobre esses bytes. Os 202 PPCs convertidos antes de 13/11/2026 têm proveniência `reconstruida` pelo histórico do git: `convertido_em` é a data do commit em que o texto entrou na base, e `fonte_url` é o `ppc.url` do curso nesse commit. O hash e a versão do conversor ficaram `desconhecido`, porque o arquivo da época não foi guardado e o baixado hoje não prova ser o mesmo; não os preencha à mão. Ao reconverter um PPC, a proveniência passa a `registrada`. Em 24/11/2026, o ano de cada um desses PPCs foi procurado no texto e no PDF publicado: os que têm evidência ganharam os campos do ano (e a versão do ano, quando a anterior estava errada); os demais saíram para as pendências.

`validar_base.ts` acusa PPC sem front matter, sem o ano com evidência (ou com evidência que não está no texto, quando `ano_fonte: texto`), `id` fora do caminho ou com versão que não começa pelo ano, arquivo de PPC fora de `ppcs/<campus>/<curso>/<versao>.md` ou sem item no índice, curso cujo PPC vigente não é a versão mais recente e `fonte_url` do vigente diferente do `ppc.url`: se o curso trocou de PPC, importe o DOCX novo como versão nova (ou, se só a URL mudou de endereço, confira o documento e reconverta com `--reconverter`, para registrar o hash do arquivo convertido).

Quem lê o Markdown por código deve ignorar o front matter: `corpoPpc` e `mascararFrontMatter` (que mantém os números de linha) estão no mesmo módulo.

## Situação do curso

Quando um processo administrativo (abertura, ajuste, atualização, suspensão, reversão de suspensão ou extinção) mudar a situação do curso, atualize `situacao` no arquivo do curso em `institucional/ifpr/cursos/` e publique.

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
6. Registre o turno em três campos:
   - `turno`: a grafia exata da fonte da oferta, isto é, do quadro em `url_fonte` transcrito em `trecho_fonte`, com as marcas de nota de rodapé (`¹`, `²`, `³`). Grafia diferente em outra fonte (por exemplo, o Anexo I do edital quando a oferta veio da página de cursos do processo seletivo) não substitui a de `url_fonte`: vai em `turno_nota`;
   - `turno_padronizado`: o enum, `matutino`, `vespertino`, `noturno`, `integral`, `diurno` (manhã e tarde sem os dias definidos, como "Diurno (manhã e tarde)" e "Matutino/Vespertino"), `matutino-com-contraturno` (manhãs e algumas tardes, como "Diurno (Manhã + 2 tardes por semana)") ou `vespertino-com-contraturno` (tardes e algumas manhãs);
   - `turno_nota`: o que o enum não diz, sobretudo o texto da nota de rodapé do edital (como "aparece no Portal do Candidato do IFPR como turno Integral") e divergências entre a página e o edital, com a grafia da outra fonte.

   `padronizarTurno` (`scripts/dominio/ingresso.ts`) propõe o enum a partir da grafia. A auditoria recusa `turno_padronizado` fora do enum, `turno` sem `turno_padronizado`, `turno` que não aparece literalmente em `trecho_fonte` e marca de rodapé sem `turno_nota`. Quando a fonte for uma página que omite o texto das notas, busque-o no Anexo I do edital correspondente e cite o número do edital na nota.

   `turno` é texto livre desde a primeira publicação e continua com a grafia da fonte; `turno_padronizado` foi acrescentado em 13/11/2026 para quem precisa filtrar.

## Índices globais de PPCs

A coleção `institucional/ifpr/ppcs/` contém PPCs convertidos e índices derivados:

- `institucional/ifpr/ppcs/index.json` (schema `ppcs_index`, versão 2): um item por PPC, com `taxonomia` e o resumo da proveniência;
- `institucional/ifpr/ppcs/secoes/<tipo>.jsonl` (schema `ppcs_secao`): uma linha por seção, com `preview` (500 primeiros caracteres do texto limpo), `linha_inicio` e `linha_fim` no arquivo `.md` (contadas desde 1, com o front matter), `heading`, `numeracao` e `origem_tipo`.

**Texto integral fora do git.** O git guarda só preview e linhas: o texto integral das seções duplicaria o dos PPCs (cerca de 64 MB) e incharia o histórico a cada regeneração. Quem precisar dele lê as linhas do próprio Markdown, com `lerTextoSecao` (`packages/kb/src/ppcs/citacoes.ts`) ou `textoDaSecao` (`packages/kb/src/ppcs/secoes.ts`). O texto integral indexado vai para o `kb.sqlite`, derivado e fora do git.

Esses arquivos são gerados automaticamente por `scripts/gerar_base.ts` (lógica em `packages/kb/src/ppcs/secoes.ts`). Não os edite manualmente; ajuste o registro do curso em `institucional/ifpr/cursos/` ou o Markdown convertido e rode novamente os comandos de publicação.

**Taxonomia por nível.** Cursos de nível médio usam a taxonomia `tecnico`, em que cada tipo aponta os incisos do art. 28 da Res. CNE/CP nº 2/2026 que cobre (`identificacao` I, `formato_oferta` II, `justificativa` e `objetivos` III, `requisitos_acesso` IV, `acessibilidade_inclusao` V, `perfil_egresso` VI, `itinerario_formativo` VII, `carga_horaria` VIII, `organizacao_curricular` e `matriz_curricular` IX, `aproveitamento_estudos` X, `avaliacao` XI, `infraestrutura` XII, `mundo_trabalho` XIII, `corpo_docente` XIV, `certificados_diplomas` XV, `prazo_integralizacao` XVI, `estagio_praticas` XVII, `acompanhamento_egresso` XVIII e § 4º), mais tipos do modelo do IFPR sem inciso próprio. Graduação, pós-graduação e FIC usam a taxonomia `geral`, sem os tipos próprios do art. 28 e com `contexto_institucional` e `atividades_complementares`. A lista completa, com rótulos e incisos, fica em `secoes.taxonomias` do índice.

**Como o tipo é decidido.** Cabeçalhos de página ("Campus Curitiba do IFPR", "PROENS") não abrem seção, e rótulos internos ("EMENTA:", "Bibliografia básica", "1º ano") ficam no texto da seção. No ementário, cada "Componente curricular: …" abre uma seção. O tipo vem das regras sobre o título (`origem_tipo: titulo`); sem regra, herda do título numerado ancestral (`numeracao`) ou da seção anterior (`contexto`). O que vem antes do primeiro título numerado é `pretextual`, e tudo depois do primeiro anexo é `anexos`. A folha de rosto repetida no meio do PPC ("APROVAÇÃO DO PROJETO PEDAGÓGICO DE CURSO ( X )") também é `pretextual`; "Objetivos do componente curricular" é do ementário (`ementas`), não `objetivos`; e programas e bolsas de pesquisa, extensão, inclusão social e assistência estudantil são `atendimento_estudante`, não `acessibilidade_inclusao`. `pretextual` e `outros` (não classificado) não ganham arquivo. Seções com menos de 40 caracteres de texto ficam fora do índice.

## Conselhos

`institucional/ifpr/conselhos/<conselho_id>/` guarda o registro do conselho (`conselho.json`) e um arquivo por reunião (`reunioes/<AAAA-MM-DD>.json`), com os documentos publicados (`documentos[]`: pareceres e pautas, com número, data, resumo e URL oficial) e os itens de pauta deliberados (`itens_pauta[]`: tipo de demanda, resultado, processo SEI, `documento_id` do documento de origem na mesma reunião). Hoje há só o Consepe, registrado em 17/11/2026; os IDs são os externos que a base já usava (`consepe:reuniao:<data>`, `consepe:parecer:<ano>:<número>`, `consepe:item:<ano>:parecer:<número>`).

Não há entidade de pessoa: relator(a), conselheiros e servidores não entram. Um nome só aparece quando faz parte do texto do ato oficial. Os itens apontam para o campus e o curso pelas chaves canônicas (`campus_id`, `curso_id`) quando o curso está cadastrado; `campus_texto` e `curso_texto` guardam a redação do ato. Curso que o ato não identifica sem ambiguidade, ou que não está cadastrado (abertura ainda não registrada, por exemplo), fica só com o texto.

O formato está em `scripts/dados/conselhos.ts`; o `validar_base.ts` confere o schema, o nome dos arquivos, e as relações (documento na mesma reunião, campus e curso existentes e coerentes).
