/**
 * `@simplifica-if/mcp/toolkit`: as ferramentas da base do IFPR para o fork montar num `McpServer` do
 * `effect/ai`, ao lado dos toolkits do T3, num endpoint próprio:
 *
 *   McpServer.layerHttp({
 *     name: NOME_SERVIDOR, version: VERSAO_PACOTE, instructions: INSTRUCOES, protocols: PROTOCOLOS,
 *     path: "/mcp/ifpr",
 *     registrations: Layer.effectDiscard(registrarFerramentas).pipe(Layer.provide(layerHandlers)),
 *   }).pipe(Layer.fresh, Layer.provide(layerLeitura({ banco, canal: "estavel" })))
 *
 * O `Layer.fresh` dá ao endpoint um registro de ferramentas próprio: sem ele, dois `layerHttp` no mesmo
 * grafo de layers compartilham o `McpServer` e listam as ferramentas um do outro (experimento do C2).
 *
 * - `FerramentasIfpr`: o Toolkit (um `Tool` por ferramenta, com a descrição e os schemas);
 * - `layerHandlers`: os handlers do Toolkit, sobre o serviço `Leitura`;
 * - `registrarFerramentas`: registra as ferramentas no `McpServer` com o texto Markdown no `content`
 *   e a entrada inválida como resultado de erro (ver `ferramentas/registrar.ts`);
 * - `layerRegistro`: as duas anteriores juntas, pronta para `registrations`;
 * - `layerLeitura`: o `Leitura` sobre o `kb.sqlite`, só leitura.
 */
export { FERRAMENTAS, FerramentasIfpr, layerHandlers } from "./ferramentas/toolkit.ts";
export { registrarFerramentas } from "./ferramentas/registrar.ts";
export { Leitura } from "./leitura/Leitura.ts";
export { INSTRUCOES, layerLeitura, layerRegistro, NOME_SERVIDOR, PROTOCOLOS, VERSAO_PACOTE } from "./servidor.ts";
