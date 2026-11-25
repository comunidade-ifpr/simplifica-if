## Resumo

Padrão oficial de `front matter` para arquivos Markdown de legislação em `normas/` neste repositório. Define campos mínimos, campos opcionais e convenções de preenchimento para consumo automático por LLMs e ferramentas de indexação.

---

## Objetivo

O `front matter` existe para:

- identificar a norma de forma canônica;
- padronizar metadados entre leis, resoluções, portarias, pareceres e documentos equivalentes;
- permitir busca estruturada por número, ano, órgão, ementa e palavras-chave;
- registrar relações normativas relevantes, como alteração, revogação e regulamentação;
- apoiar consumo automático por ferramentas e LLMs.

---

## Padrão oficial

### Campos obrigatórios

| Campo | Tipo | Regra |
|-------|------|-------|
| `id` | string | ID canônico do ato (ver [ID canônico](#id-canônico)); primeiro campo do front matter |
| `title` | string | Forma canônica curta da norma |
| `tipo_documento` | string | Ex.: `Lei`, `Resolução`, `Portaria`, `Parecer`, `Decreto` |
| `numero` | string ou número | Número do ato, sem o ano embutido quando possível |
| `ano` | inteiro | Ano da norma |
| `data_publicacao` | data ISO | Formato `AAAA-MM-DD`; data do ato usada para ordenar as normas (as datas precisas estão nos três campos abaixo) |
| `assinada_em` | data ISO | Data do ato (assinatura) |
| `publicada_em` | data ISO, `a confirmar` ou `aguardando publicação` | Publicação oficial (DOU, Boletim de Serviço) |
| `vigente_de` | data ISO ou `aguardando publicação` | Início dos efeitos (vigência). Obrigatório com data: norma sem a data de vigência não entra na base. `aguardando publicação` só para o ato assinado e ainda não publicado, que não está em vigor (hoje, a Res. CNE/CP nº 2/2026); quando sair a publicação, troque pela data |
| `datas_fonte` | string | De onde vieram as três datas (dispositivo de vigência, nota de publicação, fonte oficial conferida) |
| `orgao` | string | Ex.: `CONSUP/IFPR`, `CNE/CP`, `Presidência da República` |
| `jurisdicao` | string | Ex.: `BR`, `IFPR`; com `tipo_documento`, decide a pasta do arquivo |
| `ementa` | string | Ementa oficial ou resumo normativo reconhecível |
| `status_vigencia` | string | **Gerado** (ver [Vigência calculada](#vigência-calculada)): `vigente`, `alterada`, `parcialmente revogada`, `revogada`, `ainda-nao-vigente` |
| `keywords` | lista | Palavras-chave curtas e úteis para recuperação |

### Campos recomendados

| Campo | Tipo | Uso |
|-------|------|-----|
| `aliases` | lista | Formas alternativas úteis de citação |
| `fonte_url` | URL `https` | Endereço público do texto oficial (DOU, Planalto, portal do IFPR). Sem ele, a fonte oficial está pendente: não escreva a pendência em texto. O leitor do app mostra o link "Ver na fonte oficial" e a referência formal termina em "Disponível em:" só com este campo |
| `fonte_referencia` | string | Referência da fonte sem link: número do SEI, Boletim de Serviço, PDF assinado. Pode acompanhar `fonte_url` |

### Campos gerados (não edite à mão)

`node scripts/gerar_base.ts` escreve estes campos a partir de `base-conhecimento/relacoes.yaml` e de `base-conhecimento/config/vigencia.yaml`; `validar_base.ts` acusa divergência.

| Campo | Origem |
|-------|--------|
| `status_vigencia` | status calculado na `data_referencia`: pelas relações de `relacoes.yaml` e, como piso, pelo que o próprio texto mostra (nota de redação ou inclusão: `alterada`; dispositivo revogado: `parcialmente revogada`) |
| `revoga`, `revogada_por` | relações `revoga` (origem vê o alvo; o alvo vê a origem com o dispositivo operador e o alcance) |
| `altera`, `alterada_por` | relações `altera` |
| `regulamenta`, `regulamentada_por` | relações `regulamenta` |
| `fundamenta_se_em`, `fundamenta` | relações `fundamenta-se-em` |

### Campo opcional manual

| Campo | Tipo |
|-------|------|
| `relaciona_se_a` | lista de títulos de normas relacionadas sem relação tipada |

### Metadados editoriais

O corpo do arquivo é só o texto da norma. O que a curadoria escreve sobre ela fica no front matter, um campo por função, cada um como lista de itens de texto (Markdown de linha: negrito, link). Nenhum deles é fundamento: quem cita, cita o dispositivo. O leitor do app os mostra em blocos recolhidos no cabeçalho, com o aviso de que não são o texto oficial; a `ficha_norma` do MCP os entrega à IA com o mesmo aviso.

| Campo | Função | O que entra |
|-------|--------|-------------|
| `pontos_chave` | Resumo navegável do que a norma dispõe | Um ponto por item, com o dispositivo que o sustenta no parêntese final: `(art. 29)`, `(arts. 48 a 53)`, `(art. 17, § 2º)`. O `validar_base` confere que o artigo citado existe na norma. Entra na busca de normas. Não repita a ementa nem o nome do ato |
| `notas_da_fonte` | Como o texto foi obtido e consolidado | A fonte conferida e a data, a alteração incorporada de norma que a base não tem, o que ficou de fora do arquivo e por quê. A evidência de uma relação de `relacoes.yaml` pode estar aqui, literal |

**Orientação para PPC não é metadado da norma.** O que conferir num PPC, como ler a norma na prática de um PPC e como ela se combina com outra ficam nas fichas da revisão de PPC (`base-conhecimento/revisao-ppc/fichas/`, na `rubrica` e nas `referencias_normativas`) ou na `orientacao_analise` do marco normativo.

Não entram em nenhum campo: contexto histórico genérico, impacto presumido, relação com outra norma (o lugar é o `relacoes.yaml`, com evidência) e o que não cita o texto.

---

## Template oficial

```yaml
---
id: ifpr/consup/res/2023/159
title: Resolução CONSUP/IFPR nº 159/2023
tipo_documento: Resolução
numero: 159
ano: 2023
data_publicacao: 2023-12-12
orgao: CONSUP/IFPR
jurisdicao: IFPR
assinada_em: "2023-12-12"
publicada_em: "a confirmar"
vigente_de: "2024-01-02"
datas_fonte: "Art. 34: \"entra em vigor em 2 de janeiro de 2024\"."
ementa: "Dispõe sobre as diretrizes do trabalho do Docente de Educação Especial no IFPR."
status_vigencia: "vigente"   # gerado
keywords: [educação especial, AEE, AICE, inclusão, PPC, IFPR]
aliases:
  - Resolução IFPR nº 159/2023
  - Resolução CONSUP/IFPR 159/2023
fonte_url: "https://ifpr.edu.br/..."
relaciona_se_a:
  - Resolução CONSUP/IFPR nº 148/2023
pontos_chave:
  - "As atividades do Docente de Educação Especial se dividem em ensino, apoio ao ensino, manutenção do ensino e pesquisa ou extensão (art. 10)."
notas_da_fonte:
  - "Texto conferido com a publicação do SEI em 13/11/2026."
---

Dispõe sobre as diretrizes do trabalho do Docente de Educação Especial no IFPR.

#### Art. 1º

...
```

---

## Regras de preenchimento

- `title` deve ser curto, canônico e suficiente para identificação isolada.
- `numero` deve conter apenas o número do ato.
- `data_publicacao` deve usar sempre ISO `AAAA-MM-DD`.
- `keywords` deve conter termos de domínio, não frases longas.
- `aliases` deve conter formas pelas quais o texto costuma ser citado em PPCs e pareceres. Um alias sem número vira nome próprio da norma no resolvedor de citações (como "LDB" ou "Lei do Estágio"): toda ocorrência dele num PPC conta como citação, com regra `alias`. Termos de assunto que não identificam só esta norma ("regime domiciliar", "estágio") vão em `keywords`, que a busca também lê.
- O corpo do arquivo é só o texto da norma, do preâmbulo à assinatura: sem `## Resumo`, sem rótulo `## Texto da norma`, sem seções de notas. Resumo, orientações e notas vão nos [metadados editoriais](#metadados-editoriais).
- Os arquivos devem ficar em `normas/<jurisdicao>/<tipo-plural>/` (`normas/br/leis/`, `normas/br/decretos-lei/`...). O diretório de cada par jurisdição e tipo está em `DIRETORIOS_POR_TIPO` (`scripts/base/front-matter.ts`); o primeiro ato de um tipo novo precisa da entrada ali, ou o `validar_base.ts` recusa a norma.
- O nome do arquivo não deve usar prefixo de data. A data oficial deve ficar em `data_publicacao`.
- `status_vigencia` só aceita estado de vigência; a natureza do documento fica em `tipo_documento`.
- Parecer do CNE (`tipo_documento: Parecer`, `orgao: CNE/CEB`, `CNE/CES` ou `CNE/CP`) fica em `normas/br/pareceres/`, com ID `br/cne-ceb/parecer/<ano>/<número>`. O parecer só produz efeito depois da homologação do Ministro da Educação (Lei nº 9.131/1995): `assinada_em` é a data de aprovação no colegiado, e `publicada_em` e `vigente_de` são a data da publicação do despacho de homologação no DOU; `fonte_referencia` traz o processo e o despacho. Sem artigos, cada seção (relatório, mérito, voto, decisão) é um dispositivo `#secaoN`. A `ementa` diz a natureza do parecer: consulta que interpreta a norma ou parecer que fundamenta uma resolução. O `status_vigencia: vigente` de um parecer homologado não o torna norma obrigatória por si; a resolução que ele fundamenta registra a relação `fundamenta-se-em` em `relacoes.yaml`. Parecer citado sem texto fica em `stubs.yaml`, com o mesmo ID.
- Relações normativas entre normas vão em `base-conhecimento/relacoes.yaml` (ver [Relações](#relações-relacoesyaml)); o front matter das duas pontas é gerado dali. Alvo ou origem sem texto na base entra como stub (`normas/stubs.yaml`).
- Datas: nunca invente. `vigente_de` é obrigatório: ache a data no texto da norma (cláusula de vigência) e na fonte oficial (DOU, Boletim de Serviço do SEI); sem ela, a norma não entra na base. `publicada_em` sem evidência fica `a confirmar`. Diga em `datas_fonte` de onde veio cada data e o critério (vigência na publicação, na aprovação, na assinatura de nota técnica sem cláusula).

---

## ID canônico

O `id` é derivado do ato (tipo, órgão, jurisdição, ano e número), nunca do nome do arquivo. Ele é a chave usada pelo registro de normas, pelo resolvedor de citações (`pnpm kb resolver-citacoes`), por `pnpm kb citacoes-da-norma <id>` e pelos gabaritos da avaliação.

| Ato | Formato | Exemplos |
|-----|---------|----------|
| Emitido por órgão | `<jurisdição>/<órgão>/<tipo>/<ano>/<número>` | `br/cne-cp/res/2026/2`, `br/mec/portaria/2024/902`, `ifpr/consup/res/2024/190`, `ifpr/proens/nt/2025/1` |
| Da Presidência da República | `br/<tipo>/<ano>/<número>` | `br/lei/1996/9394`, `br/decreto/2004/5154` |
| Fora da base | `externo:<segmentos>` | `externo:cft/res/2019/89`, `externo:abnt/nbr/6023` |
| Dispositivo | `<id>#<dispositivo>` | `#art28-xvi`, `#art28-par1-iv`, `#art71-parunico`, `#art36A`, `#art5-al-a` |

Regras:

- Jurisdição: `br` ou `ifpr`, em minúsculas.
- Órgão: o campo `orgao` em minúsculas, sem acento, com `/` virando `-` e sem o sufixo `/IFPR` (`CNE/CP` → `cne-cp`, `CONSUP/IFPR` → `consup`, `PROENS/IFPR` → `proens`). Atos da Presidência não têm segmento de órgão.
- Tipo: `lei`, `lc` (lei complementar), `decreto`, `decreto-lei`, `mp`, `ec`, `res` (resolução), `portaria`, `nt` (nota técnica), `parecer`, `in` (instrução normativa) e `deliberacao`.
- Número sem pontos nem zeros à esquerda; ano com quatro dígitos.
- Dispositivo: a letra de artigo vem colada e em maiúscula (`#art36A`); a alínea é sempre `-al-` (`#art5-al-a`), para que art. 36-A e alínea a do art. 36 não se confundam; parágrafo é `-par<n>` ou `-parunico`; inciso é o romano em minúsculas.

`node scripts/validar_base.ts` confere o formato, a unicidade e a igualdade com o ID derivado dos demais campos. Cada ato tem um arquivo só, com o texto integral: a base não guarda compilação nem seleção de trechos de uma norma.

O front matter é lido com o pacote `yaml` no schema `failsafe` (todo valor é texto; só `ano` vira inteiro), com contrato em Effect Schema (`esquemaNorma`, em `packages/kb/src/normas/front-matter.ts`). Por isso `numero: 9394` continua texto. Esse esquema é o contrato inteiro: `node scripts/validar_base.ts` acusa todos os erros dele, e a compilação do banco recusa a norma fora dele.

## Normas sem texto na base (stubs) e referências externas

Normas citadas por PPCs ou fichas mas sem texto em `normas/` ficam em `normas/stubs.yaml`, com ID, título, data, ementa, `status_vigencia` e, quando houver, aliases, `fonte_url` e `fonte_referencia` (os mesmos campos do front matter). O stub não registra `tipo_documento`, `orgao`, `jurisdicao`, `numero` nem `ano`: o banco os tira do ID (`metadadosDoIdNorma`, em `packages/kb/src/normas/ids.ts`), e por isso o ID precisa seguir o padrão do ato. Status diferente de `a confirmar` exige `status_fonte` apontando para o dispositivo da base que prova o status (ex.: `br/cne-cp/res/2021/1#art64` para a revogação da Res. CNE/CEB nº 6/2012). Metadados não conferidos em fonte oficial ficam com `curadoria: rascunho`.

Referências fora do escopo normativo da base (conselhos profissionais, ABNT, documentos institucionais não normativos, regulamentos de campus) ficam na seção `externos` do mesmo arquivo, com IDs `externo:`.

Quando o texto de um stub entrar em `normas/`, remova a entrada de `stubs.yaml`: o validador acusa ID repetido.

## Normas revogadas e histórico

A base guarda todo ato que entrou nela, e nenhum sai por perder a vigência. PPCs antigos e atuais, pareceres e outros documentos citam normas revogadas, e a resposta certa para eles é "esta norma foi revogada por tal ato, com efeito em tal data", com o texto à mão. Apagar a norma revogada transformaria essas citações em "não registrada".

- **Revogação ou substituição:** a norma nova entra num arquivo próprio, e a antiga fica onde está. A relação `revoga` vai para `relacoes.yaml`, com a evidência literal, e o gerador calcula o `status_vigencia` das duas pontas, com a data do efeito. As regras de transição vão para `transicoes.yaml`.
- **Stub revogado:** a norma citada que só tem identificação continua em `stubs.yaml`, com o status provado pelo dispositivo revogador (`status_fonte`). Se for muito citada, vale trazer o texto integral dela para `normas/`, como qualquer ato.
- **Alteração sem revogação:** o arquivo traz o texto consolidado do ato, na redação vigente, com as notas de redação da fonte oficial. A redação anterior de um dispositivo alterado pode ficar no mesmo arquivo, entre os marcadores de redação não vigente (abaixo).
- **Remoção:** um arquivo de norma sai da base só por erro de curadoria (ato que não existe, duplicado, fora do escopo), nunca por revogação.

## Corpo da norma (estrutura para o parser de dispositivos)

`packages/kb/src/normas/estrutura.ts` lê o corpo com `remark-parse` + `remark-gfm` e extrai os dispositivos com ID canônico; `validar_base.ts` acusa o que fugir destas convenções:

- **Só a norma.** Todo o corpo é texto normativo, e todo cabeçalho dele é da norma (divisão, artigo, anexo, ou a seção de um parecer). O `validar_base` recusa `## Resumo`, `## Texto ...`, `## Notas` e o marcador `fora-do-ato`.
- **Divisões** (Livro, Parte, Título, Capítulo, Seção, Subseção): um cabeçalho com o rótulo como está no texto oficial (`TÍTULO III`, `CAPÍTULO II-A`, `Seção Única`), no nível do tipo da divisão, qualquer que seja a divisão de cima: `##` para Livro, Parte e Título; `###` para Capítulo; `####` para Seção; `#####` para Subseção. O nome da divisão ("DAS FORMAS DE ACESSO") vem num cabeçalho só dele, logo depois do rótulo e um nível abaixo (`### CAPÍTULO I` e `#### DAS FORMAS DE ACESSO`), inteiro numa linha; também vale no próprio cabeçalho do rótulo, se o arquivo já o traz assim (`### CAPÍTULO I – DAS DISPOSIÇÕES GERAIS`, `#### Seção I Da Frequência`). A hierarquia vem do tipo, não do nível do cabeçalho (o `####` é do artigo): é dela que sai o índice "Neste documento" do leitor (`packages/kb/src/normas/sumario.ts`), com a faixa de artigos de cada divisão. Numeração que o texto oficial pula ou repete (um Título IV que não existe) fica como está.
- **Artigo:** cabeçalho de nível 4 só com o rótulo (`#### Art. 4º-A.`); o caput vem no parágrafo seguinte. O rótulo fica como está no texto oficial (`Art. 5o`, `ARTIGO 1º`).
- **Parágrafo:** parágrafo iniciado por `**§ 1º**` ou `**Parágrafo único.**`, um por linha, com linha em branco antes.
- **Inciso:** item de lista iniciado por `**I –**` (com letra: `**IV – A -**`); **alínea:** item `a)`, aninhado no inciso ou logo depois dele; **item:** lista numerada dentro de alínea ou de anexo.
- **Anexo:** cabeçalho `ANEXO ...` (ou `REGULAMENTO`/`ESTATUTO`/`REGIMENTO` depois dos artigos do ato); os artigos do anexo têm IDs `#anexoN-artX`.
- **Texto de outra norma alterado por esta** ("passa a vigorar com a seguinte redação"): em citação (`>`), dentro do artigo que opera a alteração; não vira dispositivo desta norma.
- **Redação não vigente reproduzida ao lado da vigente:** entre `<!-- redacao-nao-vigente -->` e `<!-- /redacao-nao-vigente -->`, logo antes da redação vigente do mesmo dispositivo. Serve para o dispositivo que outra norma alterou sem revogar o ato: a pessoa vê no leitor como era e como ficou, e a redação anterior não vira dispositivo (a IA e a busca só leem a vigente). Comentário HTML não é texto, então o saneamento não muda palavras. **Texto que não consta do ato publicado** (resto de assinatura eletrônica, artigo que a publicação oficial não traz) sai do arquivo, com o registro em `notas_da_fonte`.
- **Dispositivo revogado** fica com o texto da nota ("(Revogado pela Lei nº ...)") ou tachado (`~~...~~`); o parser marca `revogado: true`. Notas "Redação dada", "Incluído", "Vide" viram metadado (`notas`): a base guarda só o texto vigente. Mantenha essas notas como a fonte oficial as traz: é delas que saem as alterações anotadas da norma (quem alterou, incluiu ou revogou cada dispositivo), mostradas na ficha e no leitor. A lei que só aparece nessas notas não precisa de stub nem de relação em `relacoes.yaml`: a alteração já está no texto consolidado. Dela vem só o piso do `status_vigencia` na `data_referencia`: a norma com nota de redação ou inclusão fica `alterada`, e a que tem dispositivo revogado, `parcialmente revogada`, mesmo sem relação registrada. Em data anterior, o status segue só as relações (a nota não traz a data do efeito).
- **Norma sem artigos** (nota técnica): um dispositivo `#secaoN` por cabeçalho do texto normativo.
- **Rótulo repetido no texto publicado** (dois incisos "II"): o ID segue a posição e o caso sai como aviso.

IDs de dispositivo: `#art28-xvi`, `#art28-par1-iv`, `#art71-parunico`, `#art36A`, `#art26-par9B`, `#art9-ivA`, `#art5-al-a`, `#art4-i-al-a-item1`, `#anexo1`, `#anexo1-item3`, `#anexo1-art5`, `#secao1`.


**Legibilidade.** Linha em branco antes e depois de cabeçalho, antes e depois de lista e entre parágrafos; um parágrafo (`§`) ou inciso por linha, nunca colado no fim do dispositivo anterior; alínea recuada dois espaços sob o inciso dela. Um `#` solto no fim de uma linha é resto de cabeçalho da conversão e sai (não conta como palavra).

**Saneamento.** Mudanças de marcação não podem mudar palavras: `packages/kb/src/normas/saneamento.test.ts` compara, sem a marcação Markdown, a sequência de palavras do corpo de cada norma com a do commit de referência (`REF_DO_TEXTO`, o da última conferência do texto com a fonte oficial), sem norma isenta, e `estrutura.test.ts` confere que os segmentos do parser reconstituem o corpo. Correção do texto pela fonte oficial vai num commit próprio, e `REF_DO_TEXTO` sobe para ele. O parser também recusa, no corpo, cabeçalho de nível 1 ou 2 que não seja divisão nem anexo.

## Relações (`relacoes.yaml`)

`base-conhecimento/relacoes.yaml` é a fonte única das relações `revoga`, `altera`, `regulamenta` e `fundamenta-se-em`: origem, dispositivo operador (`#art74-ii`), alvo (ato e, se parcial, `alvo_dispositivo` ou `alcance`), `efeito_de` (data ou vigência da origem; obrigatório com data quando a origem é stub, que não tem `vigente_de`: em `revoga` e `altera`, o validador recusa a relação sem ele), evidência literal (`evidencia.em` + `trecho`, conferida pelo validador), `confirmado_em` e `proposta` (`front-matter`, `regex` ou `manual`). `pnpm kb relacoes --propor` lista o que o regex sobre "Ficam revogados", "Revogam-se" e "passa a vigorar" encontra e ainda não está registrado nem descartado; uma proposta só entra depois de conferida no texto (descartes ficam em `descartadas`, com o motivo).

## Vigência calculada

O `status_vigencia` publicado é calculado na `data_referencia` de `base-conhecimento/config/vigencia.yaml`, nunca no relógio do build (`packages/kb/src/normas/vigencia.ts`): antes de `vigente_de`, a norma não está em vigor; uma relação produz efeito em `efeito_de` ou na vigência da origem; revogação total > parcial > alteração. A vigência é calculada, nunca presumida: toda norma tem `vigente_de` com data, e toda relação de origem stub, `efeito_de` com data. A norma `aguardando publicação` (hoje, a Res. CNE/CP nº 2/2026) está `ainda-nao-vigente`, as relações que ela opera não produzem efeito (a Res. CNE/CP nº 1/2021 segue vigente) e as regras de transição dela ainda não começaram; quando sair a publicação, a data entra em `vigente_de` e `publicada_em`. Stubs atingidos por relações têm de ter o status calculado. O front matter é um retrato nessa data: o app, o simplifica-mcp e a CLI `kb` calculam a vigência no dia da consulta, e a `data_referencia` não precisa avançar a cada norma nova. Para outra data: `pnpm kb ficha-norma <id> --em AAAA-MM-DD`.

Regras de transição (direito de conclusão, prazos de adequação) são dados em `base-conhecimento/transicoes.yaml` e aparecem em `kb ficha-norma`: revogada não é inaplicável.

## Correspondência entre normas sucessoras

`base-conhecimento/correspondencias/*.yaml` liga cada dispositivo da norma revogada aos da sucessora (`equivalente`, `parcial`, `sem-equivalente`, com nota). A tabela 1/2021 → 2/2026 está em `rascunho`: exige revisão jurídica humana antes de servir de fundamento. Consulta: `pnpm kb correspondencia br/cne-cp/res/2021/1#art20`.

## Inclusão de norma nova

1. Grave o Markdown em `normas/` com o `id` canônico (acima) e retire de `normas/stubs.yaml` o stub correspondente, se houver. Relação nova entra em `relacoes.yaml`, com a evidência literal do texto (`pnpm kb relacoes --propor` lista o que o regex achou e ainda não foi confirmado).
2. Rode o pipeline e compile o banco:

   ```bash
   node scripts/gerar_base.ts
   node scripts/validar_base.ts
   pnpm kb:compilar
   ```

3. Confira a norma pela CLI: `pnpm kb ficha-norma <id>` (vigência, pontos-chave) e `pnpm kb ler-dispositivos` de alguns dispositivos (os IDs saem como o parser os leu).
