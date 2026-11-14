/**
 * `@simplifica-if/mcp/rpc`: o grupo RPC de leitura (`effect/rpc`) que o leitor `ifpr://`, o Explorar
 * e o "Para você" do app usam. Cada operação tem a entrada e a resposta da ferramenta MCP de mesmo
 * nome (um contrato só para as duas), e os handlers chamam o mesmo serviço `Leitura`.
 *
 *   const cliente = yield* RpcClient.make(GrupoLeitura)
 *   const ficha = yield* cliente.fichaNorma({ id: "br/cne-cp/res/2021/1" })
 *
 * A layer dos handlers pede o `Leitura` do ambiente: `layerLeitura({ banco, canal })` monta o serviço
 * sobre o `kb.sqlite`.
 */
import * as Effect from "effect/Effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { ErroDeLeitura } from "./contratos.ts";
import { buscarNorma } from "./ferramentas/buscar-norma.ts";
import { buscarSecoes } from "./ferramentas/buscar-secoes.ts";
import { fichaCurso } from "./ferramentas/ficha-curso.ts";
import { fichaNorma } from "./ferramentas/ficha-norma.ts";
import { lerDispositivos } from "./ferramentas/ler-dispositivos.ts";
import { lerSecao } from "./ferramentas/ler-secao.ts";
import { listarCursos } from "./ferramentas/listar-cursos.ts";
import { sobreABase } from "./ferramentas/sobre-a-base.ts";
import * as Leitura from "./leitura/Leitura.ts";

export { layerLeitura } from "./servidor.ts";
export { Leitura } from "./leitura/Leitura.ts";

export class GrupoLeitura extends RpcGroup.make(
  Rpc.make("fichaNorma", { payload: fichaNorma.entrada, success: fichaNorma.saida, error: ErroDeLeitura }),
  Rpc.make("lerDispositivos", {
    payload: lerDispositivos.entrada,
    success: lerDispositivos.saida,
    error: ErroDeLeitura,
  }),
  Rpc.make("buscarNorma", { payload: buscarNorma.entrada, success: buscarNorma.saida, error: ErroDeLeitura }),
  Rpc.make("fichaCurso", { payload: fichaCurso.entrada, success: fichaCurso.saida, error: ErroDeLeitura }),
  Rpc.make("lerSecao", { payload: lerSecao.entrada, success: lerSecao.saida, error: ErroDeLeitura }),
  Rpc.make("buscarSecoes", { payload: buscarSecoes.entrada, success: buscarSecoes.saida, error: ErroDeLeitura }),
  Rpc.make("listarCursos", { payload: listarCursos.entrada, success: listarCursos.saida, error: ErroDeLeitura }),
  Rpc.make("sobreABase", { payload: sobreABase.entrada, success: sobreABase.saida, error: ErroDeLeitura }),
) {}

/** Os handlers do grupo: cada operação é um método de `Leitura`. */
export const layerHandlersRpc = GrupoLeitura.toLayer(
  Effect.gen(function* () {
    const leitura = yield* Leitura.Leitura;
    return GrupoLeitura.of({
      fichaNorma: leitura.fichaNorma,
      lerDispositivos: leitura.lerDispositivos,
      buscarNorma: leitura.buscarNorma,
      fichaCurso: leitura.fichaCurso,
      lerSecao: leitura.lerSecao,
      buscarSecoes: leitura.buscarSecoes,
      listarCursos: leitura.listarCursos,
      sobreABase: leitura.sobreABase,
    });
  }),
);
