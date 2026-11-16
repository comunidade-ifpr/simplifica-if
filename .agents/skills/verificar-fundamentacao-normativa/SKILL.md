---
name: verificar-fundamentacao-normativa
description: Verificar fundamentação normativa de documentos, PPCs, pareceres, minutas, relatórios e respostas que citam ou afirmam obrigações baseadas em leis, resoluções, portarias, notas técnicas, CNCT ou regulamentos institucionais. Use quando o usuário pedir checagem de citações normativas, validação de afirmações sobre normas, conferência de base legal, identificação de norma ausente, correção de fundamentação ou análise de risco de uma redação normativa.
simplifica:
  titulo: Conferir a fundamentação normativa
  resumo: Confere cada citação e afirmação normativa de um documento contra o texto das normas e do CNCT na base e aponta o que está confirmado, impreciso ou sem suporte.
  area: ensino
  publico: [proens, dens, coordenacao-curso, pedagogia]
  entradas:
    - { id: documento, tipo: arquivo, aceita: [.md, .txt, .pdf], rotulo: "Documento a conferir" }
  ferramentas:
    - resolver_citacoes
    - buscar_norma
    - ler_dispositivos
    - ficha_norma
    - correspondencia
    - listar_cursos
    - ficha_curso
    - buscar_secoes
    - sobre_a_base
  arquivos:
    - references/relatorio.md
  duracao_estimada: 10min
---

# Verificar Fundamentação Normativa

Verifique se cada afirmação normativa de um documento está apoiada por fonte válida, vigente e pertinente. A regra central é simples: não aceite uma afirmação sobre lei, resolução, portaria, regulamento ou CNCT sem consultar a própria fonte.

## Fontes

### Com as ferramentas `ifpr` (app Simplifica IF ou cliente com o servidor MCP)

Quando as ferramentas do servidor MCP `ifpr` estiverem disponíveis, elas são o caminho principal. Elas devolvem o texto literal, o link `ifpr://` da fonte e a data da base:

- `resolver_citacoes` para identificar as citações do documento (ID canônico, dispositivo, regra e confiança; confiança abaixo de 0,9 pede conferência no trecho original);
- `buscar_norma` com a citação ou com termos, e `ler_dispositivos` com o ID, para ler o dispositivo com o caput herdado;
- `ficha_norma` para a vigência na data, as relações (revoga, altera, regulamenta) e as regras de transição; `correspondencia` quando o documento citar dispositivo de norma revogada;
- `listar_cursos` e `ficha_curso` para afirmações sobre cursos técnicos e o CNCT;
- `buscar_secoes` apenas para ver como PPCs do IFPR trataram o tema: são exemplos institucionais observados, não fonte normativa obrigatória;
- `sobre_a_base` para saber o que a base contém e de quando ela é.

O documento a conferir fica na pasta de trabalho: leia-o com a ferramenta de leitura de arquivos. Se o formato não puder ser lido (por exemplo, `.docx`), peça ao usuário o documento em PDF, Markdown ou texto colado.

### Dentro do repositório

No checkout do `simplifica-if`, sem as ferramentas `ifpr`, use a CLI `pnpm kb` (`buscar-norma`, `resolver`, `dispositivo`, `vigencia`, `correspondencia`, `cursos`) ou a base local do projeto:

- `base-conhecimento/manifest.json` para normas, leis, resoluções, portarias e notas técnicas.
- `base-conhecimento/institucional_manifest.json` para coleções institucionais.
- `base-conhecimento/catalogos_manifest.json` para catálogos.
- `base-conhecimento/catalogos/cnct/manifest.json`, `index.json` e `cursos/*.json` para afirmações sobre cursos técnicos no CNCT.
- `base-conhecimento/institucional/ifpr/ppcs/` apenas como exemplos institucionais observados, não como fonte normativa obrigatória.

Se a skill estiver instalada fora do repositório unificado e sem as ferramentas `ifpr`, localize a base nesta ordem:

1. `base-conhecimento/` no diretório atual ou em algum diretório pai.
2. Raiz do repositório que contém a skill em `.agents/skills/verificar-fundamentacao-normativa`.
3. `SIMPLIFICA_IF_BASE`, se existir no ambiente.
4. Fonte oficial online ou URL pública da base, somente se a base local não estiver disponível ou se a atualização externa for indispensável.

Declare explicitamente quando usar fonte externa. Se a norma necessária não estiver na base nem puder ser consultada com segurança, classifique como `FONTE AUSENTE OU NÃO CONSULTADA`.

## Fluxo

1. Identifique o escopo do pedido: documento inteiro, seção específica, trecho colado, resposta gerada por IA ou conjunto de alegações.
2. Extraia alegações normativas explícitas e implícitas:
   - citações diretas a leis, resoluções, portarias, notas técnicas, regulamentos, CNCT, RGE, PPC, artigos, incisos, parágrafos e anexos;
   - frases com força normativa, como `deve`, `é obrigatório`, `é vedado`, `conforme`, `nos termos`, `previsto`, `regulamentado`, `exigido`;
   - afirmações de vigência, revogação, competência, carga horária, pré-requisito, certificação, matriz curricular, estágio, avaliação, assistência estudantil, acessibilidade ou fluxo processual.
3. Para cada alegação, localize a fonte normativa exata: com as ferramentas `ifpr`, por `resolver_citacoes` ou `buscar_norma`; no repositório, pelo manifesto (aliases, keywords, título, número, ano e órgão) ou pela CLI `kb`.
4. Leia o trecho aplicável antes de concluir (`ler_dispositivos`, ou o Markdown da norma no repositório).
5. Confira:
   - se a norma citada existe e corresponde ao número, ano, órgão e tema indicados;
   - se o dispositivo citado sustenta exatamente a afirmação;
   - se a afirmação omite condicionantes, exceções, escopo, sujeito obrigado, modalidade, nível de ensino ou data de vigência;
   - se há conflito com outra norma da base ou com catálogo aplicável;
   - se a afirmação usa PPCs ou práticas institucionais como se fossem obrigação normativa.
6. Classifique cada alegação e proponha redação corrigida quando houver problema objetivo.

## Classificação

Use uma destas conclusões por alegação:

- `CONFIRMADA`: a fonte consultada sustenta a afirmação sem ressalva relevante.
- `CONFIRMADA COM RESSALVA`: a fonte sustenta a ideia geral, mas a redação precisa limitar escopo, condição, prazo, sujeito ou dispositivo.
- `IMPRECISA`: a afirmação aponta norma correta, mas erra artigo, nomenclatura, alcance, terminologia ou grau de obrigação.
- `SEM SUPORTE NA FONTE`: a norma foi consultada e não sustenta a afirmação.
- `CONTRADITÓRIA`: a afirmação contraria o texto da fonte consultada ou outra fonte normativa aplicável.
- `FONTE AUSENTE OU NÃO CONSULTADA`: a fonte necessária não está disponível ou não pôde ser verificada.
- `NÃO NORMATIVA`: o trecho é contextual, opinativo, histórico, pedagógico ou exemplo institucional, sem pretensão normativa verificável.

## Relatório

Para revisões substantivas, leia `references/relatorio.md` (na pasta desta skill) antes de redigir. Entregue relatório em Markdown com:

1. síntese executiva;
2. escopo e limitações;
3. fontes consultadas;
4. achados por alegação, com status, trecho analisado, fonte, evidência e recomendação;
5. lacunas da base, quando houver normas citadas mas ausentes;
6. redações sugeridas, quando útil.

Sempre cite a fonte usada (o link `ifpr://` devolvido pela ferramenta ou, no repositório, o caminho local) e o artigo, inciso, parágrafo, seção ou item analisado. Não substitua leitura da fonte por conhecimento interno.
