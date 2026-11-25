/**
 * Os links `ifpr://` como recursos MCP (M1.5): `resources/templates/list` anuncia um modelo de URI por
 * tipo de link, `resources/read` lê qualquer link que as ferramentas devolvem, e `resources/list` traz
 * só alguns pontos de entrada (as normas centrais e os campi), não a base inteira.
 *
 * A leitura é a das ferramentas, pelo serviço `Leitura`: norma (`ficha_norma`), dispositivo
 * (`ler_dispositivos`), curso (`ficha_curso`) e seção de PPC (`ler_secao`); PPC sem seção, CNCT,
 * campus e ficha têm leitura própria (`leitura/recursos.ts`). O conteúdo é o texto Markdown da
 * ferramenta, com os avisos e o rodapé da versão da base, e a `base` e os avisos vão também no `_meta`.
 *
 * `lerRecurso` devolve um `LinkLido` (`grupo-leitura.ts`), com o tipo do conteúdo, a `Resposta`
 * estruturada e o texto do `resources/read`.
 *
 * Com uma `SessaoAtual` no contexto (o servidor HTTP), cada leitura é registrada nela como as chamadas
 * de ferramenta, com `tipo: "recurso"` e o URI no lugar do nome da ferramenta (`observarChamada`).
 *
 * Os modelos casam pelo tipo (`ifpr://norma/*`, …) e todos chamam o mesmo leitor, que desmonta o link
 * (`lerLink`) e responde ao link malformado com `InvalidParams` em português. Um modelo curinga,
 * escondido do `resources/templates/list` por uma visibilidade, pega o link de tipo desconhecido e o
 * que nem é `ifpr://`, que sem ele voltariam com a mensagem em inglês do `effect/ai`.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer } from "effect/ai";
import { EntradaInvalida, type ErroDeLeitura, type Resposta } from "../contratos.ts";
import { fichaCurso } from "../ferramentas/ficha-curso.ts";
import { fichaNorma } from "../ferramentas/ficha-norma.ts";
import { lerDispositivos } from "../ferramentas/ler-dispositivos.ts";
import { lerSecao } from "../ferramentas/ler-secao.ts";
import type { LinkLido } from "../grupo-leitura.ts";
import * as Leitura from "../leitura/Leitura.ts";
import { lerLink, linkCampus, linkNorma, type TipoLink, TIPOS_LINK } from "../links.ts";
import { observarChamada, resumoDaLeitura, resumoDoTexto } from "../SessaoAtual.ts";
import { linhaAviso, rodape } from "../texto.ts";
import * as Conteudos from "./conteudos.ts";

export const MIME_RECURSO = "text/markdown";

export interface ModeloDeRecurso {
  readonly tipo: TipoLink;
  /** Modelo de URI (RFC 6570) anunciado em `resources/templates/list`. */
  readonly uriTemplate: string;
  readonly titulo: string;
  readonly descricao: string;
}

/** Um modelo por tipo de link, na ordem de `TIPOS_LINK`. */
export const MODELOS: ReadonlyArray<ModeloDeRecurso> = [
  {
    tipo: "norma",
    uriTemplate: "ifpr://norma/{+norma}{#dispositivo}",
    titulo: "Norma ou dispositivo",
    descricao:
      'Sem dispositivo, a ficha da norma (vigência, relações, sucessoras e transições), como em "ifpr://norma/br/cne-cp/res/2026/2". Com "#dispositivo", o texto literal dele, com o caput herdado e os incisos, como em "ifpr://norma/br/cne-cp/res/2026/2#art28-xviii".',
  },
  {
    tipo: "curso",
    uriTemplate: "ifpr://curso/{campus}/{curso}",
    titulo: "Curso do IFPR",
    descricao:
      'A ficha do curso: PPC, CNCT, ofertas, fatos do PPC × SUAP e normas que o PPC cita, como em "ifpr://curso/curitiba/tecnico-em-enfermagem".',
  },
  {
    tipo: "ppc",
    uriTemplate: "ifpr://ppc/{campus}/{curso}{/versao}{#secao}",
    titulo: "PPC ou seção de PPC",
    descricao:
      'Sem seção, o índice do PPC convertido, com os fatos extraídos e o link de cada seção. Com "#secao", o texto literal da seção, como em "ifpr://ppc/curitiba/tecnico-em-enfermagem/2023#estagio_praticas-1". A versão é o ano do documento; sem ela, o PPC vigente do curso.',
  },
  {
    tipo: "cnct",
    uriTemplate: "ifpr://cnct/{slug}",
    titulo: "Curso do CNCT",
    descricao:
      'O curso no Catálogo Nacional de Cursos Técnicos (eixo, carga horária mínima, perfil, campo de atuação, legislação) e os cursos do IFPR com a habilitação, como em "ifpr://cnct/tecnico-em-enfermagem".',
  },
  {
    tipo: "campus",
    uriTemplate: "ifpr://campus/{campus}",
    titulo: "Campus do IFPR",
    descricao: 'O campus e os cursos dele na base, como em "ifpr://campus/curitiba".',
  },
  {
    tipo: "ficha",
    uriTemplate: "ifpr://ficha/{ficha}",
    titulo: "Ficha da revisão de PPC",
    descricao:
      'Pergunta, rubrica, evidências e referências normativas de uma ficha da revisão de PPC, como em "ifpr://ficha/CT-CURR-12".',
  },
];

/** As normas centrais em `resources/list`, quando estão na base. */
const NORMAS_DE_ENTRADA = ["br/cne-cp/res/2026/2", "br/cne-cp/res/2021/1", "br/lei/1996/9394"] as const;

/* ================================================================== leitura */

/** O texto de um recurso: avisos, corpo, continuação de uma seção longa e o rodapé da base. */
function textoDoRecurso(resposta: Resposta<unknown>, corpo: string, continuacao?: (cursor: string) => string): string {
  const partes: string[] = [];
  if (resposta.avisos.length > 0) partes.push(resposta.avisos.map(linhaAviso).join("\n"));
  if (corpo.trim() !== "") partes.push(corpo.trim());
  const cursor = resposta.pagina?.cursor;
  if (cursor !== undefined && continuacao) partes.push(continuacao(cursor));
  partes.push(rodape(resposta.base));
  return partes.join("\n\n");
}

const DICAS: Record<TipoLink, string> = {
  norma: '"ifpr://norma/br/cne-cp/res/2026/2" ou "ifpr://norma/br/cne-cp/res/2026/2#art28-xviii"',
  curso: '"ifpr://curso/curitiba/tecnico-em-enfermagem"',
  ppc: '"ifpr://ppc/curitiba/tecnico-em-enfermagem/2023", "ifpr://ppc/curitiba/tecnico-em-enfermagem/2023#<seção>" ou, para o vigente, "ifpr://ppc/curitiba/tecnico-em-enfermagem"',
  cnct: '"ifpr://cnct/tecnico-em-enfermagem"',
  campus: '"ifpr://campus/curitiba"',
  ficha: '"ifpr://ficha/CT-CURR-12"',
};

/** Quantos segmentos o caminho de cada tipo tem; a norma tem quantos o ID canônico tiver. */
const SEGMENTOS: Partial<Record<TipoLink, readonly number[]>> = {
  curso: [2],
  ppc: [2, 3],
  cnct: [1],
  campus: [1],
  ficha: [1],
};

function linkInvalido(uri: string): EntradaInvalida {
  const tipo = /^ifpr:\/\/([a-z]+)\//.exec(uri)?.[1];
  const conhecido = TIPOS_LINK.find((t) => t === tipo);
  if (conhecido) {
    return new EntradaInvalida({
      mensagem: `link ifpr:// malformado: "${uri}"; esperava, por exemplo, ${DICAS[conhecido]}`,
    });
  }
  return new EntradaInvalida({
    mensagem: `link desconhecido: "${uri}". Os recursos deste servidor são links ifpr:// dos tipos ${TIPOS_LINK.join(", ")}, como ${DICAS.norma}; os modelos estão em resources/templates/list`,
  });
}

/** A entrada de uma leitura, a partir do link já conferido; o schema confere o resto do ID. */
function entrada<S extends Schema.Decoder<unknown>>(schema: S, valor: unknown, uri: string) {
  return Schema.decodeUnknownEffect(schema)(valor).pipe(
    Effect.catchTags({ SchemaError: () => Effect.fail(linkInvalido(uri)) }),
  );
}

/**
 * Lê um link `ifpr://` pelo serviço `Leitura` do ambiente: a resolução única do link, para o
 * `resources/read`.
 */
export const lerRecurso = Effect.fn("recursos.lerRecurso")(function* (uri: string) {
  const leitura = yield* Leitura.Leitura;
  const link = lerLink(uri);
  const segmentos = link ? SEGMENTOS[link.tipo] : undefined;
  if (!link || (segmentos !== undefined && !segmentos.includes(link.caminho.split("/").length))) {
    return yield* linkInvalido(uri);
  }
  const { caminho, fragmento } = link;
  const semFragmento = Effect.suspend(() =>
    fragmento === null
      ? Effect.void
      : Effect.fail(
          new EntradaInvalida({
            mensagem: `o link ifpr://${link.tipo} não aceita "#${fragmento}": use ${DICAS[link.tipo]}`,
          }),
        ),
  );
  switch (link.tipo) {
    case "norma": {
      if (fragmento === null) {
        const resposta = yield* leitura.fichaNorma(yield* entrada(fichaNorma.entrada, { id: caminho }, uri));
        return { tipo: "norma", resposta, texto: textoDoRecurso(resposta, fichaNorma.texto(resposta)) } as const;
      }
      const id = `${caminho}#${fragmento}`;
      const resposta = yield* leitura.lerDispositivos(
        yield* entrada(lerDispositivos.entrada, { ids: [id], filhos: true }, uri),
      );
      if (resposta.dados.dispositivos.length === 0) {
        return yield* new EntradaInvalida({
          mensagem: `dispositivo não encontrado na base: "${id}". Confira o ID com buscar_norma ou resolver_citacoes, ou leia a norma em ${linkNorma(caminho)}`,
        });
      }
      return {
        tipo: "dispositivo",
        resposta,
        texto: textoDoRecurso(resposta, lerDispositivos.texto(resposta)),
      } as const;
    }
    case "curso": {
      yield* semFragmento;
      const resposta = yield* leitura.fichaCurso(yield* entrada(fichaCurso.entrada, { curso: caminho }, uri));
      return { tipo: "curso", resposta, texto: textoDoRecurso(resposta, fichaCurso.texto(resposta)) } as const;
    }
    case "ppc": {
      if (fragmento === null) {
        const resposta = yield* leitura.lerPpc({ ppc: caminho });
        return { tipo: "ppc", resposta, texto: textoDoRecurso(resposta, Conteudos.textoPpc(resposta)) } as const;
      }
      const id = `${caminho}#${fragmento}`;
      const resposta = yield* leitura.lerSecao(yield* entrada(lerSecao.entrada, { id }, uri));
      const continuacao = (cursor: string) =>
        `Seção longa: acima, as linhas ${resposta.dados.secao.fonte.linha_inicio}-${resposta.dados.secao.fonte.linha_fim}. Para o resto, chame \`ler_secao\` com \`id: "${id}"\` e \`cursor: "${cursor}"\`.`;
      return {
        tipo: "secao",
        resposta,
        texto: textoDoRecurso(resposta, lerSecao.texto(resposta), continuacao),
      } as const;
    }
    case "cnct": {
      yield* semFragmento;
      const resposta = yield* leitura.lerCnct({ cnct: caminho });
      return { tipo: "cnct", resposta, texto: textoDoRecurso(resposta, Conteudos.textoCnct(resposta)) } as const;
    }
    case "campus": {
      yield* semFragmento;
      const resposta = yield* leitura.lerCampus({ campus: caminho });
      return {
        tipo: "campus",
        resposta,
        texto: textoDoRecurso(resposta, Conteudos.textoCampus(resposta)),
      } as const;
    }
    case "ficha": {
      yield* semFragmento;
      const resposta = yield* leitura.lerFicha({ ficha: caminho });
      return { tipo: "ficha", resposta, texto: textoDoRecurso(resposta, Conteudos.textoFicha(resposta)) } as const;
    }
  }
}) as (uri: string) => Effect.Effect<LinkLido, ErroDeLeitura, Leitura.Leitura>;

/** O resultado do `resources/read`: o texto Markdown, com a `base` e os avisos no `_meta`. */
function resultado(uri: string, lido: LinkLido): McpSchema.ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: MIME_RECURSO,
        text: lido.texto,
        _meta: { "ifpr/base": lido.resposta.base, "ifpr/avisos": lido.resposta.avisos },
      },
    ],
  };
}

/**
 * A leitura como o `McpServer` a pede: a entrada inválida vira `InvalidParams`, a falha da base,
 * `InternalError`. Com uma `SessaoAtual`, a leitura vai para as chamadas da sessão, com o resumo do
 * texto lido ou da mensagem de erro.
 */
const lerParaMcp = (leitura: Leitura.Leitura["Service"], uri: string) =>
  observarChamada(
    { ferramenta: uri, tipo: "recurso" },
    lerRecurso(uri).pipe(
      Effect.map((lido) => resultado(uri, lido)),
      Effect.catchTags({
        EntradaInvalida: (erro) => Effect.fail(new McpSchema.InvalidParams({ message: erro.message })),
        FalhaNaBase: (erro) => Effect.fail(new McpSchema.InternalError({ message: erro.message })),
      }),
      Effect.provideService(Leitura.Leitura, leitura),
    ),
    { falhou: () => false, resumir: resumoDaLeitura, resumirErro: (erro) => resumoDoTexto(erro.message) },
  );

/** Caminho do roteador de URI do `effect/ai` (`find-my-way`): `::` é o `:` literal, `*` o resto. */
const rotaDoTipo = (tipo: TipoLink) => `ifpr:://${tipo}/*`;

/** Esconde o modelo curinga do `resources/templates/list`, sem tirá-lo do `resources/read`. */
const soNaLeitura = McpServer.visibility((opcoes) => Effect.succeed(opcoes.method !== "resources/templates/list"));

/* ================================================================== registro */

const registrarModelos = Effect.gen(function* () {
  const servidor = yield* McpServer.McpServer;
  const leitura = yield* Leitura.Leitura;
  const servicos = yield* Effect.context<never>();
  for (const modelo of MODELOS) {
    yield* servidor.addResourceTemplate({
      template: new McpSchema.ResourceTemplate({
        uriTemplate: modelo.uriTemplate,
        name: modelo.tipo,
        title: modelo.titulo,
        description: modelo.descricao,
        mimeType: MIME_RECURSO,
      }),
      annotations: Context.empty(),
      services: servicos,
      routerPath: rotaDoTipo(modelo.tipo),
      completions: {},
      handle: (uri) => lerParaMcp(leitura, uri),
    });
  }

  // pontos de entrada do `resources/list`: as normas centrais que estão na base e os campi
  const entradas: Array<{
    readonly uri: string;
    readonly nome: string;
    readonly titulo: string;
    readonly descricao: string;
  }> = [];
  for (const id of NORMAS_DE_ENTRADA) {
    const ficha = yield* leitura.fichaNorma({ id }).pipe(Effect.option);
    if (ficha._tag === "Some") {
      const norma = ficha.value.dados.norma;
      entradas.push({
        uri: norma.link,
        nome: norma.id,
        titulo: norma.titulo,
        descricao: `Ficha da norma: vigência, relações e transições${norma.ementa ? `. ${norma.ementa}` : ""}`,
      });
    }
  }
  const sobre = yield* leitura.sobreABase({});
  for (const campus of sobre.dados.campi) {
    entradas.push({
      uri: linkCampus(campus.id),
      nome: `campus:${campus.id}`,
      titulo: `Campus ${campus.nome}`,
      descricao: "Os cursos do campus na base, com o link da ficha de cada um.",
    });
  }
  for (const e of entradas) {
    yield* servidor.addResource({
      resource: new McpSchema.Resource({
        uri: e.uri,
        name: e.nome,
        title: e.titulo,
        description: e.descricao,
        mimeType: MIME_RECURSO,
      }),
      annotations: Context.empty(),
      services: servicos,
      handle: lerParaMcp(leitura, e.uri).pipe(
        Effect.catchTags({
          InvalidParams: (erro) => Effect.fail(new McpSchema.InternalError({ message: erro.message })),
        }),
      ),
    });
  }
});

/** O modelo curinga, com a visibilidade `soNaLeitura` no contexto (o `effect/ai` a lê dos serviços). */
const registrarCuringa = Effect.gen(function* () {
  const servidor = yield* McpServer.McpServer;
  const leitura = yield* Leitura.Leitura;
  yield* servidor.addResourceTemplate({
    template: new McpSchema.ResourceTemplate({
      uriTemplate: "{+link}",
      name: "curinga",
      description: "Qualquer outro link: responde com o erro em português.",
    }),
    annotations: Context.empty(),
    services: yield* Effect.context<never>(),
    routerPath: "*",
    completions: {},
    handle: (uri) => lerParaMcp(leitura, uri),
  });
});

/** O registro dos recursos `ifpr://` no `McpServer` do ambiente, sobre o `Leitura` do ambiente. */
export const layerRecursos = Layer.mergeAll(
  Layer.effectDiscard(registrarModelos),
  Layer.effectDiscard(registrarCuringa).pipe(Layer.provide(soNaLeitura.layer)),
);
