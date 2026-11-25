---
name: revisar-conversao-ppc
description: Revisar e corrigir a formatação de um PPC convertido de PDF para Markdown na base (parágrafos partidos pela página, títulos, tabelas com cabeçalho partido, palavras partidas ou coladas, números e cabeçalhos de página que sobraram), sem mudar as palavras do documento. Use depois de importar um PPC de PDF, ou quando o texto de um PPC da base estiver com erros de conversão.
---

# Revisar a conversão de um PPC

O texto de um PPC convertido de PDF passa primeiro pela limpeza determinística (`conversao_ppc.ts limpar`), que tira cabeçalhos e rodapés institucionais, números de página, sumário e marcadores das fontes de símbolos, junta tabelas partidas pela página, nivela os títulos e religa parágrafos partidos antes de minúscula. O que a regra não decide sozinha vai para o diagnóstico, e é isso que você corrige aqui, região por região.

**A regra de ouro: você muda a forma, nunca as palavras.** Só mexa em marcação Markdown, espaços, quebras de linha e ordem das células de tabela. Não corrija ortografia, acento, concordância, número, sigla nem nome ("Parana" fica "Parana"; "Ministerio da Educagao" fica como está, se não for cabeçalho a tirar). Não resuma, não acrescente texto, não traduza. O front matter (entre os `---`) não muda. Na dúvida, deixe como está.

A conferência (`conversao_ppc.ts conferir`) compara as palavras de antes e de depois: reprova a correção que traz palavra nova (que não existia no texto) ou mexe no front matter, lista as palavras repetidas (que já existiam e aparecem mais vezes, o que só cabe no cabeçalho de tabela), aceita a palavra partida que volta a ser uma ("estu- dante" → "estudante") e a colada que é separada ("INSTITUTOFEDERAL" → "INSTITUTO FEDERAL"), e lista as palavras removidas, que só podem ser ruído de paginação (cabeçalho, rodapé, número de página, linha de sumário).

## Passo a passo

O alvo é a chave do PPC (`campus/curso/versao`, como `curitiba/tecnico-em-enfermagem/2023`) ou o caminho do `.md`. Os comandos rodam na raiz do repositório, com o Node do `.node-version`.

1. Limpe, se ainda não foi limpo (não muda nada num PPC já limpo):
   ```bash
   node scripts/conversao_ppc.ts limpar <ppc> --gravar
   ```
2. Liste as regiões:
   ```bash
   node scripts/conversao_ppc.ts diagnosticar <ppc>
   ```
   Cada região traz as linhas e os achados (`linha: tipo: trecho`). As linhas são do arquivo inteiro, contando o front matter.
3. Para cada região, leia as linhas dela com uma margem (Read com `offset` e `limit`, umas 10 linhas antes e depois) e corrija com Edit. Corrija de baixo para cima no arquivo, ou releia o diagnóstico depois de editar: juntar linhas muda a numeração das seguintes. Nem todo achado é erro: o diagnóstico aponta suspeitas; decida pelo contexto.
4. Confira contra a versão de antes da sua revisão (o último commit, ou `--contra <ref>`):
   ```bash
   node scripts/conversao_ppc.ts conferir <ppc>
   ```
   `REPROVADO` com palavra nova: ache-a no texto e desfaça. Palavra repetida só pode vir de cabeçalho de tabela que você montou; outra repetição é texto duplicado: desfaça. Nas removidas, só pode haver ruído de paginação; se aparecer palavra de conteúdo, você apagou texto: devolva-o.
5. Rode `node scripts/conversao_ppc.ts diagnosticar <ppc>` de novo e veja o que sobrou. O que você decidiu manter (falso alarme, ou caso que só o PDF resolveria) vai no relatório.

Arquivos temporários (o PDF baixado, um script de ajuda) vão numa pasta sua, criada com `mktemp -d`, nunca numa pasta compartilhada com outros agentes. Quem revisa vários PPCs ao mesmo tempo confere cada um pelo seu alvo, nunca com `--todos`, e não faz commit: quem coordena roda o pipeline da base (`node scripts/gerar_base.ts` e `node scripts/validar_base.ts`) e faz o commit no fim.

### Prioridade e quando parar

Corrija primeiro o texto corrido (parágrafos partidos, títulos, palavras coladas e partidas, ruído de página), depois as tabelas curtas (matriz curricular, quadros), e por último as fichas de componente e as bibliografias desenhadas como tabela. Um PPC pode ter dezenas dessas tabelas picadas (cada referência espalhada em várias linhas e colunas quase vazias): passe-as para parágrafos quando a ordem de leitura for inequívoca (as referências separadas por `<br>` numa célula viram um parágrafo cada); quando não for, deixe e registre uma vez, com o intervalo de linhas, em vez de tentar uma por uma.

## Como corrigir cada achado

### `paragrafo-partido`

Um parágrafo sem pontuação final seguido de outro que começa com maiúscula. Junte com um espaço quando o segundo continua a frase do primeiro:

```markdown
Do ponto de vista legal, o curso é concebido a partir da consonância entre a

Constituição Federal e as demais normativas que tangenciam o tema.
```

vira `Do ponto de vista legal, o curso é concebido a partir da consonância entre a Constituição Federal e as demais normativas que tangenciam o tema.`

Não junte rótulo e conteúdo ("**Carga horária total**: 80 horas" seguido de "EMENTA: …"), duas referências bibliográficas, dois itens de lista independentes nem um título curto e o texto que vem depois dele. Se a quebra está dentro de um item de lista (`- `), o pedaço de baixo entra no item de cima, sem o `- `.

### `titulo-colado`, `titulo-provavel`, `titulo-suspeito`

Títulos de seção são linhas próprias, sem negrito, com o nível pela numeração: `## 2`, `### 2.4`, `#### 2.4.1`, `##### 2.4.1.1` (até `######`). Título sem numeração fica em `##`.

- `titulo-colado`: separe o título do texto. `- 2.5.6 Mecanismos de interação entre docentes Não se aplica (NSA).` vira `#### 2.5.6 Mecanismos de interação entre docentes` e, no parágrafo seguinte, `Não se aplica (NSA).`.
- `titulo-provavel`: linha numerada curta, sozinha, que é título de seção no fluxo do documento (a numeração segue a das seções vizinhas): marque com o nível certo. Numeração de lista de conteúdos dentro de uma ementa ("1.1 Conceitos básicos" num programa de disciplina) não é título de seção do PPC: deixe.
- Campo de formulário numerado num anexo ("1.4 Matrícula:", "1.6 E-mail:") não é título de seção: se estiver como título, tire o `#`.
- `titulo-suspeito`: título longo, que acaba em ponto ou começa em minúscula. Se for parágrafo, item ou linha de capa marcados como título, tire o `#` (e ponha `- ` se for item de lista). A linha de capa ("MINISTÉRIO DA EDUCAÇÃO … CÂMPUS JAGUARIAÍVA") pode ficar como parágrafo em negrito.

### `tabela-cabecalho-partido`

O conversor espalhou o cabeçalho em várias linhas quase vazias. Reúna o texto de cada coluna, de cima para baixo, numa linha de cabeçalho só:

```markdown
|**PRIMEIRO PERÍODO**||||||||
|---|---|---|---|---|---|---|---|
|||||||Carga horária||
||H/A|CH|CH|CH|CH|total||
|Componente Curricular|sem.|(T)|(P)|(EX)|EaD|||
|||||||H/A|H/R|
|Teorias da Administração I (O)|4|4|0|0|1|80|67|
```

vira

```markdown
**PRIMEIRO PERÍODO**

|Componente Curricular|H/A sem.|CH (T)|CH (P)|CH (EX)|CH EaD|Carga horária total H/A|Carga horária total H/R|
|---|---|---|---|---|---|---|---|
|Teorias da Administração I (O)|4|4|0|0|1|80|67|
```

O conversor às vezes põe um rótulo do cabeçalho uma coluna ao lado da sua: use os dados e as notas da tabela (`01*` semanal, `02*` semestral) para pôr cada rótulo sobre a coluna certa. O título que ocupava a primeira linha sozinho sai da tabela, como parágrafo em negrito antes dela. Uma palavra de cabeçalho comum a várias colunas ("Carga horária" sobre "H/A" e "H/R") se repete em cada uma: repetir é permitido, inventar não. Se a tabela não tem cabeçalho de verdade (uma ficha de componente curricular desenhada como tabela, com rótulo e valor), use a primeira linha de dados como cabeçalho ou passe a ficha para parágrafos (`**Rótulo:** valor`), na ordem de leitura.

### `tabela-palavra-partida` e linhas de continuação

A palavra partida entre células da mesma linha volta a uma célula: `|Quadro 1 - Eixos tecnológicos, ní|veis e modalidades dos cur|sos ofertados|` vira uma célula só, `|Quadro 1 - Eixos tecnológicos, níveis e modalidades dos cursos ofertados|`, e a tabela perde as colunas que sobram (o separador `|---|` acompanha). A linha de baixo que só continua o texto das células de cima (primeira célula vazia, texto começando em minúscula) entra na de cima, célula a célula, com um espaço.

Ao passar uma tabela para parágrafos, o `<br>` que separava as linhas dentro da célula vira espaço (ou quebra de parágrafo, se separava itens); a conferência não o conta como palavra.

Tabela embaralhada demais para reconstruir com certeza (texto de ementa picado em 15 colunas): passe o conteúdo para parágrafos na ordem de leitura se a ordem for inequívoca; se não for, deixe como está e registre no relatório. O PDF original (o `fonte_url` do front matter) resolve a dúvida: baixe-o para uma pasta temporária e leia a página com Read (`pages`).

### `hifen-partido`

`estu- dante` vira `estudante`. Mas o hífen que faz parte da palavra fica, só sem o espaço: `tornou- se` vira `tornou-se`, `bem- estar` vira `bem-estar`, `sócio- econômico` vira `sócio-econômico` se assim estiver escrito em outro ponto do documento.

### `palavras-coladas` e `letras-espacadas`

O hífen não é palavra para a conferência: ao separar `DidáticoPedagógica`, use `Didático-Pedagógica` se o termo aparece com hífen em outro ponto do documento (ou é composto que sempre leva hífen), e `Didático Pedagógica` na dúvida. Texto de mapa ou figura que a extração picou (nomes de cidades soltos) fica como está.

O diagnóstico aponta a primeira da linha; leia a região inteira, porque costuma haver outras perto (uma matriz com "FísicaII", "LínguaPortuguesaII", "40horas" em todas as linhas). Separe as palavras coladas pela extração (`AngelaPalomaZelliWiedemann` → `Angela Paloma Zelli Wiedemann`, `FísicaII` → `Física II`, `40horas` → `40 horas`, `ensinodefisicaeastronomia` → `ensino de física e astronomia` **sem** acrescentar o acento: `ensino de fisica e astronomia`) e junte as letras espaçadas (`C A M P U S` → `CAMPUS`). Nome de marca, produto ou editora escrito assim de propósito fica: InterSaberes, JavaScript, SurveyMonkey, GeoGebra, YouTube. Cabeçalho de página colado (`MinisteriodaEducacao InstitutoFederaldoParana`) no meio do texto ou de uma tabela é ruído: tire.

### `numero-solto` e ruído de página que sobrou

Número sozinho entre dois parágrafos, fora de tabela, quase sempre é número de página: tire. Antes, veja se não é o valor de um rótulo ("Carga horária" e, no bloco seguinte, "80"): nesse caso, deixe. Cabeçalho, rodapé ou endereço do câmpus que sobrou no meio do texto também sai.

O cabeçalho de página às vezes vem colado no começo de um parágrafo, que segue com o conteúdo: `**Câmpus Umuarama do IFPR Curso: Eixo Tecnológico:** Técnico em Química … **Componente Curricular**: Sociologia I …`. A parte que se repete igual em várias páginas (aqui, até o nome do curso e o eixo) é o cabeçalho: tire só ela e deixe o resto (`**Componente Curricular**: Sociologia I …`). Se não der para dizer onde o cabeçalho acaba, deixe e registre. Mas a linha "Câmpus X do IFPR Curso: … Eixo Tecnológico: …" que abre cada ficha de componente curricular, uma vez por ficha e junto do nome do componente, faz parte da ficha: mantenha.

### `caractere-estranho`

`�` e caracteres de uso privado vieram de fontes de símbolos. Marcador de lista no começo vira `- `; no meio da linha, separa itens. Não troque `�` por uma letra adivinhada: deixe e registre.

## Relatório

No fim, diga em poucas linhas, por PPC: quantas regiões corrigiu, o resultado do `conferir` (palavras removidas e por quê) e o que deixou de propósito, com a linha e o motivo (falso alarme, tabela que só o PDF resolve, `�`).
