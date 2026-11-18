// @effect-diagnostics nodeBuiltinImport:off -- apoio de teste: pastas temporárias e um canal gerado pela fábrica
/**
 * Um cenário de atualização para os testes (deste pacote e do servidor): a base empacotada, a pasta do
 * app, um par minisign descartável (gerado a cada execução, nunca gravado), um servidor HTTP local e
 * `publicar`, que gera um canal pela fábrica.
 */
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { gerarCanal, type SkillDaFabrica } from "../fabrica.ts";
import { prepararAbertura } from "../local.ts";
import type { Canal } from "../manifesto.ts";
import { type ChaveSecreta, gerarChaves } from "../minisign.ts";
import { baixarAtualizacao, conferirManifesto, layerHttp, type Resultado, urlManifesto } from "../remoto.ts";
import { criarBanco, pastaTemporaria, servirPasta, type ServidorTeste } from "./apoio.ts";

export const VERSAO_APP = "0.1.0";

/** O download de verdade (contra o servidor local) e o disco. */
export const LAYER_TESTE = Layer.mergeAll(layerHttp(), NodeServices.layer);

export interface Cenario {
  readonly raiz: string;
  readonly pastaApp: string;
  readonly empacotada: string;
  readonly fabrica: string;
  readonly chave: ChaveSecreta;
  readonly servidor: ServidorTeste;
  readonly feed: string;
  publicar(opcoes: {
    readonly versao: string;
    readonly canal?: Canal;
    readonly anteriores?: ReadonlyArray<string>;
    readonly appMinimo?: string;
    readonly skills?: ReadonlyArray<SkillDaFabrica>;
    readonly chave?: ChaveSecreta;
    readonly banco?: string;
    readonly pastaCanal?: Canal;
  }): { readonly banco: string };
  /** Confere o manifesto e baixa, como o serviço faz. */
  atualizar(canal?: Canal, versoesSkills?: Readonly<Record<string, string>>): Promise<Resultado>;
  fechar(): Promise<void>;
}

export async function cenario(): Promise<Cenario> {
  const raiz = pastaTemporaria();
  const pastaApp = NodePath.join(raiz, "app");
  const fabrica = NodePath.join(raiz, "fabrica");
  const servido = NodePath.join(raiz, "servido");
  const empacotada = criarBanco(NodePath.join(raiz, "Resources", "base", "kb.sqlite"), "2026.11.10");
  const chave = gerarChaves();
  const servidor = await servirPasta(servido);
  const feed = `${servidor.url}{canal}/`;
  return {
    raiz,
    pastaApp,
    empacotada,
    fabrica,
    chave,
    servidor,
    feed,
    publicar: (opcoes) => {
      const banco =
        opcoes.banco ??
        criarBanco(NodePath.join(fabrica, `kb-${opcoes.versao}.sqlite`), opcoes.versao, {
          extra: `novidade da versão ${opcoes.versao}`,
        });
      gerarCanal({
        saida: NodePath.join(servido, opcoes.pastaCanal ?? opcoes.canal ?? "beta"),
        canal: opcoes.canal ?? "beta",
        commit: "abc1234",
        banco,
        anteriores: opcoes.anteriores ?? [],
        skills: opcoes.skills ?? [],
        appMinimo: opcoes.appMinimo ?? "0.1.0",
        novidades: [{ tipo: "norma-nova", titulo: `Norma da versão ${opcoes.versao}` }],
        chave: opcoes.chave ?? chave,
        nivel: 3,
      });
      return { banco };
    },
    atualizar: (canal = "beta", versoesSkills = {}) => {
      const url = urlManifesto(feed, canal);
      return Effect.gen(function* () {
        const abertura = yield* prepararAbertura({ pasta: pastaApp, bancoEmpacotado: empacotada });
        const manifesto = yield* conferirManifesto({ urlManifesto: url, canal, chave, prazo: "5 seconds" });
        return yield* baixarAtualizacao(manifesto, url, {
          pasta: pastaApp,
          versaoApp: VERSAO_APP,
          abertura,
          versoesSkills,
          prazo: "5 seconds",
        });
      }).pipe(Effect.provide(LAYER_TESTE), Effect.runPromise);
    },
    fechar: () => servidor.fechar(),
  };
}
