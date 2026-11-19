/**
 * Os estados de um provider que o motor produz e a interface mostra: a detecção, a instalação
 * gerenciada e o login. Módulo folha, como `erros.ts` e `eventos.ts`: os contratos do app usam estes
 * schemas sem carregar a implementação do motor.
 */
import * as Schema from "effect/Schema";
import { Provider } from "./eventos.ts";
import { TipoFalhaEstado } from "./falhas.ts";

/** `gerenciada`: a cópia que o app instalou; `local`: a CLI que o usuário já tinha. */
const Origem = Schema.Literals(["gerenciada", "local"]);

/** Os níveis de esforço de raciocínio que os providers conhecem, do menor ao maior. */
export const NIVEIS_ESFORCO = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const NivelEsforco = Schema.Literals(NIVEIS_ESFORCO);
export type NivelEsforco = typeof NivelEsforco.Type;

/** Um modelo que a conta oferece, com o nome que o provider dá a ele. */
export const ModeloProvider = Schema.Struct({
  /** O que vai em `ConfigSessao.modelo`. */
  id: Schema.String,
  nome: Schema.String,
  /** O modelo que a conta usa quando a sessão não escolhe um. */
  padrao: Schema.optionalKey(Schema.Boolean),
  /**
   * O nível de `ConfigSessao.esforco` que a interface oferece como "Aprofundado" (`modelos.ts`); sem
   * ele, o modelo não deixa escolher o esforço.
   */
  esforcoAprofundado: Schema.optionalKey(NivelEsforco),
  /**
   * O nível próprio do modelo, quando o provider daria outro a uma sessão sem esforço (o `agy` herda o
   * do modelo padrão). Uso do driver: a interface não o manda, e "Normal" segue sendo sessão sem esforço.
   */
  esforcoNormal: Schema.optionalKey(NivelEsforco),
});
export type ModeloProvider = typeof ModeloProvider.Type;

/** O que o driver detecta: instalado, versão, login e modelos. Nunca traz e-mail nem credencial. */
export const DeteccaoProvider = Schema.Struct({
  provider: Provider,
  instalado: Schema.Boolean,
  origem: Schema.optionalKey(Origem),
  versao: Schema.optionalKey(Schema.String),
  autenticado: Schema.Boolean,
  /** Como está logado: `claude.ai`, `chatgpt`, `apiKey`, `oauth-personal`… */
  metodo: Schema.optionalKey(Schema.String),
  /** Plano da assinatura, quando o provider informa (`max`, `plus`, `pro`…). */
  plano: Schema.optionalKey(Schema.String),
  mensagem: Schema.optionalKey(Schema.String),
  /** Algo que impede o app de funcionar direito mesmo com login (ex.: MCP bloqueado pela organização). */
  aviso: Schema.optionalKey(Schema.String),
  /**
   * Os modelos que a pessoa pode escolher, como o provider os lista para a conta. Só com login.
   */
  modelos: Schema.optionalKey(Schema.Array(ModeloProvider)),
});
export type DeteccaoProvider = typeof DeteccaoProvider.Type;

/**
 * Resultado de `Motor.detectar`: a detecção do driver e o que o app oferece para o provider, derivado
 * de o driver ter `instalar` e `entrar`. A interface só mostra "Instalar" e "Entrar" quando há.
 */
export const EstadoProvider = Schema.Struct({
  ...DeteccaoProvider.fields,
  /** O app instala (ou atualiza) a CLI gerenciada do provider (`providers.instalar`). */
  podeInstalar: Schema.Boolean,
  /** O app faz o login do provider (`providers.entrar`). */
  podeEntrar: Schema.Boolean,
});
export type EstadoProvider = typeof EstadoProvider.Type;

/** Progresso da instalação gerenciada de uma CLI (a do T3: download, sha256, staging, versão ativa). */
export const EstadoInstalacao = Schema.Struct({
  provider: Provider,
  fase: Schema.Literals(["parada", "baixando", "extraindo", "verificando", "concluida", "falhou", "cancelada"]),
  baixados: Schema.Number,
  total: Schema.optionalKey(Schema.Number),
  /** A versão que a instalação oferece (a fixada pelo T3 ou uma mais nova). */
  versao: Schema.optionalKey(Schema.String),
  versaoInstalada: Schema.optionalKey(Schema.String),
  executavel: Schema.optionalKey(Schema.String),
  origem: Schema.optionalKey(Origem),
  mensagem: Schema.optionalKey(Schema.String),
  /** O tipo da falha que a `mensagem` descreve, quando o classificador do motor o reconhece. */
  tipoFalha: Schema.optionalKey(TipoFalhaEstado),
});
export type EstadoInstalacao = typeof EstadoInstalacao.Type;

/** Progresso do login dentro do app. Em `aguardando`, `url` é a página que o app abre no navegador. */
export const EstadoLogin = Schema.Struct({
  provider: Provider,
  fase: Schema.Literals(["parado", "iniciando", "aguardando", "verificando", "concluido", "falhou", "cancelado"]),
  url: Schema.optionalKey(Schema.String),
  /** A frase para a pessoa. */
  mensagem: Schema.optionalKey(Schema.String),
  /** O tipo da falha que a `mensagem` descreve, quando o classificador do motor o reconhece. */
  tipoFalha: Schema.optionalKey(TipoFalhaEstado),
  /** O texto técnico da CLI; a interface o mostra recolhido, em "Detalhes técnicos". */
  detalhe: Schema.optionalKey(Schema.String),
});
export type EstadoLogin = typeof EstadoLogin.Type;
