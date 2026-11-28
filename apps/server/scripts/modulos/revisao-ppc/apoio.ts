// @effect-diagnostics nodeBuiltinImport:off -- apoio dos scripts de teste real: caminhos e pasta de estado na montagem do ponto de entrada
/**
 * Apoio dos scripts de teste real do módulo (`revisao-ia-real.ts`, `lista-viva-real.ts`): o PPC da base
 * em DOCX, a pasta de estado dos providers e os serviços do módulo como o servidor os compõe
 * (`modulo.ts`), com o motor real, o `kb.sqlite` do checkout e o aviso de uso já aceito.
 */
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { celula, montarDocx, par, run, tabelaDeTextos } from "@simplifica-if/docx/testes/sintetico";
import { layerLeitura } from "@simplifica-if/mcp/rpc";
import * as Motor from "@simplifica-if/motor";
import * as Drivers from "@simplifica-if/motor/drivers";
import * as ArquivosLiberados from "../../../src/ArquivosLiberados.ts";
import * as Atividades from "../../../src/Atividades.ts";
import * as Banco from "../../../src/persistencia/Banco.ts";
import * as Historico from "../../../src/persistencia/Historico.ts";
import * as Preferencias from "../../../src/persistencia/Preferencias.ts";
import * as ListaViva from "../../../src/modulos/revisao-ppc/ListaViva.ts";
import * as RevisaoPpc from "../../../src/modulos/revisao-ppc/modulo.ts";

export const RAIZ = NodePath.resolve(import.meta.dirname, "../../../../..");
export const PPC_PADRAO = NodePath.join(
  RAIZ,
  "base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem/2023.md",
);

/** Os argumentos da linha de comando: o valor (ou os `n` valores) depois de uma opção. */
export const leitorDeArgumentos = (args: ReadonlyArray<string>) => ({
  tem: (nome: string) => args.includes(nome),
  depois: (nome: string, n = 1): ReadonlyArray<string> | undefined => {
    const i = args.indexOf(nome);
    return i >= 0 ? args.slice(i + 1, i + 1 + n) : undefined;
  },
});

const TITULO_INJECAO = /^5\.1 ESTRUTURA CURRICULAR/;

/**
 * Markdown da base → DOCX simples: títulos com estilo, tabelas e parágrafos. Com `injecao`, o parágrafo
 * entra logo depois do título da seção 5.1 (a instrução escondida das PoCs).
 */
export function docxDoMarkdown(markdown: string, injecao?: string): Uint8Array {
  const corpo: string[] = [];
  let tabela: string[][] = [];
  const fechar = () => {
    if (tabela.length) corpo.push(tabelaDeTextos(tabela), par(""));
    tabela = [];
  };
  const limpar = (t: string) =>
    t
      .replace(/\*\*|__|`/g, "")
      .replace(/<br\s*\/?>/g, " ")
      .trim();
  for (const linha of markdown.replace(/^---\n[\s\S]*?\n---\n/, "").split("\n")) {
    if (linha.startsWith("|")) {
      if (/^\|[\s:|-]+\|?$/.test(linha)) continue;
      // Célula já montada: um texto que começa com "<" não pode virar XML cru.
      tabela.push(
        linha
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((t) => celula(par(run(limpar(t))))),
      );
      continue;
    }
    fechar();
    const titulo = /^(#{1,6})\s+(.*)$/.exec(linha);
    if (titulo) {
      const texto = limpar(titulo[2]!);
      corpo.push(par(run(texto), { estilo: `Heading${Math.min(Math.max(1, titulo[1]!.length - 1), 3)}` }));
      if (injecao !== undefined && TITULO_INJECAO.test(texto)) corpo.push(par(injecao));
      continue;
    }
    if (linha.trim()) corpo.push(par(run(limpar(linha))));
  }
  fechar();
  return montarDocx({ corpo: corpo.join("") });
}

/** A pasta de estado do harness do motor (`packages/motor/scripts/poc.ts`): as CLIs gerenciadas e o perfil do Antigravity. */
export const pastaEstado = (ambiente: NodeJS.ProcessEnv) =>
  ambiente["SIMPLIFICA_ESTADO"] ??
  (NodeOS.platform() === "darwin"
    ? NodePath.join(NodeOS.homedir(), "Library", "Application Support", "simplifica-if-poc")
    : NodePath.join(NodeOS.homedir(), ".simplifica-if-poc"));

export interface OpcoesNucleo {
  readonly ambiente: NodeJS.ProcessEnv;
  /** O `conversas.sqlite`; sem ele, o banco em memória. */
  readonly bancoConversas?: string;
  readonly revisaoIa?: RevisaoPpc.OpcoesRevisaoIa;
  readonly listaViva?: ListaViva.OpcoesListaViva;
}

/**
 * Os serviços do módulo (`RevisaoPpc.layer`) com o que o servidor lhes dá: as preferências com o aviso
 * de uso aceito (quem roda o script de medição já o aceitou), qualquer arquivo liberado, o motor com os
 * drivers reais e o `tmp/kb.sqlite` do checkout.
 */
export const layerNucleo = (opcoes: OpcoesNucleo) => {
  const banco = opcoes.bancoConversas === undefined ? Banco.layerMemoria : Banco.layerArquivo(opcoes.bancoConversas);
  const drivers = Drivers.layerNode({ ambiente: opcoes.ambiente, pastaEstado: pastaEstado(opcoes.ambiente) });
  return RevisaoPpc.layer(banco, opcoes.revisaoIa, opcoes.listaViva).pipe(
    Layer.provideMerge(Preferencias.layerPrimeiroUsoFeito.pipe(Layer.provide(banco))),
    Layer.provideMerge(Historico.layer.pipe(Layer.provide(banco))),
    Layer.provideMerge(ArquivosLiberados.layer({ exigirLiberacao: false })),
    Layer.provideMerge(Atividades.layer),
    Layer.provideMerge(Motor.layer.pipe(Layer.provide(drivers))),
    Layer.provideMerge(layerLeitura({ banco: NodePath.join(RAIZ, "tmp/kb.sqlite"), canal: "dev" })),
    Layer.provideMerge(NodeCrypto.layerSecureRandom),
  );
};

/** A pré-conferência com a lista viva gravada (`ListaViva.revisar`) até o fim: o id da lista. */
export const revisarAteALista = Effect.fn("apoio.revisarAteALista")(function* (arquivo: string) {
  const viva = yield* ListaViva.ListaViva;
  const eventos = yield* Stream.runCollect(viva.revisar({ arquivo }));
  for (const evento of eventos) if (evento.tipo === "pronto") return evento.lista;
  return yield* Effect.die("ListaViva.revisar terminou sem a lista");
});
