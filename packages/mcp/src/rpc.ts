/**
 * `@simplifica-if/mcp/rpc`: os handlers do grupo RPC de leitura (`effect/rpc`) que o leitor `ifpr://`,
 * o Explorar e o "Para você" do app usam. As definições (`GrupoLeitura`, `LinkLido`, `EntradaLink`)
 * ficam em `@simplifica-if/mcp/grupo-leitura`, sem o código do servidor, para a interface importá-las;
 * aqui fica a implementação, que chama o serviço `Leitura`, o mesmo das ferramentas MCP.
 *
 *   const cliente = yield* RpcClient.make(GrupoLeitura)
 *   const ficha = yield* cliente.fichaNorma({ id: "br/cne-cp/res/2021/1" })
 *
 * A layer dos handlers pede o `Leitura` do ambiente: `layerLeitura({ banco, canal })` monta o serviço
 * sobre o `kb.sqlite`.
 *
 * O leitor `ifpr://` da interface (M1.6) usa `lerLink`: qualquer link `ifpr://` que as ferramentas
 * devolvem, resolvido pela mesma função do `resources/read` do MCP (`lerRecurso`), com o tipo do
 * conteúdo, a `Resposta` estruturada e o texto Markdown do recurso:
 *
 *   const lido = yield* cliente.lerLink({ link: "ifpr://cnct/tecnico-em-enfermagem" })
 *   if (lido.tipo === "cnct") lido.resposta.dados.cnct.denominacao
 *
 * Os conteúdos que só existem como recurso (PPC sem seção, CNCT, campus e ficha) têm também um RPC
 * próprio (`lerPpc`, `lerCnct`, `lerCampus`, `lerFicha`), com a mesma resposta que `lerLink` traz
 * nesses tipos: é o mesmo método do `Leitura`.
 *
 * O cliente RPC passa o payload já decodificado (o `Type` do schema): os campos que a ferramenta MCP
 * completa com padrão (`limite`, `integral`, `filhos`…) são obrigatórios aqui, com o mesmo valor padrão
 * que a descrição da ferramenta indica.
 */
import * as Effect from "effect/Effect";
import { type ErroDeLeitura, ehFalhaNaBase, FalhaNaBase } from "./contratos.ts";
import { GrupoLeitura } from "./grupo-leitura.ts";
import * as Leitura from "./leitura/Leitura.ts";
import { lerRecurso } from "./recursos/recursos.ts";

export { layerLeitura } from "./servidor.ts";
export { Leitura } from "./leitura/Leitura.ts";

/**
 * A tradução de erro do transporte, como a do servidor do app (`paraInterface`): registra no log o
 * erro inteiro, com o `cause`, e manda à interface o `FalhaNaBase` sem ele.
 */
const traduzir =
  <P, A, R>(metodo: string, ler: (payload: P) => Effect.Effect<A, ErroDeLeitura, R>) =>
  (payload: P) =>
    ler(payload).pipe(
      Effect.tapError((erro) => Effect.logWarning(`RPC ${metodo} falhou`, erro)),
      Effect.mapError((erro) => (ehFalhaNaBase(erro) ? new FalhaNaBase({ operacao: erro.operacao }) : erro)),
    );

/** Os handlers do grupo: cada operação é um método de `Leitura`; `lerLink`, a leitura do `resources/read`. */
export const layerHandlersRpc = GrupoLeitura.toLayer(
  Effect.gen(function* () {
    const leitura = yield* Leitura.Leitura;
    return GrupoLeitura.of({
      fichaNorma: traduzir("fichaNorma", leitura.fichaNorma),
      lerDispositivos: traduzir("lerDispositivos", leitura.lerDispositivos),
      fichaCurso: traduzir("fichaCurso", leitura.fichaCurso),
      lerSecao: traduzir("lerSecao", leitura.lerSecao),
      sobreABase: traduzir("sobreABase", leitura.sobreABase),
      lerLink: traduzir("lerLink", ({ link }: { readonly link: string }) =>
        lerRecurso(link).pipe(Effect.provideService(Leitura.Leitura, leitura)),
      ),
      lerPpc: traduzir("lerPpc", leitura.lerPpc),
      lerCnct: traduzir("lerCnct", leitura.lerCnct),
      lerCampus: traduzir("lerCampus", leitura.lerCampus),
      lerFicha: traduzir("lerFicha", leitura.lerFicha),
      lerDocumento: traduzir("lerDocumento", leitura.lerDocumento),
      explorarIndice: traduzir("explorarIndice", leitura.explorarIndice),
      explorarBuscar: traduzir("explorarBuscar", leitura.explorarBuscar),
    });
  }),
);
