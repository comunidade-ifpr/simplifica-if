/**
 * A fronteira dos módulos do app (`docs/plans/tarefas.md`, "O módulo: a Revisar um PPC"): o código de um
 * módulo mora em pastas `modulos/<nome>/` (ou num arquivo `modulos/<nome>.ts`) dentro de cada camada, e só
 * os arquivos de composição, listados aqui, o citam de fora. Um módulo não importa de outro.
 *
 * Esta é a lista única dos arquivos de composição: a regra de lint `simplifica-if/fronteira-modulos` e o
 * teste que varre o repositório (`test/fronteira-repositorio.test.ts`) a leem. Ela tem duas partes:
 *
 * - `ARQUIVOS_QUE_IMPORTAM`: importam do módulo, e só do módulo da própria camada (um arquivo de
 *   `apps/server` importa de `apps/server/src/modulos/`, nunca de `packages/contratos-app/src/modulos/`), por
 *   caminho relativo;
 * - `ARQUIVOS_QUE_CITAM`: citam o módulo só pelo nome, sem import (a lista `MODULOS`, a rota em
 *   `ROTAS_MODULO`, a ponte e o Worker do desktop). São as linhas que se apagam junto com o módulo, e um
 *   import de `modulos/` neles é violação.
 *
 * Funções puras, sobre caminhos relativos à raiz do repositório, com `/`.
 */

/** Os arquivos de composição que importam do módulo da própria camada. */
export const ARQUIVOS_QUE_IMPORTAM: ReadonlyArray<string> = [
  // contratos: o `GrupoApp`
  "packages/contratos-app/src/contratos.ts",
  // servidor: as layers, as fontes de ocupação, os handlers e as tabelas
  "apps/server/src/servidor.ts",
  "apps/server/src/handlers.ts",
  "apps/server/src/persistencia/migracoes/0001_Inicial.ts",
  "apps/server/src/persistencia/migracoes/0002_ProblemasDasTentativas.ts",
  "apps/server/src/persistencia/migracoes/0003_ArquivoAcompanhado.ts",
  "apps/server/src/persistencia/migracoes/0004_ConversaAoLado.ts",
  "apps/server/src/persistencia/migracoes/0005_AtividadesEContinuacao.ts",
  // interface: a casca da rota, o estado de longa duração, o leitor e o recente do Início
  "apps/web/src/routes/revisao-ppc.tsx",
  "apps/web/src/inicializar.ts",
  "apps/web/src/contexto.tsx",
  "apps/web/src/leitor/Leitor.tsx",
  "apps/web/src/routes/index.tsx",
  // desktop: o IPC e o preload
  "apps/desktop/src/ipc.ts",
  "apps/desktop/src/preload.ts",
];

/** Os arquivos de composição que citam um módulo só pelo nome: não importam de `modulos/`. */
export const ARQUIVOS_QUE_CITAM: ReadonlyArray<string> = [
  // a ponte do desktop: o sufixo, os métodos e os canais (o pacote fica sem import, para o bundle do desktop)
  "packages/contratos-app/src/ponte.ts",
  // os nomes dos módulos que o app traz
  "packages/mcp/src/modulos.ts",
  // a rota da tarefa de módulo
  "apps/web/src/tarefas/abrir.ts",
  // o Worker do build
  "apps/desktop/scripts/construir.ts",
];

/** Todos os arquivos de composição: os únicos fora de `modulos/` que podem citar um módulo. */
export const ARQUIVOS_DE_COMPOSICAO: ReadonlyArray<string> = [...ARQUIVOS_QUE_IMPORTAM, ...ARQUIVOS_QUE_CITAM];

/**
 * O módulo a que um caminho (arquivo ou especificador de import) pertence, ou `undefined` (núcleo). A
 * pasta `modulos/<nome>/`, o arquivo `modulos/<nome>.ts` e o caminho que termina em `modulos/<nome>` são
 * do módulo `<nome>`; `modulos.ts` (a lista dos módulos do catálogo) não é módulo.
 */
export function moduloDoCaminho(caminho: string): string | undefined {
  const partes = caminho.split("/");
  const indice = partes.indexOf("modulos");
  if (indice === -1) return undefined;
  const nome = partes[indice + 1]?.split(".")[0];
  return nome === undefined || nome === "" ? undefined : nome;
}

/** A camada de um caminho do repositório: `apps/<app>`, `packages/<pacote>` ou a primeira pasta. */
export function camadaDe(caminho: string): string {
  const [primeira = "", segunda = ""] = caminho.split("/");
  return primeira === "apps" || primeira === "packages" ? `${primeira}/${segunda}` : primeira;
}

/** Junta e normaliza um caminho relativo com `/` (`a/b/../c` → `a/c`), sem depender do `node:path`. */
function normalizar(caminho: string): string {
  const partes: Array<string> = [];
  for (const parte of caminho.split("/")) {
    if (parte === "" || parte === ".") continue;
    if (parte === ".." && partes.length > 0 && partes.at(-1) !== "..") partes.pop();
    else partes.push(parte);
  }
  return partes.join("/");
}

/**
 * O que um import cita de `modulos/`:
 *
 * - `{ modulo: "<nome>" }`: um módulo, com a camada do caminho resolvido quando o import é relativo (o
 *   especificador de pacote, como `@simplifica-if/contratos-app/modulos/revisao-ppc`, não tem camada aqui);
 * - `{ modulo: null }`: a pasta de todos os módulos (`./modulos`, `../modulos/`), só em import relativo (no
 *   pacote, `@simplifica-if/mcp/modulos` é um arquivo: a lista dos módulos);
 * - `undefined`: nada de `modulos/`.
 */
export function alvoDoImport(
  arquivo: string,
  especificador: string,
): { readonly modulo: string | null; readonly camada: string | undefined } | undefined {
  if (!especificador.startsWith(".")) {
    const modulo = moduloDoCaminho(especificador);
    return modulo === undefined ? undefined : { modulo, camada: undefined };
  }
  const pasta = arquivo.includes("/") ? arquivo.slice(0, arquivo.lastIndexOf("/")) : "";
  const resolvido = normalizar(`${pasta}/${especificador}`);
  const modulo = moduloDoCaminho(resolvido);
  if (modulo !== undefined) return { modulo, camada: camadaDe(resolvido) };
  return resolvido.split("/").at(-1) === "modulos" ? { modulo: null, camada: camadaDe(resolvido) } : undefined;
}

/** O módulo que um import cita (`null`: a pasta de todos), ou `undefined` (núcleo). */
export const moduloDoImport = (arquivo: string, especificador: string): string | null | undefined =>
  alvoDoImport(arquivo, especificador)?.modulo;

const LISTA = "ferramentas/oxlint-plugin/modulos.ts";

/** A regra violada pelo import `especificador` em `arquivo`, ou `undefined` se o import é permitido. */
export function violacaoDeFronteira(arquivo: string, especificador: string): string | undefined {
  const alvo = alvoDoImport(arquivo, especificador);
  if (alvo === undefined) return undefined;
  if (alvo.modulo === null)
    return `importa a pasta de todos os módulos (${especificador}): importe do arquivo do módulo, num arquivo de composição`;
  const dono = moduloDoCaminho(arquivo);
  if (dono === alvo.modulo) return undefined;
  if (dono !== undefined)
    return `o módulo "${dono}" não importa do módulo "${alvo.modulo}" (${especificador}): o que os dois usam vai para o núcleo`;
  if (ARQUIVOS_QUE_CITAM.includes(arquivo))
    return `${arquivo} cita o módulo "${alvo.modulo}" só pelo nome e não importa dele (${especificador}); se precisa importar, passe-o para ARQUIVOS_QUE_IMPORTAM em ${LISTA}`;
  if (!ARQUIVOS_QUE_IMPORTAM.includes(arquivo))
    return `o núcleo não importa do módulo "${alvo.modulo}" (${especificador}): só os arquivos de composição de ${LISTA} citam um módulo`;
  const camada = camadaDe(arquivo);
  if (alvo.camada !== camada)
    return `o arquivo de composição ${arquivo} só importa do módulo "${alvo.modulo}" da própria camada (${camada}/…/modulos/), por caminho relativo: ${especificador}`;
  return undefined;
}
