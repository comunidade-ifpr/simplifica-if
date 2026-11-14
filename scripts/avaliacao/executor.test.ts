import { afterAll, describe, expect, test } from "vite-plus/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { carregarConfig } from "./carregar.ts";
import { esquemaConfig } from "./esquema.ts";
import {
  ambienteClaude,
  argumentosClaude,
  chavesArquivosEnv,
  REGRAS_NEGADAS,
  VARIAVEIS_AMBIENTE_CLAUDE,
} from "./executor.ts";

const diretorio = mkdtempSync(path.join(tmpdir(), "avaliacao-env-"));
afterAll(() => rmSync(diretorio, { recursive: true, force: true }));

/** Ambiente de um runtime que carrega o `.env.local` sozinho: shell do usuário + o que veio do arquivo. */
const ENV_LOCAL = "NOTION_TOKEN=secret_x\nSUAP_USUARIO=fulano\nSUAP_SENHA=senha\nANTHROPIC_API_KEY=da-env-local\n";
const PROCESSO = {
  PATH: "/usr/bin:/bin",
  HOME: "/Users/alguem",
  USER: "alguem",
  LANG: "pt_BR.UTF-8",
  NOTION_TOKEN: "secret_x",
  SUAP_USUARIO: "fulano",
  SUAP_SENHA: "senha",
  ANTHROPIC_API_KEY: "da-env-local",
  GITHUB_TOKEN: "ghp_x",
  AWS_SECRET_ACCESS_KEY: "aws",
  SSH_AUTH_SOCK: "/tmp/agent",
  CLAUDE_BIN: "/opt/claude",
};

describe("ambiente do claude -p", () => {
  writeFileSync(path.join(diretorio, ".env.local"), ENV_LOCAL);
  writeFileSync(path.join(diretorio, ".env"), "OUTRA=1\n");

  test("lê as chaves de todos os .env* do diretório", () => {
    expect([...chavesArquivosEnv(diretorio)].sort()).toEqual([
      "ANTHROPIC_API_KEY",
      "NOTION_TOKEN",
      "OUTRA",
      "SUAP_SENHA",
      "SUAP_USUARIO",
    ]);
    expect(chavesArquivosEnv(path.join(diretorio, "inexistente")).size).toBe(0);
  });

  test("só passa a lista explícita e nada que venha de .env*", () => {
    const ambiente = ambienteClaude(PROCESSO, chavesArquivosEnv(diretorio));
    expect(ambiente).toEqual({ PATH: "/usr/bin:/bin", HOME: "/Users/alguem", USER: "alguem", LANG: "pt_BR.UTF-8" });
    for (const chave of Object.keys(ambiente)) {
      expect(VARIAVEIS_AMBIENTE_CLAUDE as readonly string[]).toContain(chave);
    }
  });

  test("a credencial do claude só passa quando vem do shell", () => {
    expect(ambienteClaude(PROCESSO).ANTHROPIC_API_KEY).toBe("da-env-local");
    expect(ambienteClaude(PROCESSO, new Set(["ANTHROPIC_API_KEY"])).ANTHROPIC_API_KEY).toBeUndefined();
  });

  test("a lista não inclui segredos do projeto nem de outros serviços", () => {
    for (const nome of VARIAVEIS_AMBIENTE_CLAUDE) {
      if (nome === "ANTHROPIC_API_KEY" || nome === "CLAUDE_CODE_OAUTH_TOKEN") continue;
      expect(nome).not.toMatch(/TOKEN|SENHA|SECRET|PASSWORD|KEY|USUARIO|SSH|AWS|GITHUB|NOTION|SUAP|SEI/u);
    }
  });
});

describe("regras de permissão do claude -p", () => {
  const config = carregarConfig();
  const argumentos = argumentosClaude("Pergunta?", { config });
  const lista = (flag: string) => {
    const inicio = argumentos.indexOf(flag) + 1;
    const fim = argumentos.findIndex((valor, indice) => indice >= inicio && valor.startsWith("--"));
    return argumentos.slice(inicio, fim);
  };

  test("pré-aprova só leitura dentro do repositório e não oferece Bash", () => {
    expect(lista("--allowedTools")).toEqual(["Read(./**)", "Grep", "Glob"]);
    expect(argumentos[argumentos.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
    expect(argumentos[argumentos.indexOf("--permission-mode") + 1]).toBe("dontAsk");
  });

  test("nega sempre Bash, escrita, web e a leitura de segredos", () => {
    const negadas = lista("--disallowedTools");
    expect(negadas).toEqual([...REGRAS_NEGADAS]);
    for (const regra of ["Bash", "Edit", "Write", "WebFetch", "Read(./.env*)", "Read(./**/.env*)", "Read(~/.ssh/**)"]) {
      expect(negadas).toContain(regra);
    }
  });

  test("o esquema recusa Bash em ferramentas e regras", () => {
    const base = {
      modelo: "sonnet",
      execucoes: 1,
      max_turns: 5,
      ferramentas: ["Read"],
      ferramentas_permitidas: ["Read"],
    };
    expect(esquemaConfig.safeParse(base).success).toBe(true);
    expect(esquemaConfig.safeParse({ ...base, ferramentas: ["Read", "Bash"] }).success).toBe(false);
    expect(esquemaConfig.safeParse({ ...base, ferramentas_permitidas: ["Bash(jq *)"] }).success).toBe(false);
  });
});
