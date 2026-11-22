/** O vigia do desenvolvimento: que arquivos reiniciam o servidor. */
// @effect-diagnostics nodeBuiltinImport:off -- teste do processo principal (sem Effect): EventEmitter e caminhos
import * as NodeEvents from "node:events";
import * as NodePath from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { ehCodigoDoServidor, type VigiaPasta, vigiarCodigoDoServidor } from "../src/vigiaDev.ts";

describe("ehCodigoDoServidor", () => {
  test("código TypeScript do servidor e dos pacotes", () => {
    expect(ehCodigoDoServidor("handlers.ts")).toBe(true);
    expect(ehCodigoDoServidor("contratos-app/src/preferencias.ts")).toBe(true);
    expect(ehCodigoDoServidor("contratos-app\\src\\preferencias.ts")).toBe(true);
  });

  test("testes, dependências, saídas de build e outros arquivos não", () => {
    expect(ehCodigoDoServidor("kb/src/normas/x.test.ts")).toBe(false);
    expect(ehCodigoDoServidor("ppc/test/fixtures/a.ts")).toBe(false);
    expect(ehCodigoDoServidor("mcp/node_modules/x/index.ts")).toBe(false);
    expect(ehCodigoDoServidor("docx/dist/index.ts")).toBe(false);
    expect(ehCodigoDoServidor("kb/dados/sinonimos.yaml")).toBe(false);
    expect(ehCodigoDoServidor("mcp/README.md")).toBe(false);
  });
});

/** Um `fs.watch` falso: um emissor com `close`. */
function vigiaFalso() {
  const emissor = new NodeEvents.EventEmitter();
  let fechado = false;
  const vigia: VigiaPasta = {
    close: () => {
      fechado = true;
    },
    on: (evento, ouvinte) => emissor.on(evento, ouvinte),
  };
  return { emissor, fechado: () => fechado, vigia };
}

describe("vigiarCodigoDoServidor", () => {
  test("uma pasta que não existe não lança: registra e não vigia", () => {
    const registros: Array<string> = [];
    const raiz = NodePath.join("/nao-existe", "simplifica-if-vigia");
    let parar: (() => void) | undefined;
    expect(() => {
      parar = vigiarCodigoDoServidor({
        raizRepositorio: raiz,
        aoMudar: () => undefined,
        registrar: (m) => registros.push(m),
      });
    }).not.toThrow();
    expect(registros).toHaveLength(1);
    expect(registros[0]).toContain("não foi possível vigiar");
    expect(() => parar?.()).not.toThrow();
  });

  test("o erro de um vigia vai ao registro e fecha todos; parar depois não falha", () => {
    const registros: Array<string> = [];
    const falsos = [vigiaFalso(), vigiaFalso()];
    let proximo = 0;
    const parar = vigiarCodigoDoServidor({
      raizRepositorio: "/repo",
      aoMudar: () => undefined,
      registrar: (m) => registros.push(m),
      observar: () => falsos[proximo++]!.vigia,
    });
    expect(proximo).toBe(2);
    falsos[1]!.emissor.emit("error", new Error("EMFILE"));
    expect(registros).toHaveLength(1);
    expect(registros[0]).toContain("EMFILE");
    expect(falsos.every((falso) => falso.fechado())).toBe(true);
    falsos[0]!.emissor.emit("error", new Error("de novo"));
    expect(registros).toHaveLength(1);
    expect(() => parar()).not.toThrow();
  });
});
