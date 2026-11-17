/**
 * A atualização do app (M1.10): quando o `electron-updater` fica desligado (a regra do T3, mais a
 * assinatura de código) e o ciclo procurar → baixar → pronta → instalar, com um atualizador falso.
 */
import { describe, expect, test } from "vite-plus/test";
import { type Atualizador, feedDoCanal, iniciarAtualizacaoApp, motivoDesligado } from "../src/atualizacaoApp.ts";

const base = {
  empacotado: true,
  plataforma: "darwin" as const,
  feed: "https://github.com/dono/repo/releases/download/canal-{canal}/",
  modo: "se-assinado" as const,
  assinado: true,
  desligadaPorAmbiente: false,
};

describe("atualização do app", () => {
  test("ligada só no app empacotado, com feed e assinado; cada motivo em português", () => {
    expect(motivoDesligado(base)).toBeNull();
    expect(motivoDesligado({ ...base, assinado: false })).toContain("assinatura de código da Apple");
    expect(motivoDesligado({ ...base, plataforma: "win32", assinado: false })).toContain("assinatura de código");
    expect(motivoDesligado({ ...base, feed: null })).toContain("ainda não foi configurado");
    expect(motivoDesligado({ ...base, empacotado: false })).toContain("app instalado");
    expect(motivoDesligado({ ...base, modo: "nunca" })).toContain("política");
    expect(motivoDesligado({ ...base, desligadaPorAmbiente: true })).toContain("SIMPLIFICA_SEM_ATUALIZACAO_APP");
    expect(motivoDesligado({ ...base, plataforma: "linux" })).toContain("macOS e no Windows");
  });

  test("o feed do canal é o release fixo do canal, com a barra no fim", () => {
    expect(feedDoCanal(base.feed, "beta")).toBe("https://github.com/dono/repo/releases/download/canal-beta/");
    expect(feedDoCanal("http://127.0.0.1:9/x/{canal}", "estavel")).toBe("http://127.0.0.1:9/x/estavel/");
  });

  test("desligada: não toca no electron-updater", async () => {
    let criado = false;
    const controle = iniciarAtualizacaoApp({
      versao: "0.1.0",
      motivo: "sem assinatura",
      feed: base.feed,
      canal: "beta",
      atualizador: () => {
        criado = true;
        throw new Error("não devia criar");
      },
      registrar: () => undefined,
      antesDeInstalar: async () => undefined,
    });
    expect(criado).toBe(false);
    expect((await controle.procurar()).desligada).toBe("sem assinatura");
  });

  test("ligada: feed generic do canal, download em segundo plano e instalação depois de encerrar o servidor", async () => {
    const ouvintes = new Map<string, (...argumentos: never[]) => void>();
    const chamadas: string[] = [];
    const falso: Atualizador = {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      setFeedURL: (opcoes) => void chamadas.push(`feed ${opcoes.provider} ${opcoes.url}`),
      checkForUpdates: async () => {
        chamadas.push("procurar");
        (ouvintes.get("update-available") as (info: { version: string }) => void)({ version: "0.2.0" });
        (ouvintes.get("update-downloaded") as (info: { version: string }) => void)({ version: "0.2.0" });
        return null;
      },
      quitAndInstall: () => void chamadas.push("instalar"),
      on: (evento, ouvinte) => ouvintes.set(evento, ouvinte),
    };
    const controle = iniciarAtualizacaoApp({
      versao: "0.1.0",
      motivo: null,
      feed: base.feed,
      canal: "beta",
      atualizador: () => falso,
      registrar: () => undefined,
      antesDeInstalar: async () => void chamadas.push("servidor encerrado"),
    });
    const estado = await controle.procurar();
    expect(falso.autoDownload).toBe(true);
    expect(chamadas[0]).toBe("feed generic https://github.com/dono/repo/releases/download/canal-beta/");
    expect(estado).toMatchObject({ situacao: "pronta", nova: "0.2.0", desligada: null });
    controle.instalar();
    await new Promise((pronto) => setImmediate(pronto));
    expect(chamadas.slice(-2)).toEqual(["servidor encerrado", "instalar"]);
    controle.parar();
  });
});

describe("proxy do sistema para o servidor", () => {
  test("PROXY e HTTPS viram variáveis; DIRECT e SOCKS não; o ambiente manda", async () => {
    const { proxyParaServidor } = await import("../src/atualizacaoApp.ts");
    expect(proxyParaServidor("PROXY proxy.ifpr.edu.br:3128; DIRECT", {})).toEqual({
      HTTPS_PROXY: "http://proxy.ifpr.edu.br:3128",
      HTTP_PROXY: "http://proxy.ifpr.edu.br:3128",
    });
    expect(proxyParaServidor("HTTPS seguro:443", {})).toMatchObject({ HTTPS_PROXY: "https://seguro:443" });
    expect(proxyParaServidor("DIRECT", {})).toEqual({});
    expect(proxyParaServidor("SOCKS5 s:1080", {})).toEqual({});
    expect(proxyParaServidor("PROXY p:8080", { https_proxy: "http://outra:1" })).toEqual({
      HTTP_PROXY: "http://p:8080",
    });
  });
});
