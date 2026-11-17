# M0.1 — Servidor MCP `simplifica-mcp`

Situação em 14/11/2026. Detalha o M0.1 do [plano do app](app-simplifica-if.md#marco-0--cérebro-portátil). Também cobre a parte do M0.2 que muda o `packages/kb`: o banco que responde sozinho, sem o repositório.

## Objetivo

Um servidor MCP só de leitura que entrega a base de conhecimento a qualquer IA (Claude, Codex, Gemini), com o texto literal, a proveniência e o link `ifpr://` em cada resposta. Ele roda só com o `kb.sqlite`: sem repositório, sem Node e sem Python no computador do servidor.

## Ponto de partida (medido em 13/11/2026)

**O banco**

- `tmp/kb.sqlite` tem 138 MB; comprimido com `zstd -19`, fica com **34,7 MB**.
- As seções de PPC (65,7 MB) e o índice FTS delas (40,7 MB) são cerca de 77% do arquivo.
- Contagens:
  - 111 normas, entre base, stubs e externas, com 4.891 dispositivos;
  - 202 PPCs, com 20.098 seções e 28.987 citações;
  - 225 cursos e 218 cursos do CNCT;
  - 80 fichas da `revisar-ppc`.

**De onde cada comando do `kb` lê**

| Comando | Lê | Pronto para rodar só com o banco? |
|---|---|---|
| `buscar-norma` | banco | sim |
| `dispositivo` | banco | sim |
| `correspondencia` | banco | sim |
| `cursos` | banco | sim |
| `ppc-fatos` | banco | sim |
| `buscar-secoes` | banco e `packages/kb/dados/sinonimos.yaml` | quase: o léxico vai para o banco |
| `pacote-contexto` | banco, `topicos-fichas.json`, `topicos-secoes.yaml` e o arquivo do PPC (só para medir o tamanho) | quase |
| `resolver` | `manifest.json` e `stubs.yaml` (registro) | não: montar o registro a partir da tabela `normas` |
| `citacoes` | índice de PPCs e Markdown dos PPCs, reprocessados a cada chamada | não: a tabela `citacoes` já tem os dados |
| `vigencia` | front matter, `relacoes.yaml`, `config/vigencia.yaml` | não. O banco tem `vigencias` e `transicoes`, mas não os eventos e pendências que explicam o status |
| `relacoes` | `relacoes.yaml` | não: a tabela `relacoes` já tem os dados |
| `impacto` | textos das skills, fichas, PPCs | parcial: fichas, tópicos e citações estão no banco; os textos das skills, não |
| `adequacao-art71` | `base-conhecimento/institucional/ifpr/cursos/` e Markdown dos PPCs | não: as tabelas `cursos`, `ppcs` e `citacoes` têm os dados |

**Tamanho das saídas em JSON**

| Comando | Tamanho |
|---|---|
| `cursos --campus curitiba` | 71 KB |
| `citacoes br/cne-cp/res/2021/1` | 61 KB |
| `adequacao-art71` | 76 KB |
| `impacto br/cne-cp/res/2021/1` | 41 KB |
| `pacote-contexto CT-CURR-12 curitiba/tecnico-em-enfermagem` | 58 KB, 23% do PPC inteiro |

## Decisões de desenho

1. **Ferramentas por intenção, não espelho da CLI.**
   - **Compostas** onde a IA faria várias chamadas seguidas: `ficha_norma`, `ficha_curso`. São também as fichas que o leitor `ifpr://` do app vai mostrar.
   - **Em lote** onde o normal é ter muitos itens: `resolver_citacoes` e `ler_dispositivos`.
2. **Só leitura, mundo fechado.** Todas as ferramentas levam `readOnlyHint: true`, `idempotentHint: true` e `openWorldHint: false`. Nenhuma acessa a rede.
3. **O banco responde sozinho.** É o [passo T0](#t0--banco-autossuficiente-em-packageskb) e precede todos os outros.
4. **Nenhuma regra em `packages/mcp`.** Os handlers chamam funções de `packages/kb`, só validam a entrada, montam o envelope e formatam o texto. Vale a regra do PLANO-ARQUITETURA: "não reimplementar regras do núcleo fora de `packages/kb`".
5. **Duas formas de saída na mesma resposta:**
   - `structuredContent`: o JSON completo, validado pelo `outputSchema`, para o app e os testes;
   - `content`: um texto Markdown compacto, escrito para a IA ler.

   O M0.5 mede se algum provider entrega as duas formas ao modelo, o que dobraria os tokens, e decide se mantém as duas.
6. **Orçamento de tamanho.** Cada ferramenta tem limite padrão e máximo de itens e um teto de caracteres no texto. Acima disso, a resposta pagina com `cursor` ou devolve um resumo.
7. **Texto literal, fonte e link em cada item,** com avisos explícitos (vigência a confirmar, correspondência em rascunho, fato extraído sem revisão, citação de baixa confiança).
8. **Nomes:**
   - **ferramentas:** em português, verbo e objeto, em `snake_case`;
   - **servidor:** chama-se `ifpr`, e as ferramentas aparecem como `mcp__ifpr__buscar_norma` no Claude Code.
9. **Transporte:**
   - **Marco 0:** stdio, que Claude Desktop, Claude Code, Codex e Gemini CLI aceitam;
   - **Marco 1:** HTTP local, com os mesmos handlers servindo também a API de leitura do app.

## Envelope

Toda ferramenta devolve:

```ts
type Resposta<T> = {
  base: {
    versao: string;          // "2026.11.13"
    commit: string | null;   // commit de origem do pacote; null em banco de desenvolvimento
    data_referencia: string; // data em que a vigência foi calculada
    canal: "dev" | "beta" | "estavel";
  };
  dados: T;
  avisos: Aviso[];
  pagina?: { total: number; devolvidos: number; cursor?: string };
};

type Aviso = {
  tipo:
    | "vigencia-a-confirmar"
    | "correspondencia-rascunho"
    | "fato-extraido"
    | "citacao-baixa-confianca"
    | "stub-sem-texto"
    | "resultado-resumido"
    | "nao-encontrado";
  mensagem: string;
  ref?: string;
};

type Fonte = { path: string; linha_inicio: number; linha_fim: number }; // caminho no repositório de origem
type Link = `ifpr://${string}`;
```

**Tipos comuns**

```ts
type NormaResumo = {
  id: string; titulo: string; situacao: "base" | "stub" | "externo";
  status_vigencia: string | null; vigencia_a_confirmar: boolean;
  data_publicacao: string | null; ementa: string | null; link: Link;
};

type DispositivoTexto = {
  id: string; rotulo: string; tipo: string;
  caput: string[];                     // caput herdado, do mais alto ao mais próximo
  texto: string;
  subordinados: { id: string; rotulo: string; texto: string }[];
  revogado: boolean; vetado: boolean;
  fonte: Fonte; link: Link;
};
```

**Texto para a IA (`content`)**

1. Os avisos, se houver, em linhas que começam com "Atenção:".
2. Os itens, cada um com:
   - o título ou rótulo com o link `ifpr://`;
   - o texto literal em citação (`>`);
   - a linha "fonte: `<path>:<linha_inicio>-<linha_fim>`".
3. A última linha: "Base de 13/11/2026 (commit `dc6b447`)."

## Ferramentas

| # | Ferramenta | Título | Origem no `kb` | Só com o banco hoje? |
|---|---|---|---|---|
| 1 | `buscar_norma` | Buscar norma | `buscar-norma` | sim |
| 2 | `ler_dispositivos` | Ler dispositivos | `dispositivo` | sim |
| 3 | `ficha_norma` | Ficha da norma | `vigencia`, `relacoes`, `impacto` (sucessoras) | não (T0) |
| 4 | `correspondencia` | Correspondência entre normas | `correspondencia` | sim |
| 5 | `resolver_citacoes` | Identificar citações | `resolver` | não (T0) |
| 6 | `citacoes_da_norma` | PPCs que citam a norma | `citacoes` | não (T0) |
| 7 | `impacto_da_norma` | Impacto da norma | `impacto` | parcial (T0) |
| 8 | `adequacao_art71` | Adequação ao art. 71 | `adequacao-art71` | não (T0) |
| 9 | `buscar_secoes` | Buscar em PPCs | `buscar-secoes` | quase (T0) |
| 10 | `ler_secao` | Ler seção de PPC | nova | sim |
| 11 | `listar_cursos` | Listar cursos | `cursos` | sim |
| 12 | `ficha_curso` | Ficha do curso | nova, composta | depende de 6 e 8 |
| 13 | `fatos_ppc` | Fatos do PPC × SUAP | `ppc-fatos` | sim |
| 14 | `pacote_contexto` | Contexto da análise de PPC | `pacote-contexto` | quase (T0) |
| 15 | `sobre_a_base` | Sobre a base | nova | sim |
| 16 | `etapa` | Etapa da tarefa | nova | não se aplica |

As descrições abaixo são o texto que a IA lê. Mudar esse texto muda o comportamento do modelo, e por isso ele entra nas avaliações do M0.5.

### Normas

#### 1. `buscar_norma`

> Busca na legislação e nas normas da base do IFPR. Uma citação ou um ID ("Res. CNE/CP 2/2026, art. 28, VII", "br/lei/1996/9394#art36") vai direto ao dispositivo; termos fazem busca textual nos dispositivos e nos metadados das normas. Use antes de afirmar qualquer obrigação normativa. Devolve o texto literal, com o caput herdado.

```ts
entrada: {
  consulta: string;                          // 1 a 300 caracteres
  limite?: number;                           // 1 a 20; padrão 8
  situacao?: "base" | "stub" | "externo";
  vigentes?: boolean;                        // exclui atos e dispositivos revogados ou ainda não vigentes
  em?: string;                               // AAAA-MM-DD; padrão: data_referencia
}
dados: {
  resultados: {
    norma: NormaResumo;
    dispositivo?: DispositivoTexto;
    metadados?: { texto: string; fonte: Fonte };
    citado_fora_do_texto?: string;           // dispositivo pedido que não existe no texto da norma
    origem: string;                          // "citacao-resolvida", "busca"…
    pontuacao: number | null;
  }[];
}
```

Teto: 8 mil caracteres no texto. Dispositivos longos são cortados com "…" e com a indicação de usar `ler_dispositivos`.

#### 2. `ler_dispositivos`

> Lê dispositivos pelo ID (até 20 por chamada), com o caput herdado, as notas de redação e, se pedido, os incisos, alíneas e parágrafos. Use quando já tiver o ID, vindo de `buscar_norma`, de `resolver_citacoes` ou de uma ficha.

```ts
entrada: { ids: string[] /* 1 a 20, "norma#dispositivo" */; filhos?: boolean /* padrão false */ }
dados: {
  dispositivos: (DispositivoTexto & { notas: string[]; pai: string | null; estrutura: string[] })[];
  nao_encontrados: string[];
}
```

#### 3. `ficha_norma`

> Situação de uma norma numa data: a vigência, com o que a determina e o que está a confirmar; as relações com outras normas nos dois sentidos (revoga, altera, regulamenta, fundamenta-se em); as normas sucessoras; e as regras de transição. Use quando a resposta depender de a norma estar em vigor, revogada ou substituída. Norma revogada não é inaplicável: confira as transições antes de concluir.

```ts
entrada: { id: string; em?: string /* AAAA-MM-DD */ }
dados: {
  norma: NormaResumo & { orgao: string | null; tipo_documento: string | null; numero: string | null; ano: number | null; fonte_oficial: string | null };
  vigencia: {
    data: string; status: string; certo: boolean;
    inicio: { data: string | null; minimo: string | null; certo: boolean };
    eventos: { tipo: string; origem: string; operador: string | null; efeito_minimo: string | null; ocorreu: string }[];
    pendencias: string[];
  };
  relacoes: { entrada: Relacao[]; saida: Relacao[] };
  sucessoras: string[];
  transicoes: {
    id: string; dispositivo: string; tipo: string; norma_anterior: string | null;
    aplica_a: string; regra: string; situacao_na_data: string; evidencia: string; link: Link;
  }[];
}
type Relacao = {
  tipo: string; origem: string; operador: string | null; alvo: string; alvo_dispositivo: string | null;
  evidencia: { em: string; trecho: string }; confirmado_em: string | null;
};
```

Gera o aviso `vigencia-a-confirmar` sempre que houver pendências.

#### 4. `correspondencia`

> Dispositivo correspondente na norma sucessora, por exemplo do art. 20 da Res. CNE/CP 1/2021 para a Res. CNE/CP 2/2026. Use quando um PPC ou documento citar dispositivo de norma revogada. A tabela é rascunho, sem revisão jurídica: trate-a como indicação, nunca como fundamento.

```ts
entrada: { id: string /* com dispositivo; sem ele, todos os artigos */ }
dados: {
  tabela: { status: string; elaborado_em: string | null; revisado_por: string | null };
  itens: {
    origem: DispositivoTexto;
    tipo: string;                            // equivalente, parcial…
    destino: DispositivoTexto[];
    nota: string | null;
    detalhes: { origem: string; tipo: string; destino: string[]; nota: string | null }[];
  }[];
}
```

Gera o aviso `correspondencia-rascunho` enquanto o status da tabela for `rascunho`. Sem dispositivo, pagina de 10 em 10 artigos.

#### 5. `resolver_citacoes`

> Identifica citações normativas escritas em texto livre (até 50 por chamada) e devolve o ID canônico, o dispositivo, a regra usada e a confiança. Use para conferir a fundamentação de um documento. Confiança abaixo de 0,9 pede conferência no trecho original.

```ts
entrada: { citacoes: string[] /* 1 a 50 */ }
dados: {
  itens: {
    texto: string;
    id: string | null;
    dispositivos: string[];
    regra: string; confianca: number;
    situacao: "base" | "stub" | "externo" | "nao-resolvida";
    titulo: string | null; link: Link | null;
  }[];
}
```

#### 6. `citacoes_da_norma`

> PPCs da base que citam uma norma ou um dispositivo, com linha, trecho e confiança. Use quando precisar da lista completa; `impacto_da_norma` traz só uma amostra. Sem `ppc`, devolve um resumo por PPC; com `ppc`, as ocorrências.

```ts
entrada: {
  id: string;
  confianca_min?: number;                    // 0 a 1; padrão 0
  ppc?: string; nivel?: string; campus?: string;
  limite?: number;                           // 1 a 50; padrão 30
  cursor?: string;
}
dados: {
  norma: NormaResumo;
  total_ppcs: number; total_ocorrencias: number;
  ppcs: {
    ppc: string; curso: string; campus: string; nivel: string; forma: string; link: Link;
    ocorrencias: number | { linha: number; trecho: string; regra: string; confianca: number; dispositivo: string | null; link: Link }[];
  }[];
}
```

Gera o aviso `citacao-baixa-confianca` quando alguma ocorrência entregue usa uma das regras `dcnept-2021-orgao-trocado`, `orgao-ausente-registro` ou `orgao-no-documento`.

#### 7. `impacto_da_norma`

> O que uma norma (revogada, alterada ou nova) atinge na base: os PPCs que a citam, as fichas da `revisar-ppc`, as normas que a citam, as relações, as sucessoras e as transições. Use para responder "o que muda com esta norma".

```ts
entrada: { id: string }
dados: {
  norma: NormaResumo; status: string;
  sucessoras: string[];
  transicoes: { id: string; regra: string; situacao_na_data: string; link: Link }[];
  relacoes: Relacao[];
  normas_que_citam: { id: string; titulo: string }[];
  ppcs: { total: number; amostra: { ppc: string; nome: string; campus: string; link: Link }[] };
  fichas: { id: string; titulo: string; papel: string; link: Link }[];
  topicos: string[];
}
```

Os arquivos das skills atingidos ficam fora: servem à curadoria e continuam na CLI. A lista completa de PPCs vem de `citacoes_da_norma`.

#### 8. `adequacao_art71`

> Cursos técnicos em oferta alcançados pelo art. 71 da Res. CNE/CP nº 2/2026, que dá prazo de adequação, com a DCN que cada PPC cita. Use quando perguntarem quais PPCs ainda precisam ser atualizados para a nova DCN da EPT. Sem filtros, devolve os totais por indicador; filtre por campus, curso ou indicador para ver a lista.

```ts
entrada: { campus?: string; curso?: string; indicador?: string; incluir_tecnologia?: boolean; limite?: number; cursor?: string }
dados: {
  criterio: string;
  totais: Record<string, number>;
  cursos: {
    curso: string; nome: string; campus: string; forma_oferta: string | null; ppc_ano: number | null;
    indicador: string; dcn_citadas: { id: string; linhas: number[] }[]; link: Link;
  }[];
}
```

### PPCs e cursos

#### 9. `buscar_secoes`

> Busca trechos dos PPCs da base (todos os campi e níveis), com radicais e sinônimos por tipo de seção. Use para ver como outros cursos escreveram uma seção (estágio, egressos, avaliação…). PPCs são exemplos institucionais, não norma.

```ts
entrada: {
  consulta: string;
  tipo?: string[]; nivel?: string; campus?: string; cnct?: string; forma?: string; ppc?: string;
  limite?: number;                           // 1 a 20; padrão 8
  integral?: boolean;                        // texto inteiro de cada seção; no máximo 5 seções
}
dados: {
  resultados: {
    id: string; ppc: string; curso: string; campus: string; nivel: string; forma: string;
    cnct_id: string | null; tipo: string; titulo: string;
    trecho: { linha: number; texto: string }[];
    texto?: string;
    fonte: Fonte; link: Link; pontuacao: number;
  }[];
}
```

#### 10. `ler_secao`

> Lê uma seção inteira de PPC pelo ID, vindo de `buscar_secoes` ou de um link `ifpr://ppc/…#secao`. Use quando o trecho devolvido por `buscar_secoes` não bastar.

```ts
entrada: { id: string }
dados: {
  secao: { id: string; ppc: string; curso: string; tipo: string; titulo: string; texto: string; fonte: Fonte; link: Link };
  anterior: string | null; proxima: string | null;
}
```

Teto: 20 mil caracteres. Acima disso, a seção pagina por linhas.

#### 11. `listar_cursos`

> Cursos do IFPR na base, com CNCT, eixo, ofertas e turno. Use quando a pergunta envolver vários cursos, como os de um eixo, campus, turno ou processo seletivo, e prefira filtros, porque a lista sem filtro é longa. Para os detalhes de um curso, use `ficha_curso`.

```ts
entrada: {
  eixo?: string; turno?: string; campus?: string; nivel?: string; forma?: string;
  situacao?: string; cnct?: string; processo?: string;
  limite?: number;                           // 1 a 100; padrão 50
  cursor?: string;
}
dados: {
  cursos: {
    id: string; nome: string; campus: string; nivel: string; forma_oferta: string | null;
    modalidade: string | null; situacao: string | null;
    cnct: { id: string; nome: string; eixo: string } | null;
    ppc: { id: string; ano: number | null } | null;
    turnos: string[]; link: Link;
  }[];
}
```

Cada curso vem numa linha compacta, sem o detalhe das ofertas. Assim, Curitiba cabe em poucos KB em vez de 71 KB.

#### 12. `ficha_curso`

> Tudo sobre um curso do IFPR: dados institucionais, PPC vigente, CNCT, ofertas, fatos do PPC cruzados com o SUAP (divergências), normas que o PPC cita e prazos de adequação. Use quando a pergunta for sobre um curso específico.

```ts
entrada: { curso: string /* "campus/curso" ou "curso:campus/curso" */ }
dados: {
  curso: { id: string; nome: string; nivel: string; forma_oferta: string | null; modalidade: string | null; situacao: string | null; link: Link };
  campus: { id: string; nome: string; link: Link };
  cnct: { id: string; nome: string; eixo: string; carga_horaria_minima: number | null; link: Link } | null;
  ppc: { id: string; ano: number | null; link: Link; secoes: { id: string; tipo: string; titulo: string }[] } | null;
  ofertas: { processo: string; turno: string | null; vagas: number | null }[];
  fatos: FatosPpc | null;
  normas_citadas: { id: string; titulo: string; status_vigencia: string | null; ocorrencias: number; link: Link }[];
  adequacao_art71: { indicador: string } | null;
  transicoes_aplicaveis: { id: string; regra: string; situacao_na_data: string; link: Link }[];
}
```

É composta das consultas de cursos, `ppc-fatos`, citações e adequação. É também o conteúdo do link `ifpr://curso/…` no app.

#### 13. `fatos_ppc`

> Fatos extraídos de PPCs (carga horária, estágio, ano), com o trecho de origem, cruzados com as matrizes do SUAP publicadas na base. Use quando a pergunta cobrir vários PPCs ou só as divergências; para um curso, `ficha_curso` já traz os fatos. Os fatos são extraídos por regra, sem revisão humana: confira o trecho antes de afirmar uma divergência.

```ts
entrada: { ppc?: string; divergencias?: boolean; nivel?: string; campus?: string; limite?: number; cursor?: string }
dados: {
  ppcs: FatosPpc[];
  totais?: Record<string, Record<string, number>>; // com divergencias: true
}
type FatosPpc = {
  ppc: string; curso: string; nome: string; campus: string; nivel: string; forma: string; link: Link;
  fatos: { fato: string; valor: string; valor_num: number | null; unidade: string | null; status_curadoria: string; regra: string; trecho_fonte: string; fonte: Fonte }[];
  suap: { situacao: string; carga_horaria_comum_h: number | null; matrizes: { matriz_id: number; ano: number; ch_exibida_h: number | null; ch_estagio_h: number | null; trecho: string }[] } | null;
  cruzamento: { aspecto: string; resultado: string; valor_ppc: string | null; valor_suap: string | null; explicacao: string }[];
};
```

Gera o aviso `fato-extraido` sempre.

### Análise de PPC

#### 14. `pacote_contexto`

> Monta o contexto de uma tarefa da skill `revisar-ppc` para um PPC: fichas, CNCT, dispositivos citados nas fichas, marcos, transições, seções relevantes do PPC e fatos. Use dentro da `revisar-ppc`. Aceita um PPC da base ou um arquivo `.md` da pasta de trabalho.

```ts
entrada: {
  tarefa: string;                            // CT-CURR-12, CT-CURR-12,CT-IDENT-01, estagio, grupo-001 ou todas
  ppc?: string;                              // PPC da base
  arquivo?: string;                          // .md na pasta de trabalho; exatamente um de ppc/arquivo
}
dados: PacoteContexto                        // o tipo de packages/kb/src/db/pacote-contexto.ts
```

- **Teto:** 80 mil caracteres, porque esta ferramenta existe justamente para entregar contexto. O campo `tamanho` informa quanto do PPC inteiro foi usado.
- **Arquivo:** o `simplifica-mcp` só lê arquivos dentro da pasta de trabalho informada na inicialização (`--pasta-trabalho`, padrão: o diretório atual). Caminho fora dela é recusado.

### Base e app

#### 15. `sobre_a_base`

> Versão, data de referência e conteúdo da base. Use quando o usuário (um servidor do IFPR) perguntar o que a base contém ou de quando ela é.

```ts
entrada: {}
dados: { contagens: Record<string, number>; tipos_de_secao: string[]; niveis: string[]; campi: { id: string; nome: string }[] }
```

#### 16. `etapa`

> Informa ao app em que etapa da tarefa você está. Use só quando a skill pedir.

```ts
entrada: { id: string; progresso?: { feito: number; total: number } }
dados: { registrado: boolean }               // false fora do app
```

Até o Marco 1, não faz nada. Já existe no M0 para que as skills possam chamá-la desde o início.

### Acréscimos do T2 e do T3

Decididos na implementação, além do que as seções acima pedem. O código e os testes de contrato seguem esta lista.

**Tetos de texto por ferramenta** (caracteres do `content`; os testes conferem cada um):

| Ferramenta | Teto | Acima do teto |
|---|---|---|
| `buscar_norma` | 8 mil | corta os literais mais longos com "…" |
| `ler_dispositivos` | 20 mil | corta os literais mais longos com "…" |
| `ficha_norma` | 12 mil | corta o fim, com uma linha explicando |
| `correspondencia` | 16 mil | corta os literais; sem dispositivo, pagina de 10 em 10 artigos |
| `resolver_citacoes` | 12 mil | corta o fim, com uma linha explicando |
| `citacoes_da_norma` | 8 mil | pagina |
| `impacto_da_norma` | 8 mil | resume cada lista; a completa fica no JSON |
| `adequacao_art71` | 8 mil | pagina |
| `buscar_secoes` | 8 mil; 30 mil com `integral` | divide o espaço entre as seções |
| `ler_secao` | 20 mil | pagina por linhas |
| `listar_cursos` | 8 mil | pagina |
| `ficha_curso` | 12 mil | resume cada lista; a completa fica no JSON |
| `fatos_ppc` | 12 mil | pagina |

As listas paginam pelo `limite` e pelo teto ao mesmo tempo: a página acaba no que vier primeiro.

**Campos e entradas acrescentados:**

- `Relacao` (em `ficha_norma` e `impacto_da_norma`): `alcance` e `nota`, ambos anuláveis. `NormaResumo` e `Relacao` são um só schema para todas as ferramentas.
- `ficha_norma`: nos eventos de vigência, `alvo_dispositivo`, `alcance` e `efeito_de`; nas transições, `inicio_em` e `fim_em`.
- `correspondencia`: entrada `cursor`, para a paginação sem dispositivo. A `tabela` traz também `arquivo`, `origem` e `destino`, e é `null` quando a norma não tem tabela; cada item traz `herdado_de`, o dispositivo da tabela de que veio quando o pedido não tem linha própria.
- `resolver_citacoes`: situação `nao-registrada`, para ID reconhecido que não está no registro da base.
- `citacoes_da_norma`: `id` (o ID consultado, com o dispositivo) e a `fonte` de cada ocorrência.
- `impacto_da_norma`: `data_referencia`; `dispositivos` e `link` em `normas_que_citam`; `dispositivos` em `fichas`.
- `adequacao_art71`: `regras` em `dcn_citadas`, as regras do resolvedor que acharam cada DCN.
- `ler_secao`: entrada `cursor`, para o trecho seguinte de uma seção acima do teto.
- Anuláveis: `curso.nivel` e `cnct.eixo` em `ficha_curso`; `curso`, `suap.situacao` e `suap.matrizes[].ano` em `FatosPpc` (`fatos_ppc` e `ficha_curso`).

### Acréscimos do T4

Decididos na implementação do `pacote_contexto`:

- **Dados:** o pacote do kb como está, o mesmo JSON de `kb pacote-contexto --json` (paridade byte a byte no smoke). O de um PPC da base e o de um arquivo têm formas diferentes (o do arquivo traz `path`, `escopo` e `tamanho` reduzido, e não traz `tarefa`, `ppc` nem `fatos`), e o `outputSchema` é a união das duas. As partes sem forma fixa no kb (fichas, CNCT, fatos, as normas de um marco) ficam livres no schema.
- **Exatamente um de `ppc` e `arquivo`:** conferido no serviço `Leitura`, e não no schema, para o JSON Schema continuar um objeto simples; a mensagem diz os dois caminhos.
- **Teto de 80 mil caracteres no texto.** Acima dele, os literais mais longos (seções, dispositivos, transições) são cortados por igual, nunca abaixo de 300 caracteres, e cada um continua com o ID, a fonte e a indicação de onde ler o resto (`ler_secao`, `ler_dispositivos` ou as linhas do arquivo). Se nem assim couber (`todas`), corta-se o fim do texto, com uma linha explicando. O JSON continua inteiro, e o aviso `resultado-resumido` sai sempre que algo é cortado. As fichas vêm sempre inteiras, porque nenhuma outra ferramenta as entrega.
- **Avisos:** `vigencia-a-confirmar` (transições ou normas a confirmar na data), `stub-sem-texto` (dispositivo citado pela ficha sem texto na base), `fato-extraido` (PPC da base com fatos) e `citacao-baixa-confianca` (citações do PPC nos marcos).
- **Pasta de trabalho:** caminho relativo à pasta ou absoluto dentro dela. A recusa do `..` e do caminho absoluto de fora acontece antes de tocar no disco, sem revelar se o arquivo de fora existe; o `realPath` vem depois da checagem de existência e recusa o symlink para fora. Só `.md`, até 8 MB. O `FileSystem` entra só no serviço `PastaTrabalho` do `packages/mcp`; o `Leitura` o recebe como opcional, e sem ele (`layerLeitura`, o do app) o `arquivo` é recusado. O stdio usa `layerLeituraComPasta`.

## Instruções do servidor

O arquivo é `packages/mcp/instrucoes.md`. Ele vira o campo `instructions` do servidor MCP, e o `AGENTS.md` passa a apontar para ele na parte de consulta. Muitos clientes injetam as instruções em toda conversa, então o texto tem no máximo 400 palavras. Conteúdo:

1. **O que é a base:** normas, PPCs vigentes do IFPR, cursos, CNCT e fichas da `revisar-ppc`, com data de referência.
2. **Citação:**
   - cite com o link `ifpr://` e o texto literal;
   - nunca afirme uma obrigação normativa sem antes buscar o dispositivo.
3. **Vigência:**
   - confira a vigência (`ficha_norma`) antes de concluir;
   - norma revogada não é inaplicável: veja as transições;
   - diga quando a vigência estiver "a confirmar".
4. **Confiança:**
   - citações extraídas de PPC com regra de baixa confiança e fatos com status `extraido` pedem conferência no trecho;
   - a tabela de correspondência é rascunho.
5. **PPCs:** são exemplos institucionais, não norma.
6. **Fora da base:** se a base não tem a informação, diga isso. Não preencha com memória.
7. **Versão:** informe a data da base quando a resposta depender dela.

**Revisão do T5 (14/11/2026).** O texto cita as 16 ferramentas por intenção ("antes de afirmar uma obrigação, ache o dispositivo", "para ver como outros cursos escreveram uma seção"), sem repetir as descrições delas; um teste confere que nenhuma frase longa de descrição volta inteira. Para caber o item novo, **Revisão de PPC** (dentro da `revisar-ppc`, peça o contexto a `pacote_contexto` em vez de montá-lo com várias chamadas; `etapa` só quando a skill pedir), os itens 6 e 7 viraram um só, "Fora da base e versão". Tem 355 palavras; `test/instrucoes.test.ts` confere o limite, as 16 ferramentas, o link `ifpr://`, o texto literal, os selos "a confirmar" e `extraido`, o PPC como exemplo e o `pacote_contexto`. O `AGENTS.md` aponta para o arquivo na parte de consulta.

## T0 — Banco autossuficiente (em `packages/kb`)

O objetivo é que todas as ferramentas respondam abrindo só o `kb.sqlite`, em modo somente leitura. A abordagem é trocar a fonte de dados das funções que já existem, sem reescrever regras.

| Item | Como |
|---|---|
| Versão no banco | `meta` ganha `versao`, `commit` e `canal`. A data vem do commit, nunca do relógio |
| Léxico e tópicos | `sinonimos.yaml`, `topicos-secoes.yaml` e `topicos-fichas.json` viram tabelas, compiladas junto com o resto |
| Registro de normas | Montado da tabela `normas` (com `aliases_json` e `front_matter_json`), alimenta o `resolverCitacao` |
| Citações | Consulta à tabela `citacoes`, no lugar de reprocessar os Markdown |
| Vigência | `statusEm` e `transicoesAplicaveis` recebem datas e relações lidas do banco (`front_matter_json`, `relacoes`), e a `data_referencia` vem de `meta` |
| Relações | Consulta à tabela `relacoes` |
| Adequação ao art. 71 | Consulta às tabelas `cursos`, `ppcs` e `citacoes` |
| Impacto | Versão sem os textos das skills. Fichas, tópicos, citações, relações e transições vêm do banco |
| Tamanho do PPC no pacote de contexto | Soma das seções, ou um campo novo em `ppcs` |
| Abertura do banco | `abrirBanco({ caminho, somenteLeitura: true, recompilar: false })` |

**Critério de aceite do T0**

- **Paridade:** para cada comando listado, a saída a partir do banco é igual à saída a partir dos arquivos, no mesmo commit (testes em `db/base.test.ts`, que já faz isso para `dispositivo` e `correspondencia`).
- **Sem repositório:** um teste copia o `kb.sqlite` para um diretório temporário vazio e roda todas as ferramentas a partir dele, sem acesso ao repositório.

**Coordenação.** A outra conversa está revisando alterações em `packages/kb` (há mudanças não commitadas em `db/comandos.ts`). O T0 começa depois que esse code review entrar em `main`.

## Estrutura do pacote

```
packages/mcp/
├── package.json        # @simplifica-if/mcp; effect (peer), @simplifica-if/kb; exports ./toolkit, ./rpc, ./contratos
├── instrucoes.md
├── src/
│   ├── cli.ts          # effect/cli: --banco, --pasta-trabalho, --canal; McpServer.layerStdio
│   ├── servidor.ts     # layerStdio, layerLeitura, layerRegistro
│   ├── contratos.ts    # Effect Schema do envelope e dos tipos comuns
│   ├── leitura/        # serviço Leitura: um método por ferramenta (envelope, paginação, orçamento)
│   ├── envelope.ts     # base, avisos, paginação, cursor
│   ├── links.ts        # ids canônicos → ifpr://
│   ├── texto.ts        # Markdown compacto para a IA
│   ├── ferramentas/    # um arquivo por ferramenta (Tool.make, descrição, texto); toolkit.ts, registrar.ts
│   ├── toolkit.ts      # @simplifica-if/mcp/toolkit
│   └── rpc.ts          # @simplifica-if/mcp/rpc: GrupoLeitura
└── test/
```

- **Stack (C2 da consolidação, 14/11/2026):** Effect 4 (`effect/ai`), no lugar do SDK 2.x com zod. Cada ferramenta é um `Tool.make`, reunidas no Toolkit `FerramentasIfpr`, registrado por `registrarFerramentas` sobre `McpServer.addTool`: o `content` continua o Markdown compacto, e a entrada inválida continua um resultado `isError` com a mensagem em português. O stdio usa `McpServer.layerStdio`, que atende `2025-06-18`, `2025-11-25` e `2026-07-28` (testado com os clientes do SDK 1.23 e 2.4). Os JSON Schemas saem do Effect Schema e são equivalentes aos do zod pelo teste de equivalência (forma normalizada e veredito do ajv). Detalhes e desvios: [consolidação, C2](consolidacao-stack-t3.md#c2--packagesmcp-em-effect).
- **HTTP local (Marco 1):** o fork monta o Toolkit num `McpServer.layerHttp` próprio, em `/mcp/ifpr`, ao lado do servidor do T3 (com `Layer.fresh`), e o leitor usa o grupo RPC `GrupoLeitura`, sobre o mesmo serviço `Leitura`. Na frente do HTTP local, validação de Host e Origin, contra DNS rebinding.
- **Banco de versão diferente:** um banco com `versao_esquema` diferente do esperado gera um erro claro: "base incompatível com esta versão do simplifica-mcp; atualize".
- **Links:** `links.ts` pode morar em `packages/kb`, se o app e o site também forem gerar links `ifpr://`.

## Testes

| Teste | O que confere |
|---|---|
| Contrato | Cada ferramenta, com entradas válidas e inválidas: a saída passa no `outputSchema`, e a entrada inválida dá erro legível |
| Paridade | Ferramenta × comando da CLI, no mesmo banco: mesmos IDs, textos e totais |
| Sem repositório | Todas as ferramentas a partir de um diretório vazio com só o `kb.sqlite` |
| Orçamento | Nenhum texto acima do teto da ferramenta; paginação completa e sem repetição |
| Determinismo | Mesma entrada e mesmo banco dão a mesma saída, byte a byte |
| Descrições | Tamanho máximo, e todas citam quando usar a ferramenta. As avaliações de escolha de ferramenta ficam no M0.5 |
| Pasta de trabalho | `pacote_contexto` recusa caminho fora da pasta, inclusive por `..` e por symlink |

As suítes estão em `packages/mcp/test/transversal/`, uma por linha da tabela, e rodam no CI (`.github/workflows/ci.yml`); ver o README do pacote e o andamento do T6.

## Configuração no piloto zero

O guia de instalação para quem não é técnico, com os caminhos absolutos no macOS e no Windows e as fontes oficiais de cada cliente, é o [guia do piloto zero](../guia-piloto-zero.md) (T7). O que segue é o resumo técnico.

Para rodar a partir do checkout, o comando é `node /caminho/simplifica-if/packages/mcp/src/cli.ts --banco /caminho/kb.sqlite` (Node da versão de `.node-version`). O executável `simplifica-mcp`, um Node SEA que não precisa de Node instalado, sai de `pnpm mcp:executavel` em `packages/mcp/dist-exe/` (`--alvo` ou `--todos` para outras plataformas).

```bash
# Claude Code
claude mcp add ifpr -- simplifica-mcp --banco ~/SimplificaIF/kb.sqlite
```

```json
// Claude Desktop: claude_desktop_config.json
{ "mcpServers": { "ifpr": { "command": "simplifica-mcp", "args": ["--banco", "~/SimplificaIF/kb.sqlite"] } } }
```

```toml
# Codex: ~/.codex/config.toml
[mcp_servers.ifpr]
command = "simplifica-mcp"
args = ["--banco", "~/SimplificaIF/kb.sqlite"]
```

- **Gemini CLI:** a mesma estrutura de `mcpServers`, em `~/.gemini/settings.json`.
- **T3 Code:** usa a configuração MCP de cada provider (Claude, Codex), então o servidor aparece lá sem passo extra.
- **Caminho:** o `~` precisa ser expandido no guia de instalação, porque nem todo cliente o expande.

## Ordem de implementação

| Passo | Entrega | Depende de |
|---|---|---|
| T0 | Banco autossuficiente | code review da outra conversa em `main` |
| T1 | Esqueleto de `packages/mcp`: servidor, CLI, banco, envelope, links, texto; ferramentas `sobre_a_base` e `etapa` | — (pode começar antes do T0) |
| T2 | Normas: `buscar_norma`, `ler_dispositivos`, `correspondencia`, `resolver_citacoes`, `ficha_norma` | T1; T0 para as duas últimas |
| T3 | PPCs e cursos: `buscar_secoes`, `ler_secao`, `listar_cursos`, `fatos_ppc`, `citacoes_da_norma`, `adequacao_art71`, `impacto_da_norma`, `ficha_curso` | T1, T0 |
| T4 | `pacote_contexto` com arquivo da pasta de trabalho | T0 |
| T5 | `instrucoes.md` e ponteiro no `AGENTS.md` | T2, T3 |
| T6 | Testes de paridade, sem repositório, orçamento e determinismo no CI | T2 a T4 |
| T7 | Guia de instalação de uma página para o piloto zero | T5 |

## Critério de aceite do M0.1

- **Testes:** as 16 ferramentas passam nos testes de contrato, paridade, sem repositório, orçamento e determinismo.
- **Uso real:** no Claude Code e no Codex, com a configuração acima, 10 perguntas reais da PROENS/DENS recebem resposta com citação `ifpr://` e texto literal, sem a IA recorrer a shell ou a arquivos do repositório.
- **Instruções:** `instrucoes.md` tem no máximo 400 palavras, e o `AGENTS.md` aponta para ele sem repetir o conteúdo.

## Decisões em aberto

1. **Formato do texto para a IA:** Markdown compacto ou JSON. Fica Markdown por padrão, e o M0.5 mede tokens e acerto por provider.
2. **Nome do servidor MCP:** `ifpr` (curto e claro nos nomes das ferramentas) ou `simplifica`.
3. **`adequacao_art71`:** fica específica enquanto as transições não forem genéricas. Quando forem, vira `adequacao(norma)`.
4. **Versão do pacote:** `AAAA.MM.DD`, com sufixo `.2`, `.3`… se houver mais de uma no mesmo dia.

## Andamento

- 13/11/2026: T1 pronto no branch `t3/mcp-servidor-leitura` (commits `834d394` e `2b58b70`, sem merge).
  - SDK 1.32.2 com `registerTool` e schemas do zod 4.
  - `sobre_a_base` e `etapa` implementadas; 50 testes.
  - Binário compilado de 84 MB, dos quais 83 MB são o runtime do Bun; ele funciona a partir de um diretório só com o `kb.sqlite`. Desde o C0 da [consolidação](consolidacao-stack-t3.md) (14/11/2026), o executável é um Node SEA de 141 MB, gerado por `pnpm mcp:executavel`.
  - `instrucoes.md` entra por import de texto, porque `readFileSync` falha dentro do binário.
- 13/11/2026: T0 pronto no branch `t3/mcp-banco-autossuficiente` (commit `bcb127b`, sem merge).
  - Esquema 3: tabelas `sinonimos_*`, `topicos_secoes` e `normas_citacoes`; `meta` com `versao`, `commit` e `canal` quando o build os informa.
  - Funções para o MCP em `@simplifica-if/kb/db/modo-banco`.
  - Paridade byte a byte entre banco e arquivos; teste sem repositório com `node:fs` vigiado.
  - Binário compilado testado; build determinístico.
  - Diferença aceita: `impacto` no modo banco traz só as fichas como arquivos atingidos.
- 13/11/2026: migração para o SDK 2.x decidida e feita (commit `7268684`).
  - O codemod oficial fez quase tudo: 14 linhas em `src/`.
  - 83 dependências a menos.
  - O binário cresceu 66 KB.
  - Testado com o Claude Code 2.1.323 e com clientes do SDK 1.23, que é a versão usada pelo Gemini CLI.
- 13/11/2026: T1 e T0 integrados em `main` (`d071fe4`, `c8ea1dd`), mais a fixture ajustada ao esquema 3 (`83131ea`). Verificação completa: 825 testes, nenhuma falha; base válida.
- 14/11/2026: decidido manter o SDK 2.x com zod, sem Effect, no Marco 0. T2 (normas) e T3 (PPCs e cursos) começaram em paralelo, em worktrees separadas, sobre `@simplifica-if/kb/db/modo-banco`.
- 14/11/2026: T2 e T3 integrados em `main` (`3be531e`, `ed9f5b2`).
  - `NormaResumo` e `Relacao` num só módulo, `packages/mcp/src/ferramentas/tipos-comuns.ts`; a `Relacao` ficou com a união dos campos (`alcance` e `nota`).
  - Os dois smokes contra o `tmp/kb.sqlite` só rodam com `SIMPLIFICA_SMOKE=1` (`pnpm mcp:smoke`, 12 testes); o `pnpm test` não depende do banco.
  - Frase "Use quando…" nas sete descrições que não a tinham; o teste de contrato exige "Use" em todas.
  - Verificação: 1001 testes, nenhuma falha (12 do smoke pulados); smoke sem falha; `tools/list` pelo stdio com 15 ferramentas; base válida.
- 14/11/2026: T4 pronto no branch `t3/mcp-contexto-instrucoes-guia`: `pacote_contexto`, a 16ª ferramenta (ver "Acréscimos do T4").
  - Serviço `PastaTrabalho` (`packages/mcp/src/leitura/PastaTrabalho.ts`), o único com `FileSystem`; a CLI passa o `--pasta-trabalho` a ele.
  - Testes: contrato, determinismo, orçamento, pasta de trabalho (`..`, absoluto, symlink para fora, arquivo inexistente, pasta com nome `.md`) e `ppc` contra `arquivo` (`test/pacote-contexto.test.ts`, 16); paridade byte a byte com `kb pacote-contexto` no smoke (`test/smoke-pacote-contexto.test.ts`, 4, em `pnpm mcp:smoke`).
  - Gabarito do MCP: `gabarito.ts --atualizar pacote_contexto` acrescentou a definição e três chamadas, sem mexer no resto (`testes-gabarito/README.md`). `tools/list` com 16 ferramentas.
  - Verificação: 1259 testes, nenhuma falha (17 pulados: 16 do smoke e 1 do sei-cli); smoke com 16 testes, sem falha; gabarito equivalente (16 ferramentas, 36 chamadas); base válida.
- 14/11/2026: T5 pronto no mesmo branch: `instrucoes.md` revisto (ver "Revisão do T5"), 355 palavras, módulo gerado conferido com `pnpm mcp:instrucoes --check`; ponteiro no `AGENTS.md`; gabarito com as instruções novas (`gabarito.ts --atualizar instrucoes`).
- 14/11/2026: T7 pronto no mesmo branch: [guia do piloto zero](../guia-piloto-zero.md), para a PROENS/DENS e as coordenações.
  - Cobre os dois arquivos (preparados pela equipe até o M0.2), onde pô-los no macOS e no Windows, a configuração de Claude Desktop, Claude Code, Codex e Gemini CLI com caminho absoluto, uma pergunta de teste com o resultado esperado e o que fazer se o servidor não aparecer.
  - Comandos e formatos conferidos na documentação oficial de cada cliente, citada no fim do guia. A página do Gemini CLI informa que ele foi substituído pelo Antigravity CLI em 18/06/2026; o guia registra isso, e a configuração do Antigravity fica para o M0.2.
  - Claude Code testado de verdade (2.1.323): `claude mcp add --scope project` num diretório temporário, com o executável SEA (`pnpm mcp:executavel`, 142 MB) e o `kb.sqlite` reais; uma pergunta pelo `claude -p --mcp-config` respondeu com o link `ifpr://cnct/tecnico-em-enfermagem` e a data da base; servidor removido em seguida, sem tocar na configuração global.
  - Pendente para o M0.2: distribuição pronta (download ou instalador), assinatura de código no macOS e no Windows, e o nome final do `.exe` (hoje o alvo `win-x64` sai com o sufixo do alvo e a equipe o renomeia).
- 14/11/2026: **T6 pronto** no branch `t3/mcp-t6-suites-ci`: as suítes transversais e o CI no GitHub Actions. Commits `c69fab3` (suítes), `6f2d5f7` (CI), `296c351` (pasta isolada) e `369dc1a` (merge de `main` com o T4, T5 e T7, e o `pacote_contexto` nas suítes).
  - **Suítes** (`packages/mcp/test/transversal/`), sobre todas as ferramentas de `FERRAMENTAS`. Tiram as entradas de `amostras.ts` e os casos de paridade de `paridade.ts`, dois registros indexados pelo nome da ferramenta: uma ferramenta nova sem amostra ou sem caso quebra o `typecheck` e os testes. 77 casos; o `pnpm test` roda 43, os da fixture, e o `pnpm mcp:smoke` roda os 77, com os da base real.
    - contrato, 18 casos: a cobertura das amostras e a paginação declarada; e, por ferramenta, pelo protocolo, as válidas no `inputSchema` e no `outputSchema` (ajv e Effect Schema) e as inválidas com `isError` e mensagem em português que nomeia o campo;
    - paridade, 17 casos: 16 com a CLI `kb` e a cobertura. Reúne `banco-real.test.ts`, `smoke-base-real.test.ts` e `smoke-pacote-contexto.test.ts`, que saíram, com as mesmas comparações; `sobre_a_base` compara as contagens com as tabelas do banco, e `etapa` registra por que não tem comando;
    - sem repositório, 4 casos: cada fixture e a base real numa pasta só com o `kb.sqlite`. O servidor é o executável (`SIMPLIFICA_MCP_EXE`) ou o bundle no Node com `--permission`, e um controle negativo confere que o modelo de permissões está ativo. As respostas são iguais às do processo de teste, e a pasta fica intacta;
    - orçamento, 32 casos: textos no teto, e a paginação com mais de uma página, sem repetir nem pular item, na fixture e na base real;
    - determinismo, 4 casos: dois processos em stdio dão as linhas de resposta iguais byte a byte;
    - descrições, 1 caso: tamanhos, a frase de quando usar, os parâmetros descritos e o `tools/list` sem `outputSchema` abaixo de 24 mil caracteres;
    - pasta de trabalho, 1 caso: o `pacote_contexto` com `arquivo` pelo servidor isolado. Lê dentro da pasta (relativo, subpasta, absoluto) e recusa `..`, absoluto de fora e link simbólico para fora, de arquivo e de pasta, sem acesso negado no stderr.
  - **CI** (`.github/workflows/ci.yml`, com o preparo em `.github/actions/preparar`): em todo push e PR, sem segredos e sem Notion, SEI ou SUAP. O preparo usa o Node de `.node-version`, o corepack 0.36.0 instalado à parte (o Node 25 deixou de distribuí-lo), o pnpm de `packageManager`, o cache do store e `pnpm install --frozen-lockfile`.
    - `verificacao` (`ubuntu-24.04`): `fmt:check`, `lint`, `typecheck`, `test`, `kb compilar`, `mcp:smoke`, `validar_base.ts`, `kb.sh --comparar`, `base.sh --comparar` e o gabarito do MCP. Estimativa de 6 a 8 min;
    - `executavel` (`macos-15`, `ubuntu-24.04`, `windows-2025`): `pnpm mcp:executavel`, as suítes sem repositório, determinismo e pasta de trabalho contra o executável, e o executável como artefato `simplifica-mcp-<alvo>` (14 dias). Estimativa de 3 a 6 min cada.
  - **Validação e reprodução local:**
    - `actionlint` 1.7.12, com o `shellcheck` 0.11.0, binários oficiais numa pasta temporária: nenhum erro. O script do preparo também passa no `shellcheck`;
    - macOS (esta máquina): todos os passos dos dois jobs, mais o `banco.sh`. Foram 1340 casos, 1305 passando e 35 pulados, sem falha; `mcp:smoke` 77/77; os quatro gabaritos iguais; o executável `darwin-arm64` passa nas três suítes de processo;
    - Linux, em Docker (`node:26.12.1-bookworm`): os passos do job `verificacao` em arm64, todos sem falha, em cerca de 3,5 min fora o preparo (`pnpm test` 135 s); os do job `executavel` em amd64 emulado (`linux-x64`): o executável passa nas três suítes de processo.
    - O Windows não foi testado aqui. O ambiente mínimo do filho tem `SystemRoot`, e os casos de link simbólico são pulados no Windows. O primeiro run no GitHub vai dizer.
  - Desvios e achados:
    1. **`banco.sh` fora do CI.** O texto do `.dump` muda com o build do `sqlite3`, e não com o banco: o 3.40 do Debian escreve `replace(…, char(10))` onde o 3.54 escreve `unistr(…)`, e o 3.54 do sqlite.org escreve `0` onde o da Apple escreve `0.0`. O banco compilado no Linux, despejado pelo `sqlite3` do macOS, é igual ao gabarito. Os outros gabaritos rodam no Linux sem diferença.
    2. **O `node:sqlite` não passa pelo modelo de permissões no Node 26.12:** abre um banco fora da pasta permitida. O isolamento do banco vem de a pasta só ter o `kb.sqlite`. O controle negativo usa uma leitura pelo `fs` (a `--pasta-trabalho` de fora), que é negada.
    3. **`realpath` e modelo de permissões.** O `realpath` em JavaScript do Node (o do `FileSystem` do Effect, fora do Windows) faz `lstat` dos diretórios ancestrais, e o modelo de permissões nega isso. No Node, um gancho de pré-carga troca pelo `realpath` nativo. O executável aceita `--permission` pelo `NODE_OPTIONS`, mas não o gancho, e por isso roda a suíte sem o modelo de permissões.
    4. **`listar_cursos` não diz quando usar** ("Use filtros: …"). A descrição é a da especificação e do gabarito, e por isso fica como exceção nomeada em `descricoes.test.ts`, que falha quando a exceção deixar de ser necessária.
    5. **Rosetta.** Ao reproduzir o job `linux-x64` num Mac, a emulação x86 do Docker grava `.cache/rosetta` no `HOME` do processo, que é a pasta isolada. A conferência da pasta ignora só esse caminho, que não existe no runner.
    6. **Gabarito de contagem.** `testes-gabarito/testes.txt` e `testes-smoke.txt`, do C0, ainda listam os três smokes que viraram `paridade.ts`. Não foram regerados, porque o gabarito só muda por decisão explícita.
  - Pendências:
    - o primeiro run do workflow no GitHub, depois do push, em especial o job do Windows;
    - rodar o executável também sob `--permission`, trocando o `realpath` da `PastaTrabalho` e da CLI pelo nativo;
    - uma descrição de `listar_cursos` que diga quando usar, com o gabarito do MCP atualizado (`gabarito.ts --atualizar listar_cursos`);
    - decidir se o `banco.sh` passa a comparar um formato independente do `sqlite3`, para entrar no CI.
