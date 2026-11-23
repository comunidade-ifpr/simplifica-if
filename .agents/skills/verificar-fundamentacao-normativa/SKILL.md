---
name: verificar-fundamentacao-normativa
description: Verificar fundamentação normativa de documentos, PPCs, pareceres, minutas, relatórios e respostas que citam ou afirmam obrigações baseadas em leis, resoluções, portarias, notas técnicas, CNCT ou regulamentos institucionais. Use quando o usuário pedir checagem de citações normativas, validação de afirmações sobre normas, conferência de base legal, identificação de norma ausente, correção de fundamentação ou análise de risco de uma redação normativa.
simplifica:
  versao: 0.2.2
  app_minimo: 0.2.0
  titulo: Conferir a fundamentação normativa
  resumo: Confere cada citação e afirmação normativa de um documento contra o texto das normas e do CNCT na base do IFPR e, quando a norma está fora da base, em fontes oficiais na internet.
  area: ensino
  entradas:
    - { id: documento, tipo: arquivo, rotulo: "Documento a conferir" }
  ferramentas:
    - resolver_citacoes
    - buscar_norma
    - ler_dispositivos
    - ficha_norma
    - correspondencia
    - listar_cursos
    - ficha_curso
    - etapa
  etapas:
    - { id: alegacoes, rotulo: "Ler o documento e listar as alegações" }
    - { id: fontes, rotulo: "Ler a fonte de cada alegação", progresso: true }
    - { id: classificar, rotulo: "Classificar cada alegação" }
    - { id: relatorio, rotulo: "Montar o relatório" }
  arquivos:
    - references/relatorio.md
  duracao_estimada: 10min
---

# Verificar Fundamentação Normativa

Confira se cada afirmação normativa do documento está apoiada por fonte existente, vigente e pertinente. Nenhuma alegação sobre lei, resolução, portaria, regulamento ou CNCT se aceita sem ler a própria fonte.

**Fontes.** Use as ferramentas `ifpr` conforme as instruções do servidor. Neste método: `resolver_citacoes` para as citações explícitas, `buscar_norma` para as alegações sem norma citada, `ler_dispositivos` para ler o trecho, `ficha_norma` para a vigência, `correspondencia` quando o documento cita dispositivo de norma revogada, e `listar_cursos` e `ficha_curso` para o CNCT. Dentro do repositório `simplifica-if`, sem elas, use as mesmas ferramentas pela CLI `pnpm kb`, um comando por ferramenta com o nome em kebab-case (`pnpm kb resolver-citacoes "…"`, `buscar-norma`, `ler-dispositivos`, `ficha-norma`, `correspondencia`, `listar-cursos`, `ficha-curso`): a mesma entrada, como argumento e flags, e a mesma resposta.

**Documento.** Leia o documento na pasta de trabalho. Quando o pedido aponta uma versão em texto (no app, a do `.docx`, em `.simplifica/textos/`), leia-a no lugar do original. Se não conseguir ler o arquivo (formato que suas ferramentas não abrem, PDF digitalizado sem texto), diga isso e peça outro formato ou o texto colado; não confira pelo nome do arquivo nem de memória.

**Etapas.** No app, marque o avanço com a ferramenta `etapa` ao começar cada etapa: `alegacoes` (passos 1 e 2), `fontes` (passos 3 e 4, com `progresso` de alegações lidas sobre o total), `classificar` (passo 5) e `relatorio`. Fora do app, a ferramenta só confirma e você segue.

## Método

1. **Escopo:** documento inteiro, seção, trecho colado, resposta de IA ou lista de alegações.
2. **Extraia as alegações**, explícitas e implícitas:
   - citações de lei, resolução, portaria, nota técnica, regulamento, CNCT, RGE ou PPC, com artigo, inciso, parágrafo ou anexo;
   - frases com força normativa sem norma citada (`deve`, `é obrigatório`, `é vedado`, `conforme`, `nos termos`, `exigido`);
   - afirmações de vigência, revogação, competência, carga horária, estágio, pré-requisito, certificação, matriz, avaliação, assistência estudantil, acessibilidade ou fluxo processual.
3. **Localize e leia a fonte** de cada alegação antes de concluir. Consulte sempre a base `ifpr` primeiro (conforme as instruções do servidor). Se uma norma citada não existir na base (ex.: resolução de conselho profissional, NR, lei específica de área ou norma estadual) e a sessão tiver acesso à web, consulte o **texto integral em fonte oficial** (`planalto.gov.br`, `in.gov.br` ou portal do órgão ou conselho emissor). Fonte secundária (blog, resumo, notícia) não confirma alegação normativa e mantém `FONTE AUSENTE OU NÃO CONSULTADA`. Alegação sem norma citada: procure a norma que trataria do tema; se nenhuma a sustenta, é `SEM SUPORTE NA FONTE`.
4. **Confira**, por alegação:
   - a norma existe e o número, o ano, o órgão e o tema batem;
   - o dispositivo citado sustenta exatamente a afirmação (artigo certo, não só a norma certa);
   - o grau de obrigação é o da fonte (`deve` onde a fonte diz `pode` é erro);
   - o sujeito obrigado, as condicionantes, as exceções e o escopo (nível, forma, modalidade, estágio obrigatório ou não obrigatório) não foram ampliados nem omitidos;
   - a norma está vigente na data (revogada: regras de transição e o dispositivo correspondente na sucessora), e não há conflito com outra norma ou com o CNCT;
   - PPC, processo anterior ou prática de campus não está sendo tratado como obrigação normativa.
5. **Classifique** e proponha redação corrigida quando houver problema objetivo.

## Classificação

Um status por alegação:

- `CONFIRMADA`: a fonte sustenta a afirmação sem ressalva relevante.
- `CONFIRMADA COM RESSALVA`: sustenta a ideia geral, mas a redação precisa limitar escopo, condição, prazo, sujeito ou dispositivo.
- `IMPRECISA`: norma certa, mas artigo, nomenclatura, alcance, terminologia ou grau de obrigação errados.
- `SEM SUPORTE NA FONTE`: a fonte foi consultada e não sustenta a afirmação.
- `CONTRADITÓRIA`: a afirmação contraria a fonte consultada ou outra norma aplicável.
- `FONTE AUSENTE OU NÃO CONSULTADA`: a fonte necessária não está na base e não pôde ser lida em texto integral de fonte oficial na web (ou a sessão está sem acesso à web).
- `NÃO NORMATIVA`: trecho contextual, opinativo, histórico, pedagógico ou exemplo institucional.

## Relatório

Em revisão substantiva, leia antes `references/relatorio.md` (formato, critérios por tema e sinais de risco). Entregue em Markdown: síntese, escopo e limitações, fontes consultadas (separando base do IFPR e fontes externas oficiais), achados por alegação (status, origem, trecho, fonte com dispositivo, evidência, análise, redação sugerida), lacunas da base (inclusive normas relevantes consultadas fora da base) e recomendações. Cada achado cita a fonte e o dispositivo lido, como link Markdown: `[Lei nº 11.788/2008, art. 2º, § 3º](ifpr://norma/br/lei/2008/11788#art2)`, a URL oficial externa ou, no repositório, o caminho local.
