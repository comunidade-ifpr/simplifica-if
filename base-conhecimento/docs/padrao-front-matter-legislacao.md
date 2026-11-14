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
| `data_publicacao` | data ISO | Formato `AAAA-MM-DD`; data do ato usada para ordenar o manifesto (as datas precisas estão nos três campos abaixo) |
| `assinada_em` | data ISO | Data do ato (assinatura) |
| `publicada_em` | data ISO ou `a confirmar` | Publicação oficial (DOU, Boletim de Serviço) |
| `vigente_de` | data ISO ou `a confirmar` | Início dos efeitos (vigência); `a confirmar` quando depende da publicação não registrada |
| `datas_fonte` | string | De onde vieram as três datas (dispositivo de vigência, nota de publicação, fonte oficial conferida) |
| `ementa` | string | Ementa oficial ou resumo normativo reconhecível |
| `status_vigencia` | string | **Gerado** (ver [Vigência calculada](#vigência-calculada)): `vigente`, `alterada`, `parcialmente revogada`, `revogada`; na compilação, manual |
| `keywords` | lista | Palavras-chave curtas e úteis para recuperação |

### Campos recomendados

| Campo | Tipo | Uso |
|-------|------|-----|
| `orgao` | string | Ex.: `CONSUP/IFPR`, `CNE/CP`, `Presidência da República` |
| `jurisdicao` | string | Ex.: `BR`, `IFPR`, `MEC`, `CNE` |
| `aliases` | lista | Formas alternativas úteis de citação |
| `fonte` | string | URL ou referência da fonte oficial ou base confiável |
| `variante` | string | Só em arquivo que não é o texto integral do ato; hoje só `compilacao` (ver [ID canônico](#id-canônico)) |

### Campos gerados (não edite à mão)

`bun run scripts/gerar_base.ts` escreve estes campos a partir de `base-conhecimento/relacoes.yaml` e de `base-conhecimento/config/vigencia.yaml`; `gerar_base.ts --check` e `validar_base.ts` acusam divergência.

| Campo | Origem |
|-------|--------|
| `status_vigencia` | status calculado na `data_referencia` |
| `vigencia_calculada_em` | a `data_referencia` usada |
| `vigencia_a_confirmar` | só quando o cálculo depende de data "a confirmar": a explicação |
| `revoga`, `revogada_por` | relações `revoga` (origem vê o alvo; o alvo vê a origem com o dispositivo operador e o alcance) |
| `altera`, `alterada_por` | relações `altera` |
| `regulamenta`, `regulamentada_por` | relações `regulamenta` |
| `fundamenta_se_em`, `fundamenta` | relações `fundamenta-se-em` |

### Campo opcional manual

| Campo | Tipo |
|-------|------|
| `relaciona_se_a` | lista de títulos de normas relacionadas sem relação tipada |

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
fonte: "URL ou referência oficial"
relaciona_se_a:
  - Resolução CONSUP/IFPR nº 148/2023
---
```

---

## Regras de preenchimento

- `title` deve ser curto, canônico e suficiente para identificação isolada.
- `numero` deve conter apenas o número do ato.
- `data_publicacao` deve usar sempre ISO `AAAA-MM-DD`.
- `keywords` deve conter termos de domínio, não frases longas.
- `aliases` deve conter formas pelas quais o texto costuma ser citado em PPCs e pareceres.
- O corpo do arquivo continua começando com `## Resumo`.
- Os arquivos devem ficar em `normas/<jurisdicao>/<tipo-plural>/`.
- O nome do arquivo não deve usar prefixo de data. A data oficial deve ficar em `data_publicacao`.
- `status_vigencia` só aceita estado de vigência; a natureza do documento fica em `tipo_documento`. Uma compilação de dispositivos de outra norma usa `tipo_documento: Compilação`, fica em `normas/br/compilacoes/` e registra em `status_vigencia` a vigência do texto reproduzido (`vigente` quando traz a redação atual; `desconhecido` quando não se sabe se está atualizada). A norma de origem vai em `relaciona_se_a`.
- Relações normativas entre normas vão em `base-conhecimento/relacoes.yaml` (ver [Relações](#relações-relacoesyaml)); o front matter das duas pontas é gerado dali. Alvo ou origem sem texto na base entra como stub (`normas/stubs.yaml`).
- Datas: nunca invente. Sem evidência no texto da norma ou na fonte oficial conferida, use `a confirmar` e diga em `datas_fonte` o que falta.

---

## ID canônico

O `id` é derivado do ato (tipo, órgão, jurisdição, ano e número), nunca do nome do arquivo. Ele vai para o `manifest.json` e é a chave usada pelo resolvedor de citações (`bun run kb resolver`), por `bun run kb citacoes <id>` e pelos gabaritos da avaliação.

| Ato | Formato | Exemplos |
|-----|---------|----------|
| Emitido por órgão | `<jurisdição>/<órgão>/<tipo>/<ano>/<número>` | `br/cne-cp/res/2026/2`, `br/mec/portaria/2024/902`, `ifpr/consup/res/2024/190`, `ifpr/proens/nt/2025/1` |
| Da Presidência da República | `br/<tipo>/<ano>/<número>` | `br/lei/1996/9394`, `br/decreto/2004/5154` |
| Variante de arquivo do mesmo ato | `<id do ato>~<variante>` | `br/lei/1996/9394~compilacao` |
| Fora da base | `externo:<segmentos>` | `externo:cft/res/2019/89`, `externo:abnt/nbr/6023` |
| Dispositivo | `<id>#<dispositivo>` | `#art28-xvi`, `#art28-par1-iv`, `#art71-parunico`, `#art36A`, `#art5-al-a` |

Regras:

- Jurisdição: `br` ou `ifpr`, em minúsculas.
- Órgão: o campo `orgao` em minúsculas, sem acento, com `/` virando `-` e sem o sufixo `/IFPR` (`CNE/CP` → `cne-cp`, `CONSUP/IFPR` → `consup`, `PROENS/IFPR` → `proens`). Atos da Presidência não têm segmento de órgão.
- Tipo: `lei`, `lc` (lei complementar), `decreto`, `decreto-lei`, `mp`, `ec`, `res` (resolução), `portaria`, `nt` (nota técnica), `parecer`, `in` (instrução normativa) e `deliberacao`.
- Número sem pontos nem zeros à esquerda; ano com quatro dígitos.
- **Compilação.** Uma compilação de trechos (`tipo_documento: Compilação`) é o mesmo ato que o texto integral, mas o arquivo precisa de ID próprio para que o `id` seja único por arquivo. O ID do arquivo é o do ato de origem com o sufixo `~compilacao`, e o front matter traz `variante: compilacao`. O tipo do ato de origem é `lei` quando o órgão é a Presidência da República; noutros casos, informe `tipo_ato` (ex.: `tipo_ato: Resolução`). A citação "LDB" ou "Lei nº 9.394/1996" resolve para o ato (`br/lei/1996/9394`); a busca deduplica pelos dispositivos.
- Dispositivo: a letra de artigo vem colada e em maiúscula (`#art36A`); a alínea é sempre `-al-` (`#art5-al-a`), para que art. 36-A e alínea a do art. 36 não se confundam; parágrafo é `-par<n>` ou `-parunico`; inciso é o romano em minúsculas.

`bun run scripts/validar_base.ts` confere o formato, a unicidade, a coerência com `variante` e a igualdade com o ID derivado dos demais campos; para variante, confere também que o ato existe na base ou nos stubs.

O front matter é lido com o pacote `yaml` no schema `failsafe` (todo valor é texto; só `ano` vira inteiro), com contrato zod em `packages/kb/src/normas/front-matter.ts`. Por isso `numero: 9394` continua texto no `manifest.json`.

## Normas sem texto na base (stubs) e referências externas

Normas citadas por PPCs ou fichas mas sem texto em `normas/` ficam em `normas/stubs.yaml`, com ID, título, data, ementa, `status_vigencia` e, quando houver, aliases. Status diferente de `a confirmar` exige `status_fonte` apontando para o dispositivo da base que prova o status (ex.: `br/cne-cp/res/2021/1#art64` para a revogação da Res. CNE/CEB nº 6/2012). Metadados não conferidos em fonte oficial ficam com `curadoria: rascunho`.

Referências fora do escopo normativo da base (conselhos profissionais, ABNT, documentos institucionais não normativos, regulamentos de campus) ficam na seção `externos` do mesmo arquivo, com IDs `externo:`.

Quando o texto de um stub entrar em `normas/`, remova a entrada de `stubs.yaml`: o validador acusa ID repetido.

## Corpo da norma (estrutura para o parser de dispositivos)

`packages/kb/src/normas/estrutura.ts` lê o corpo com `remark-parse` + `remark-gfm` e extrai os dispositivos com ID canônico; `validar_base.ts` acusa o que fugir destas convenções:

- **Regiões.** `## Resumo` vai até o primeiro `---` ou o próximo `##`. Seções `##` editoriais (Notas, Observações, Referências, análises) ficam fora do texto normativo. `## Texto ...` e cabeçalhos estruturais (`TÍTULO`, `CAPÍTULO`, `ANEXO`, `REGULAMENTO`...) abrem ou continuam o texto normativo.
- **Artigo:** cabeçalho de nível 4 só com o rótulo (`#### Art. 4º-A.`); o caput vem no parágrafo seguinte. O rótulo fica como está no texto oficial (`Art. 5o`, `ARTIGO 1º`).
- **Parágrafo:** parágrafo iniciado por `**§ 1º**` ou `**Parágrafo único.**`, um por linha, com linha em branco antes.
- **Inciso:** item de lista iniciado por `**I –**` (com letra: `**IV – A -**`); **alínea:** item `a)`, aninhado no inciso ou logo depois dele; **item:** lista numerada dentro de alínea ou de anexo.
- **Anexo:** cabeçalho `ANEXO ...` (ou `REGULAMENTO`/`ESTATUTO`/`REGIMENTO` depois dos artigos do ato); os artigos do anexo têm IDs `#anexoN-artX`.
- **Texto de outra norma alterado por esta** ("passa a vigorar com a seguinte redação"): em citação (`>`), dentro do artigo que opera a alteração; não vira dispositivo desta norma.
- **Redação não vigente reproduzida ao lado da vigente:** entre `<!-- redacao-nao-vigente -->` e `<!-- /redacao-nao-vigente -->`; **texto que não consta do ato publicado:** entre `<!-- fora-do-ato: motivo -->` e `<!-- /fora-do-ato -->`. Comentários HTML não são texto, então o saneamento não muda palavras.
- **Dispositivo revogado** fica com o texto da nota ("(Revogado pela Lei nº ...)") ou tachado (`~~...~~`); o parser marca `revogado: true`. Notas "Redação dada", "Incluído", "Vide" viram metadado (`notas`): a base guarda só o texto vigente.
- **Norma sem artigos** (nota técnica): um dispositivo `#secaoN` por cabeçalho do texto normativo.
- **Rótulo repetido no texto publicado** (dois incisos "II"): o ID segue a posição e o caso sai como aviso.

IDs de dispositivo: `#art28-xvi`, `#art28-par1-iv`, `#art71-parunico`, `#art36A`, `#art26-par9B`, `#art9-ivA`, `#art5-al-a`, `#art4-i-al-a-item1`, `#anexo1`, `#anexo1-item3`, `#anexo1-art5`, `#secao1`.

**Compilação e ato.** Os dispositivos da compilação (`br/lei/1996/9394~compilacao`) têm o ID do arquivo; na consulta pelo ato (`br/lei/1996/9394#art36B`), o texto integral prevalece e o dispositivo da compilação só entra se o integral não o tiver (hoje todos os trechos da compilação estão no integral).

**Saneamento.** Mudanças de marcação não podem mudar palavras: `packages/kb/src/normas/saneamento.test.ts` compara, sem a marcação Markdown, a sequência de palavras de cada norma com a do commit anterior ao saneamento, e `estrutura.test.ts` confere que os segmentos do parser reconstituem o corpo.

## Relações (`relacoes.yaml`)

`base-conhecimento/relacoes.yaml` é a fonte única das relações `revoga`, `altera`, `regulamenta` e `fundamenta-se-em`: origem, dispositivo operador (`#art74-ii`), alvo (ato e, se parcial, `alvo_dispositivo` ou `alcance`), `efeito_de` (data ou vigência da origem), evidência literal (`evidencia.em` + `trecho`, conferida pelo validador), `confirmado_em` e `proposta` (`front-matter`, `regex` ou `manual`). `bun run kb relacoes --propor` lista o que o regex sobre "Ficam revogados", "Revogam-se" e "passa a vigorar" encontra e ainda não está registrado nem descartado; uma proposta só entra depois de conferida no texto (descartes ficam em `descartadas`, com o motivo).

## Vigência calculada

O `status_vigencia` publicado é calculado na `data_referencia` de `base-conhecimento/config/vigencia.yaml`, nunca no relógio do build (`packages/kb/src/normas/vigencia.ts`): antes de `vigente_de`, a norma não está em vigor; uma relação produz efeito em `efeito_de` ou na vigência da origem; revogação total > parcial > alteração. Quando o cálculo depende de data "a confirmar" (como a publicação da Res. CNE/CP nº 2/2026), o status é presumido e o front matter (e o `manifest.json`) traz `vigencia_a_confirmar`. Quem filtra normas só por `status_vigencia` precisa olhar também esse campo: a Res. CNE/CP nº 1/2021 aparece como `revogada`, mas a revogação só produz efeito na publicação da Res. CNE/CP nº 2/2026 no DOU, ainda não registrada, e até lá a norma pode estar vigente. Stubs atingidos por relações têm de ter o status calculado. Para outra data: `bun run kb vigencia <id> --em AAAA-MM-DD`.

Regras de transição (direito de conclusão, prazos de adequação) são dados em `base-conhecimento/transicoes.yaml` e aparecem em `kb vigencia`: revogada não é inaplicável.

## Correspondência entre normas sucessoras

`base-conhecimento/correspondencias/*.yaml` liga cada dispositivo da norma revogada aos da sucessora (`equivalente`, `parcial`, `sem-equivalente`, com nota). A tabela 1/2021 → 2/2026 está em `rascunho`: exige revisão jurídica humana antes de servir de fundamento. Consulta: `bun run kb correspondencia br/cne-cp/res/2021/1#art20`.
