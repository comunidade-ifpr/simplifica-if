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
| `data_publicacao` | data ISO | Formato `AAAA-MM-DD` |
| `ementa` | string | Ementa oficial ou resumo normativo reconhecível |
| `status_vigencia` | string | Preferir: `vigente`, `alterada`, `revogada`, `parcialmente revogada`, `desconhecido` |
| `keywords` | lista | Palavras-chave curtas e úteis para recuperação |

### Campos recomendados

| Campo | Tipo | Uso |
|-------|------|-----|
| `orgao` | string | Ex.: `CONSUP/IFPR`, `CNE/CP`, `Presidência da República` |
| `jurisdicao` | string | Ex.: `BR`, `IFPR`, `MEC`, `CNE` |
| `aliases` | lista | Formas alternativas úteis de citação |
| `fonte` | string | URL ou referência da fonte oficial ou base confiável |
| `variante` | string | Só em arquivo que não é o texto integral do ato; hoje só `compilacao` (ver [ID canônico](#id-canônico)) |

### Campos opcionais para relações normativas

| Campo | Tipo |
|-------|------|
| `altera` | lista |
| `alterada_por` | lista |
| `revoga` | lista |
| `revogada_por` | lista |
| `regulamenta` | lista |
| `regulamentada_por` | lista |
| `relaciona_se_a` | lista |

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
ementa: "Dispõe sobre as diretrizes do trabalho do Docente de Educação Especial no IFPR."
status_vigencia: vigente
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
- Relações normativas entre normas da base são recíprocas: se A tem `altera: B`, B tem `alterada_por: A`; o mesmo vale para `revoga`/`revogada_por` e `regulamenta`/`regulamentada_por`. Norma com `alterada_por` usa `status_vigencia: alterada`, salvo se tiver sido revogada no todo ou em parte (`revogada` ou `parcialmente revogada`). Relações com normas fora da base ficam só no lado presente.

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
