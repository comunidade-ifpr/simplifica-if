---
name: verificar-fundamentacao-normativa
description: Verificar fundamentação normativa de documentos, PPCs, pareceres, minutas, relatórios e respostas que citam ou afirmam obrigações baseadas em leis, resoluções, portarias, notas técnicas, CNCT ou regulamentos institucionais. Use quando o usuário pedir checagem de citações normativas, validação de afirmações sobre normas, conferência de base legal, identificação de norma ausente, correção de fundamentação ou análise de risco de uma redação normativa.
simplifica:
  versao: 0.1.0
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
    - ficha_curso
  arquivos:
    - references/relatorio.md
  duracao_estimada: 10min
---

# Verificar Fundamentação Normativa

Confira se cada afirmação normativa do documento está apoiada por fonte existente, vigente e pertinente. Nenhuma alegação sobre lei, resolução, portaria, regulamento ou CNCT se aceita sem ler a própria fonte.

**Fontes.** Use as ferramentas `ifpr` conforme as instruções do servidor; neste método, `resolver_citacoes` para as citações explícitas, `buscar_norma` para as alegações sem norma citada, `ler_dispositivos` para ler o trecho, `ficha_norma` para a vigência e `ficha_curso` para o CNCT. Dentro do repositório `simplifica-if`, sem elas, use a CLI `pnpm kb` (`resolver`, `buscar-norma`, `dispositivo`, `vigencia`, `cursos`). Leia o documento na pasta de trabalho; se o formato não puder ser lido (`.docx`), peça PDF, Markdown ou texto colado.

## Método

1. **Escopo:** documento inteiro, seção, trecho colado, resposta de IA ou lista de alegações.
2. **Extraia as alegações**, explícitas e implícitas:
   - citações de lei, resolução, portaria, nota técnica, regulamento, CNCT, RGE ou PPC, com artigo, inciso, parágrafo ou anexo;
   - frases com força normativa sem norma citada (`deve`, `é obrigatório`, `é vedado`, `conforme`, `nos termos`, `exigido`);
   - afirmações de vigência, revogação, competência, carga horária, estágio, pré-requisito, certificação, matriz, avaliação, assistência estudantil, acessibilidade ou fluxo processual.
3. **Localize e leia a fonte** de cada alegação antes de concluir. Alegação sem norma citada: procure a norma que trataria do tema; se nenhuma a sustenta, é `SEM SUPORTE NA FONTE`.
4. **Confira**, por alegação:
   - a norma existe e o número, o ano, o órgão e o tema batem;
   - o dispositivo citado sustenta exatamente a afirmação (artigo certo, não só a norma certa);
   - o grau de obrigação é o da fonte (`deve` onde a fonte diz `pode` é erro);
   - o sujeito obrigado, as condicionantes, as exceções e o escopo (nível, forma, modalidade, estágio obrigatório ou não obrigatório) não foram ampliados nem omitidos;
   - a norma está vigente na data, e não há conflito com outra norma ou com o CNCT;
   - PPC, processo anterior ou prática de campus não está sendo tratado como obrigação normativa.
5. **Classifique** e proponha redação corrigida quando houver problema objetivo.

## Classificação

Um status por alegação:

- `CONFIRMADA`: a fonte sustenta a afirmação sem ressalva relevante.
- `CONFIRMADA COM RESSALVA`: sustenta a ideia geral, mas a redação precisa limitar escopo, condição, prazo, sujeito ou dispositivo.
- `IMPRECISA`: norma certa, mas artigo, nomenclatura, alcance, terminologia ou grau de obrigação errados.
- `SEM SUPORTE NA FONTE`: a fonte foi consultada e não sustenta a afirmação.
- `CONTRADITÓRIA`: a afirmação contraria a fonte consultada ou outra norma aplicável.
- `FONTE AUSENTE OU NÃO CONSULTADA`: a fonte necessária não está na base ou não pôde ser verificada.
- `NÃO NORMATIVA`: trecho contextual, opinativo, histórico, pedagógico ou exemplo institucional.

## Relatório

Em revisão substantiva, leia antes `references/relatorio.md` (formato, critérios por tema e sinais de risco). Entregue em Markdown: síntese, escopo e limitações, fontes consultadas, achados por alegação (status, trecho, fonte com dispositivo, evidência, análise, redação sugerida), lacunas da base e recomendações. Cada achado cita a fonte (link `ifpr://` ou, no repositório, o caminho local) e o dispositivo lido.
