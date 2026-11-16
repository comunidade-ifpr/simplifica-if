// @effect-diagnostics nodeBuiltinImport:off -- teste: pastas do app, pacotes adulterados e bancos corrompidos em pastas temporárias
/**
 * Os cenários do M1.10 contra um servidor HTTP local, com manifesto e pacotes gerados pela fábrica
 * (`gerarCanal`) e assinados por um par descartável. Nada sai para a rede.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Atualizador from "../src/Atualizador.ts";
import { gerarCanal, type SkillDaFabrica } from "../src/fabrica.ts";
import { caminhos, lerEstado, lerInfoBanco, prepararAbertura } from "../src/local.ts";
import type { Canal } from "../src/manifesto.ts";
import { type ChaveSecreta, gerarChaves } from "../src/minisign.ts";
import { baixarAtualizacao, baixarComFetch, conferirManifesto, urlManifesto } from "../src/remoto.ts";
import { criarBanco, limparTemporarios, pastaTemporaria, servirPasta, type ServidorTeste } from "./apoio.ts";

afterEach(limparTemporarios);

const VERSAO_APP = "0.1.0";

interface Cenario {
  readonly raiz: string;
  readonly pastaApp: string;
  readonly empacotada: string;
  readonly fabrica: string;
  readonly chave: ChaveSecreta;
  readonly servidor: ServidorTeste;
  readonly feed: string;
  publicar(opcoes: {
    readonly versao: string;
    readonly canal?: Canal;
    readonly anteriores?: ReadonlyArray<string>;
    readonly appMinimo?: string;
    readonly skills?: ReadonlyArray<SkillDaFabrica>;
    readonly chave?: ChaveSecreta;
    readonly banco?: string;
    readonly pastaCanal?: Canal;
  }): { readonly banco: string };
  /** Confere o manifesto e baixa, como o serviço faz. */
  atualizar(canal?: Canal): Promise<Awaited<ReturnType<typeof baixarAtualizacao>>>;
  fechar(): Promise<void>;
}

async function cenario(): Promise<Cenario> {
  const raiz = pastaTemporaria();
  const pastaApp = NodePath.join(raiz, "app");
  const fabrica = NodePath.join(raiz, "fabrica");
  const servido = NodePath.join(raiz, "servido");
  const empacotada = criarBanco(NodePath.join(raiz, "Resources", "base", "kb.sqlite"), "2026.11.10");
  const chave = gerarChaves();
  const servidor = await servirPasta(servido);
  const feed = `${servidor.url}{canal}/`;
  const baixar = baixarComFetch(5000);
  return {
    raiz,
    pastaApp,
    empacotada,
    fabrica,
    chave,
    servidor,
    feed,
    publicar: (opcoes) => {
      const banco =
        opcoes.banco ??
        criarBanco(NodePath.join(fabrica, `kb-${opcoes.versao}.sqlite`), opcoes.versao, {
          extra: `novidade da versão ${opcoes.versao}`,
        });
      gerarCanal({
        saida: NodePath.join(servido, opcoes.pastaCanal ?? opcoes.canal ?? "beta"),
        canal: opcoes.canal ?? "beta",
        commit: "abc1234",
        banco,
        anteriores: opcoes.anteriores ?? [],
        skills: opcoes.skills ?? [],
        appMinimo: opcoes.appMinimo ?? "0.1.0",
        novidades: [{ tipo: "norma-nova", titulo: `Norma da versão ${opcoes.versao}` }],
        chave: opcoes.chave ?? chave,
        nivel: 3,
      });
      return { banco };
    },
    atualizar: async (canal = "beta") => {
      const abertura = prepararAbertura({ pasta: pastaApp, bancoEmpacotado: empacotada });
      const url = urlManifesto(feed, canal);
      const manifesto = await conferirManifesto({ urlManifesto: url, canal, chave, baixar });
      return baixarAtualizacao(manifesto, url, {
        pasta: pastaApp,
        versaoApp: VERSAO_APP,
        baseEmUso: { caminho: abertura.banco, info: abertura.info },
        versoesSkills: {},
        baixar,
      });
    },
    fechar: () => servidor.fechar(),
  };
}

const semPendente = (c: Cenario) => {
  expect(NodeFS.existsSync(caminhos(c.pastaApp).pendente)).toBe(false);
  expect(NodeFS.existsSync(caminhos(c.pastaApp).baixando)).toBe(false);
  expect(lerEstado(c.pastaApp).pendente).toBeUndefined();
};

describe("atualização da base", () => {
  it("normal: baixa o pacote inteiro, deixa pendente e troca na abertura seguinte", async () => {
    const c = await cenario();
    try {
      c.publicar({ versao: "2026.11.13" });
      expect(await c.atualizar()).toMatchObject({ tipo: "baixada", versao: "2026.11.13", via: "inteiro" });
      expect(lerEstado(c.pastaApp).pendente?.versao).toBe("2026.11.13");
      const abertura = prepararAbertura({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });
      expect(abertura).toMatchObject({ origem: "baixada", banco: caminhos(c.pastaApp).atual });
      expect(abertura.info?.versao).toBe("2026.11.13");
      expect(lerEstado(c.pastaApp).novidades).toMatchObject({ versao: "2026.11.13", vista: false });
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
      expect(prepararAbertura({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada }).info?.versao).toBe("2026.11.13");
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
      expect(prepararAbertura({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada }).origem).toBe("empacotada");
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
      const abertura = prepararAbertura({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });
      expect(abertura.pastasSkills).toEqual([NodePath.join(c.pastaApp, "skills", "2026.11.13")]);
      expect(NodeFS.readdirSync(abertura.pastasSkills[0]!)).toEqual(["conferir-a"]);
    } finally {
      await c.fechar();
    }
  });
});

describe("Atualizador (serviço)", () => {
  const servico = (c: Cenario, ocupado: boolean) =>
    Atualizador.make({
      desligada: null,
      feed: c.feed,
      chave: c.chave,
      canalPadrao: "beta",
      pasta: c.pastaApp,
      bancoEmpacotado: c.empacotada,
      versaoApp: VERSAO_APP,
      abertura: prepararAbertura({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada }),
      versoesSkills: {},
      ocupado: Effect.succeed(ocupado),
      baixar: baixarComFetch(5000),
      automatico: false,
    });

  it.effect("troca durante análise: adiada, e entra na próxima abertura", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(cenario);
      c.publicar({ versao: "2026.11.13" });
      const atualizador = yield* servico(c, true);
      const estado = yield* atualizador.procurar;
      expect(estado).toMatchObject({ situacao: "pronta", pendente: "2026.11.13", erro: null });
      expect(yield* atualizador.aplicar).toMatchObject({ resultado: "adiada" });
      expect(prepararAbertura({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada }).info?.versao).toBe("2026.11.13");
      yield* Effect.promise(() => c.fechar());
    }).pipe(Effect.scoped),
  );

  it.effect("sem análise rodando: aplicar pede reinício; o aviso de novidades some depois de visto", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(cenario);
      c.publicar({ versao: "2026.11.13" });
      const antes = yield* servico(c, false);
      yield* antes.procurar;
      expect(yield* antes.aplicar).toMatchObject({ resultado: "reiniciar" });
      const depois = yield* servico(c, false);
      const estado = yield* depois.estado;
      expect(estado.base).toMatchObject({ versao: "2026.11.13", origem: "baixada" });
      expect(estado.anterior).toBe("2026.11.10");
      expect(estado.novidades?.itens[0]?.titulo).toBe("Norma da versão 2026.11.13");
      expect((yield* depois.novidadesVistas).novidades).toBeNull();
      yield* Effect.promise(() => c.fechar());
    }).pipe(Effect.scoped),
  );

  it.effect("voltar: troca pela anterior na abertura e não baixa de novo a versão recusada", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(cenario);
      c.publicar({ versao: "2026.11.12", anteriores: [c.empacotada] });
      yield* (yield* servico(c, false)).procurar;
      const v12 = yield* servico(c, false);
      expect((yield* v12.estado).base.versao).toBe("2026.11.12");
      c.publicar({ versao: "2026.11.13" });
      yield* v12.procurar;
      const v13 = yield* servico(c, false);
      expect((yield* v13.estado).base.versao).toBe("2026.11.13");
      expect((yield* v13.estado).anterior).toBe("2026.11.12");
      expect(yield* v13.voltar).toMatchObject({ resultado: "reiniciar" });
      const voltou = yield* servico(c, false);
      expect((yield* voltou.estado).base.versao).toBe("2026.11.12");
      expect(lerEstado(c.pastaApp).recusada).toBe("2026.11.13");
      const depois = yield* voltou.procurar;
      expect(depois.pendente).toBeNull();
      yield* Effect.promise(() => c.fechar());
    }).pipe(Effect.scoped),
  );

  it.effect("canal trocado: confere o manifesto do outro canal e recusa um manifesto de canal errado", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(cenario);
      c.publicar({ versao: "2026.11.13", canal: "beta" });
      c.publicar({ versao: "2026.11.11", canal: "estavel" });
      const atualizador = yield* servico(c, false);
      const estavel = yield* atualizador.trocarCanal("estavel");
      expect(estavel.canal).toBe("estavel");
      expect((yield* atualizador.procurar).pendente).toBe("2026.11.11");
      expect(c.servidor.pedidos).toContain("estavel/estavel.json");
      expect(c.servidor.pedidos).not.toContain("beta/beta.json");
      // O manifesto do beta servido no lugar do estável: assinado, mas de outro canal.
      c.publicar({ versao: "2026.11.14", canal: "beta", pastaCanal: "estavel" });
      NodeFS.renameSync(
        NodePath.join(c.raiz, "servido", "estavel", "beta.json"),
        NodePath.join(c.raiz, "servido", "estavel", "estavel.json"),
      );
      NodeFS.renameSync(
        NodePath.join(c.raiz, "servido", "estavel", "beta.json.minisig"),
        NodePath.join(c.raiz, "servido", "estavel", "estavel.json.minisig"),
      );
      const recusado = yield* atualizador.procurar;
      expect(recusado.situacao).toBe("erro");
      expect(recusado.erro).toContain("canal beta");
      yield* Effect.promise(() => c.fechar());
    }).pipe(Effect.scoped),
  );

  it.effect("sem feed ou chave na política: desligada, e procurar não sai para a rede", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(cenario);
      const atualizador = yield* Atualizador.make({
        desligada: "a hospedagem do feed ainda não está no app",
        feed: null,
        chave: null,
        canalPadrao: "beta",
        pasta: c.pastaApp,
        bancoEmpacotado: c.empacotada,
        versaoApp: VERSAO_APP,
        abertura: prepararAbertura({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada }),
        versoesSkills: {},
        ocupado: Effect.succeed(false),
        automatico: false,
      });
      const estado = yield* atualizador.procurar;
      expect(estado.desligada).toContain("hospedagem");
      expect(c.servidor.pedidos).toEqual([]);
      yield* Effect.promise(() => c.fechar());
    }).pipe(Effect.scoped),
  );
});
