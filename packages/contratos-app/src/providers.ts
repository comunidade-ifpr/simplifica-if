/** Os providers (Claude, Codex, Antigravity): detecção, instalação da CLI gerenciada e login. */
import { FalhaProvider, OperacaoNaoSuportada } from "@simplifica-if/motor/erros";
import { EstadoInstalacao, EstadoLogin, EstadoProvider } from "@simplifica-if/motor/estados-provider";
import { Provider } from "@simplifica-if/motor/eventos";
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/rpc";

const EntradaProvider = Schema.Struct({ provider: Provider });

export class GrupoProviders extends RpcGroup.make(
  Rpc.make("providers.detectar", { payload: EntradaProvider, success: EstadoProvider }),
  /** Instala ou atualiza a CLI gerenciada (Codex, Antigravity); o stream termina numa fase final. */
  Rpc.make("providers.instalar", {
    payload: EntradaProvider,
    success: EstadoInstalacao,
    error: Schema.Union([FalhaProvider, OperacaoNaoSuportada]),
    stream: true,
  }),
  /** Login dentro do app (Antigravity); o stream termina numa fase final. */
  Rpc.make("providers.entrar", {
    payload: EntradaProvider,
    success: EstadoLogin,
    error: Schema.Union([FalhaProvider, OperacaoNaoSuportada]),
    stream: true,
  }),
) {}
