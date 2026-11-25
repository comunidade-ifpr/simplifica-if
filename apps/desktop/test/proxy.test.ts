import { describe, expect, test } from "vite-plus/test";
import { proxyParaServidor } from "../src/proxy.ts";

describe("proxy do sistema para o servidor", () => {
  test("PROXY e HTTPS viram variáveis; DIRECT e SOCKS não; o ambiente manda", () => {
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
