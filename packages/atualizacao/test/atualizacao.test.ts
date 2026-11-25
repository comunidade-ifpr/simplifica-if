// @effect-diagnostics nodeBuiltinImport:off -- teste: pastas do app, pacotes adulterados e bancos corrompidos em pastas temporárias
/**
 * Os cenários do M1.10 contra um servidor HTTP local, com manifesto e pacotes gerados pela fábrica
 * (`gerarCanal`) e assinados por um par descartável. Nada sai para a rede.
 */
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import { VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";
import { APP_MINIMO_PADRAO, conferirEsquema, type SkillDaFabrica } from "../src/fabrica.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ARQUIVO_TRAVA, caminhos, escreverAtomico, lerInfoBanco, trava } from "../src/local.ts";
import { compararVersoes } from "../src/manifesto.ts";
import { validarBancoEmWorker } from "../src/pesado.ts";
import { baixar, layerHttp, PRAZO_DOWNLOAD } from "../src/remoto.ts";
import { gerarChaves } from "../src/minisign.ts";
import { abrir, criarBanco, estadoNoDisco, limparTemporarios, pastaTemporaria } from "../src/testes/apoio.ts";
import { type Cenario, cenario } from "../src/testes/cenario.ts";

afterEach(limparTemporarios);

const semPendente = (c: Cenario) => {
  expect(NodeFS.existsSync(caminhos(c.pastaApp).pendente)).toBe(false);
  expect(NodeFS.existsSync(caminhos(c.pastaApp).baixando)).toBe(false);
  expect(estadoNoDisco(c.pastaApp).pendente).toBeUndefined();
};

describe("atualização da base", () => {
  it("normal: baixa o pacote inteiro, deixa pendente e troca na abertura seguinte", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13" });
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada", versao: "2026.11.13", via: "inteiro" });
      expect(estadoNoDisco(c.pastaApp).pendente?.versao).toBe("2026.11.13");
      const abertura = await abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });
      expect(abertura).toMatchObject({ origem: "baixada", banco: caminhos(c.pastaApp).atual });
      expect(abertura.info?.versao).toBe("2026.11.13");
      expect(estadoNoDisco(c.pastaApp).novidades).toMatchObject({ versao: "2026.11.13", vista: false });
      // Conferir de novo: em dia, nada se baixa além do manifesto.
      c.servidor.pedidos.length = 0;
      expect(await c.atualizar()).toEqual({ tipo: "em-dia" });
      expect(c.servidor.pedidos).toEqual(["beta/beta.json", "beta/beta.json.minisig"]);
    } finally {
      await c.fechar();
    }
  });

  it("patch: com a versão anterior em uso, baixa só o patch", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", anteriores: [c.empacotada] });
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada", via: "patch" });
      expect(c.servidor.pedidos).toContain("beta/base-2026.11.10-2026.11.13.patch.zst");
      expect(c.servidor.pedidos).not.toContain("beta/base-2026.11.13.sqlite.zst");
      expect((await abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada })).info?.versao).toBe("2026.11.13");
    } finally {
      await c.fechar();
    }
  });

  it("assinatura de outra chave: manifesto recusado, nada baixado", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", chave: gerarChaves() });
      await expect(c.atualizar()).rejects.toThrow("manifesto recusado");
      expect(c.servidor.pedidos).toEqual(["beta/beta.json", "beta/beta.json.minisig"]);
      semPendente(c);
    } finally {
      await c.fechar();
    }
  });

  it("manifesto alterado depois de assinado: recusado", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13" });
      const arquivo = NodePath.join(c.raiz, "servido", "beta", "beta.json");
      NodeFS.writeFileSync(arquivo, NodeFS.readFileSync(arquivo, "utf8").replace('"0.1.0"', '"0.0.1"'));
      await expect(c.atualizar()).rejects.toThrow("assinatura inválida");
    } finally {
      await c.fechar();
    }
  });

  it("sha256 errado no pacote: recusado, base em uso intacta", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13" });
      const pacote = NodePath.join(c.raiz, "servido", "beta", "base-2026.11.13.sqlite.zst");
      const bytes = NodeFS.readFileSync(pacote);
      bytes[100] = bytes[100]! ^ 0xff;
      NodeFS.writeFileSync(pacote, bytes);
      await expect(c.atualizar()).rejects.toThrow("sha256 diferente do manifesto");
      semPendente(c);
      expect((await abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada })).origem).toBe("empacotada");
    } finally {
      await c.fechar();
    }
  });

  it("app_minimo maior que o app: avisa e não baixa nada", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", appMinimo: "0.2.0" });
      expect(await c.atualizar()).toEqual({ tipo: "app-desatualizado", appMinimo: "0.2.0", versao: "2026.11.13" });
      expect(c.servidor.pedidos).toHaveLength(2);
      semPendente(c);
    } finally {
      await c.fechar();
    }
  });

  it("banco corrompido ou de outro esquema: recusado depois do hash, base em uso intacta", async () => {
    const c = await cenario();
    try {
      const banco = criarBanco(NodePath.join(c.fabrica, "corrompido.sqlite"), "2026.11.13");
      const bytes = NodeFS.readFileSync(banco);
      bytes.fill(0x5a, bytes.length - 3 * 4096, bytes.length - 4096);
      NodeFS.writeFileSync(banco, bytes);
      expect(lerInfoBanco(banco)?.versao).toBe("2026.11.13");
      c.publicar({ versao: "2026.11.13", banco });
      await expect(c.atualizar()).rejects.toThrow(/corrompida|não pôde ser lida|não abre/);
      semPendente(c);

      const outroEsquema = criarBanco(NodePath.join(c.fabrica, "esquema.sqlite"), "2026.11.14", { esquema: 999 });
      c.publicar({ versao: "2026.11.14", banco: outroEsquema });
      await expect(c.atualizar()).rejects.toThrow("outro esquema");
      semPendente(c);
    } finally {
      await c.fechar();
    }
  });

  it("rede cai no meio do download: falha limpa, e a próxima conferência baixa", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13" });
      c.servidor.cortar.add("beta/base-2026.11.13.sqlite.zst");
      await expect(c.atualizar()).rejects.toThrow(/caiu no meio|sem conexão|tamanho diferente/);
      semPendente(c);
      c.servidor.cortar.clear();
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada" });
    } finally {
      await c.fechar();
    }
  });

  it("manifesto antigo servido de novo (bem assinado) não faz voltar", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.09" });
      expect(await c.atualizar()).toEqual({ tipo: "em-dia" });
      semPendente(c);
    } finally {
      await c.fechar();
    }
  });

  it("skills: baixa as elegíveis e mais novas, e a pasta entra na abertura", async () => {
    const c = await cenario();
    try {
      const skill = (nome: string, extra: Partial<SkillDaFabrica> = {}): SkillDaFabrica => ({
        nome,
        versao: "1.1.0",
        appMinimo: "0.1.0",
        baseMinima: "2026.11.01",
        arquivos: [{ caminho: "SKILL.md", conteudo: Buffer.from(`---\nname: ${nome}\n---\n`) }],
        ...extra,
      });
      c.publicar({
        versao: "2026.11.13",
        skills: [
          skill("conferir-a"),
          skill("so-no-app-novo", { appMinimo: "9.0.0" }),
          skill("base-futura", { baseMinima: "2030.01.01" }),
        ],
      });
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada", skills: 1 });
      const abertura = await abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });
      expect(abertura.pastasSkills).toEqual([NodePath.join(c.pastaApp, "skills", "2026.11.13")]);
      expect(NodeFS.readdirSync(abertura.pastasSkills[0]!)).toEqual(["conferir-a"]);
    } finally {
      await c.fechar();
    }
  });
});

describe("revisão: skills, trava, proxy, temporários e Worker", () => {
  const skill = (nome: string, versao: string): SkillDaFabrica => ({
    nome,
    versao,
    appMinimo: "0.1.0",
    baseMinima: "2026.11.01",
    arquivos: [{ caminho: "SKILL.md", conteudo: Buffer.from(`---\nname: ${nome}\n---\n${versao}\n`) }],
  });

  it("skill baixada antes continua quando chega outra numa versão seguinte", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13", skills: [skill("conferir-a", "1.1.0")] });
      await c.atualizar();
      const primeira = await abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });
      expect(NodeFS.readdirSync(primeira.pastasSkills[0]!)).toEqual(["conferir-a"]);
      // No servidor, o catálogo já tem a A 1.1.0 baixada: só a B é nova.
      c.publicar({ versao: "2026.11.14", skills: [skill("conferir-a", "1.1.0"), skill("conferir-b", "1.0.0")] });
      expect(await c.atualizar("beta", { "conferir-a": "1.1.0" })).toMatchObject({ tipo: "baixada", skills: 1 });
      const segunda = await abrir({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });
      expect(segunda.pastasSkills).toEqual([NodePath.join(c.pastaApp, "skills", "2026.11.14")]);
      expect(NodeFS.readdirSync(segunda.pastasSkills[0]!).sort()).toEqual(["conferir-a", "conferir-b"]);
    } finally {
      await c.fechar();
    }
  });

  it.live("trava: outro processo vivo segura a pasta; trava de processo morto se retoma", () =>
    Effect.gen(function* () {
      const pasta = pastaTemporaria();
      const empacotada = criarBanco(NodePath.join(pasta, "emp", "kb.sqlite"), "2026.11.10");
      const comTrava = <A>(dentro: (tomada: boolean) => A) =>
        Effect.scoped(Effect.map(trava(pasta), dentro)).pipe(Effect.provide(NodeServices.layer));
      NodeFS.writeFileSync(NodePath.join(pasta, ARQUIVO_TRAVA), String(process.ppid));
      expect(yield* comTrava((tomada) => tomada)).toBe(false);
      const abertura = yield* Effect.promise(() => abrir({ pasta, bancoEmpacotado: empacotada }));
      expect(abertura.eventos).toContain(
        "outro processo usa esta pasta de atualização; a troca fica para a próxima abertura",
      );
      NodeFS.writeFileSync(NodePath.join(pasta, ARQUIVO_TRAVA), "999999999");
      const dentro = yield* comTrava((tomada) => ({
        tomada,
        dono: NodeFS.readFileSync(NodePath.join(pasta, ARQUIVO_TRAVA), "utf8"),
      }));
      expect(dentro).toEqual({ tomada: true, dono: String(process.pid) });
      // O escopo fechou: a trava foi solta.
      expect(NodeFS.existsSync(NodePath.join(pasta, ARQUIVO_TRAVA))).toBe(false);
    }),
  );

  it.live("proxy: o download passa pela proxy HTTP dada (como a do Electron ou a de HTTP_PROXY)", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(() => cenario());
      const vistos: string[] = [];
      const proxy = NodeHttp.createServer((pedido, resposta) => {
        vistos.push(pedido.url ?? "");
        const alvo = new URL(pedido.url ?? "");
        NodeHttp.get(alvo, { agent: new NodeHttp.Agent() }, (r) => {
          resposta.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(resposta);
        });
      });
      yield* Effect.promise(() => new Promise<void>((pronto) => proxy.listen(0, "127.0.0.1", pronto)));
      yield* Effect.ensuring(
        Effect.gen(function* () {
          c.publicar({ versao: "2026.11.13" });
          const url = `${c.servidor.url}beta/beta.json`;
          const porta = (proxy.address() as { port: number }).port;
          const baixarPor = (proxyConfig: Parameters<typeof layerHttp>[0]) =>
            baixar(url, 1024 * 1024).pipe(Effect.provide(layerHttp(proxyConfig)));
          const dados = yield* baixarPor({ httpProxy: `http://127.0.0.1:${porta}` });
          expect(Buffer.from(dados).toString("utf8")).toContain('"canal": "beta"');
          expect(vistos).toEqual([url]);
          // NO_PROXY tira o endereço da proxy.
          yield* baixarPor({ httpProxy: `http://127.0.0.1:${porta}`, noProxy: "127.0.0.1" });
          expect(vistos).toHaveLength(1);
        }),
        Effect.promise(async () => {
          proxy.closeAllConnections();
          proxy.close();
          await c.fechar();
        }),
      );
    }),
  );

  it.live("temporários: falha na escrita não deixa .tmp, e a abertura apaga sobras", () =>
    Effect.gen(function* () {
      const pasta = pastaTemporaria();
      const destino = NodePath.join(pasta, "base", "ocupado");
      NodeFS.mkdirSync(NodePath.join(destino, "dentro"), { recursive: true });
      const erro = yield* escreverAtomico(destino, Buffer.from("x")).pipe(
        Effect.provide(NodeServices.layer),
        Effect.flip,
      );
      expect(erro.message).toContain("não foi possível gravar a base baixada");
      expect(NodeFS.readdirSync(NodePath.join(pasta, "base")).filter((nome) => nome.endsWith(".tmp"))).toEqual([]);
      NodeFS.writeFileSync(NodePath.join(pasta, "atualizacao.json.123.tmp"), "{");
      NodeFS.writeFileSync(NodePath.join(pasta, "base", "baixando.sqlite"), "x");
      NodeFS.mkdirSync(NodePath.join(pasta, "skills", "2026.11.20.baixando"), { recursive: true });
      const empacotada = criarBanco(NodePath.join(pasta, "emp", "kb.sqlite"), "2026.11.10");
      const abertura = yield* Effect.promise(() => abrir({ pasta, bancoEmpacotado: empacotada }));
      expect(abertura.eventos.filter((e) => e.startsWith("sobra apagada")).length).toBe(3);
      expect(NodeFS.existsSync(NodePath.join(pasta, "atualizacao.json.123.tmp"))).toBe(false);
    }),
  );

  it.live("Worker: confere o banco fora do event loop, com as mesmas recusas", () =>
    Effect.gen(function* () {
      const pasta = pastaTemporaria();
      const bom = criarBanco(NodePath.join(pasta, "bom.sqlite"), "2026.11.20");
      expect(yield* validarBancoEmWorker(bom, { versao: "2026.11.20", dataReferencia: "2026-11-20" })).toMatchObject({
        versao: "2026.11.20",
      });
      const erroVersao = yield* validarBancoEmWorker(bom, { versao: "2026.11.21", dataReferencia: "2026-11-20" }).pipe(
        Effect.flip,
      );
      expect(erroVersao.message).toContain("diz ser a versão 2026.11.20");
      const ruim = criarBanco(NodePath.join(pasta, "ruim.sqlite"), "2026.11.20", { esquema: 999 });
      const erroEsquema = yield* validarBancoEmWorker(ruim, {
        versao: "2026.11.20",
        dataReferencia: "2026-11-20",
      }).pipe(Effect.flip);
      expect(erroEsquema.message).toContain("outro esquema");
    }),
  );

  it.effect("prazo: um servidor que não responde falha com FalhaDownload no prazo, pelo relógio do Effect", () =>
    Effect.gen(function* () {
      const mudo = Layer.succeed(HttpClient.HttpClient)(HttpClient.make(() => Effect.never));
      const download = yield* baixar("https://exemplo.invalid/beta/beta.json?token=segredo", 1024).pipe(
        Effect.provide(mudo),
        Effect.flip,
        Effect.forkChild,
      );
      yield* TestClock.adjust(PRAZO_DOWNLOAD);
      const erro = yield* Fiber.join(download);
      expect(erro).toMatchObject({ _tag: "FalhaDownload", categoria: "prazo", host: "exemplo.invalid" });
      // A URL (com a consulta) fica só em `cause`, nunca na mensagem.
      expect(erro.message).not.toContain("token");
      expect(erro.message).not.toContain("beta.json");
    }),
  );
});

describe("esquema da base na abertura e na fábrica", () => {
  // o esquema deste app e o anterior (a base baixada pelo app antigo)
  const ATUAL = VERSAO_ESQUEMA;
  const ANTIGO = VERSAO_ESQUEMA - 1;

  it("base baixada de outro esquema, mesmo mais nova, não vence a empacotada", async () => {
    const pasta = pastaTemporaria();
    const empacotada = criarBanco(NodePath.join(pasta, "Resources", "kb.sqlite"), "2026.11.10");
    criarBanco(caminhos(pasta).atual, "2026.11.20", { esquema: ANTIGO });
    const abertura = await abrir({ pasta, bancoEmpacotado: empacotada, versaoEsquema: ATUAL });
    // a empacotada é do esquema deste app (criarBanco grava o VERSAO_ESQUEMA do kb)
    expect(lerInfoBanco(empacotada)?.versaoEsquema).toBe(ATUAL);
    expect(abertura.origem).toBe("empacotada");
    expect(abertura.info?.versao).toBe("2026.11.10");
    expect(abertura.eventos).toContain(
      `base baixada 2026.11.20 é do esquema ${ANTIGO}, e este app lê o ${ATUAL}: abre a empacotada`,
    );
  });

  it('"Voltar" para uma anterior de outro esquema cai na empacotada', async () => {
    const pasta = pastaTemporaria();
    const empacotada = criarBanco(NodePath.join(pasta, "Resources", "kb.sqlite"), "2026.11.10");
    const c = caminhos(pasta);
    criarBanco(c.atual, "2026.11.20");
    criarBanco(c.anterior, "2026.11.15", { esquema: ANTIGO });
    NodeFS.writeFileSync(NodePath.join(pasta, "atualizacao.json"), JSON.stringify({ voltar: true }));
    const abertura = await abrir({ pasta, bancoEmpacotado: empacotada, versaoEsquema: ATUAL });
    expect(abertura.origem).toBe("empacotada");
    expect(abertura.eventos.some((e) => e.startsWith(`base baixada 2026.11.15 é do esquema ${ANTIGO}`))).toBe(true);
    // a mesma base, no esquema certo, vence a empacotada mais velha
    const certa = await abrir({ pasta, bancoEmpacotado: empacotada, versaoEsquema: ANTIGO });
    expect(certa.origem).toBe("baixada");
  });

  it("o app atual (apps/desktop) passa na regra da fábrica para a primeira base do esquema que ele lê", () => {
    const pacote = JSON.parse(
      NodeFS.readFileSync(NodePath.resolve(import.meta.dirname, "../../../apps/desktop/package.json"), "utf8"),
    ) as { version: string };
    expect(VERSAO_ESQUEMA).toBeGreaterThan(0);
    expect(compararVersoes(pacote.version, APP_MINIMO_PADRAO)).toBeGreaterThan(0);
    const pasta = pastaTemporaria();
    const anterior = criarBanco(NodePath.join(pasta, "antiga.sqlite"), "2026.11.10", { esquema: ANTIGO });
    const nova = lerInfoBanco(criarBanco(NodePath.join(pasta, "nova.sqlite"), "2026.11.20"))!;
    expect(nova.versaoEsquema).toBe(VERSAO_ESQUEMA);
    expect(() => conferirEsquema(nova, [anterior], APP_MINIMO_PADRAO)).toThrow("informe --app-minimo");
    expect(() => conferirEsquema(nova, [anterior], pacote.version)).not.toThrow();
  });

  it("fábrica: base que sobe o esquema só sai com --app-minimo", () => {
    const pasta = pastaTemporaria();
    const anterior = criarBanco(NodePath.join(pasta, "antiga.sqlite"), "2026.11.10", { esquema: 3 });
    const nova = lerInfoBanco(criarBanco(NodePath.join(pasta, "nova.sqlite"), "2026.11.20", { esquema: 4 }))!;
    expect(() => conferirEsquema(nova, [anterior], "0.1.0")).toThrow(
      "a base 2026.11.20 é do esquema 4, e a 2026.11.10 era do 3: informe --app-minimo",
    );
    expect(() => conferirEsquema(nova, [anterior], "0.2.0")).not.toThrow();
    const mesma = criarBanco(NodePath.join(pasta, "mesma.sqlite"), "2026.11.15", { esquema: 4 });
    expect(() => conferirEsquema(nova, [mesma], "0.1.0")).not.toThrow();
  });
});

describe("versão da base de desenvolvimento", () => {
  it("o banco compilado sem --versao é dev-<hash>, não a data de referência", () => {
    const caminho = criarBanco(NodePath.join(pastaTemporaria(), "dev.sqlite"), "2026.11.13");
    const db = new NodeSqlite.DatabaseSync(caminho);
    db.exec("DELETE FROM meta WHERE chave = 'versao'");
    db.prepare("INSERT INTO meta VALUES (?, ?)").run("fontes_sha256", "ab12cd34ef56");
    db.close();
    expect(lerInfoBanco(caminho)).toMatchObject({ versao: "dev-ab12cd34", dataReferencia: "2026-11-13" });
  });

  it("vem antes de toda versão publicada, para a atualização trocá-la", () => {
    expect(compararVersoes("2026.11.20", "dev-ab12cd34")).toBeGreaterThan(0);
    expect(compararVersoes("dev-ab12cd34", "2000.01.01")).toBeLessThan(0);
    expect(compararVersoes("dev-ab12cd34", "dev-ffffffff")).toBe(0);
    expect(compararVersoes("2026.11.20.2", "2026.11.20")).toBeGreaterThan(0);
  });
});
