// @effect-diagnostics nodeBuiltinImport:off -- teste: monta a pasta de trabalho, com arquivos e links simbólicos, no disco
/**
 * Pasta de trabalho (suíte transversal do T6): o `pacote_contexto` com `arquivo`, pelo servidor
 * isolado em processo (stdio; ver `servidorIsolado`), com a pasta isolada como diretório atual e pasta
 * de trabalho. Lê o `.md` de dentro dela (pelo caminho relativo, numa subpasta e pelo absoluto) e
 * recusa o que fica fora: `..`, caminho absoluto de fora e link simbólico para fora (de arquivo e de
 * pasta). As respostas são as do processo de teste com a mesma pasta; o stderr não registra acesso
 * negado, ou seja, a recusa vem do servidor antes de ler, e não do modelo de permissões; e a pasta fica
 * como estava. Os testes por ferramenta das mesmas regras, sem processo, estão em
 * `test/pacote-contexto.test.ts`.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "@effect/vitest";
import { diretorioTemporario, limparTemporarios } from "../fixture.ts";
import { criarBancoFixturePpcs } from "../fixture-ppcs.ts";
import {
  type Chamada,
  comparavel,
  conteudoDaPasta,
  emProcesso,
  resultado,
  rotulo,
  servidorIsolado,
  type ServidorIsolado,
  sessaoStdio,
  SMOKE_APENAS,
} from "./apoio.ts";

/** Um PPC mínimo em Markdown. */
const MARKDOWN = [
  "# Projeto Pedagógico do Curso Técnico em Enfermagem",
  "",
  "## 1 Organização curricular",
  "",
  "A organização curricular progride do básico ao específico, conforme a Resolução CNE/CP nº 1/2021, art. 20.",
  "",
  "## 2 Estágio",
  "",
  "O estágio supervisionado obrigatório tem 400 horas.",
  "",
].join("\n");

// Links simbólicos no Windows exigem privilégio de administrador ou o modo de desenvolvedor.
const COM_LINKS = NodeOS.platform() !== "win32";

let banco: string;
let isolado: ServidorIsolado;
let fora: string;
beforeAll(async () => {
  if (SMOKE_APENAS) return;
  banco = criarBancoFixturePpcs();
  isolado = await servidorIsolado();
  fora = NodeFS.realpathSync(diretorioTemporario("simplifica-mcp-fora-"));
  NodeFS.writeFileSync(NodePath.join(fora, "segredo.md"), MARKDOWN);
}, 120_000);
afterAll(limparTemporarios);

const pacote = (arquivo: string): Chamada => ({
  nome: "pacote_contexto",
  args: { tarefa: "CT-CURR-12", arquivo },
  valida: true,
});

describe.skipIf(SMOKE_APENAS)("pasta de trabalho: pacote_contexto com arquivo, pelo servidor isolado", () => {
  test("lê dentro da pasta; recusa .., caminho absoluto e link simbólico para fora", async () => {
    const segredo = NodePath.join(fora, "segredo.md");
    const servidor = isolado.preparar(banco, {
      "PPC.md": MARKDOWN,
      "rodada/PPC.md": MARKDOWN,
      ...(COM_LINKS ? { "link.md": { link: segredo }, atalho: { link: fora } } : {}),
    });
    const antes = conteudoDaPasta(servidor.pasta);
    const dentro = ["PPC.md", "rodada/PPC.md", NodePath.join(servidor.pasta, "PPC.md")];
    const recusados: [arquivo: string, motivo: string][] = [
      [NodePath.relative(servidor.pasta, segredo), "fica fora da pasta de trabalho"],
      ["rodada/../../segredo.md", "fica fora da pasta de trabalho"],
      [segredo, "fica fora da pasta de trabalho"],
      ["nao-existe.md", "não existe na pasta de trabalho"],
      ...(COM_LINKS
        ? ([
            ["link.md", "link simbólico para fora da pasta de trabalho"],
            ["atalho/segredo.md", "link simbólico para fora da pasta de trabalho"],
          ] as [string, string][])
        : []),
    ];
    // a recusa é uma resposta de erro, calculada igual no processo de teste (que a marca como inválida)
    const lista = [...dentro.map(pacote), ...recusados.map(([arquivo]) => ({ ...pacote(arquivo), valida: false }))];

    const [sessao, esperado] = await Promise.all([
      sessaoStdio(servidor, lista),
      emProcesso(banco, lista, servidor.pasta),
    ]);
    lista.forEach((c, i) => {
      expect(comparavel(resultado(sessao.respostas[i]!)), rotulo(c)).toBe(comparavel(esperado[i]!));
    });
    dentro.forEach((arquivo, i) => {
      const r = resultado(sessao.respostas[i]!);
      expect(r.isError, `${arquivo}: ${r.content[0]?.text}`).toBeFalsy();
      // o caminho do pacote é sempre o relativo à pasta, mesmo pedido pelo absoluto
      const relativo = i === 2 ? "PPC.md" : arquivo;
      expect(r.content[0]!.text, arquivo).toContain(`arquivo \`${relativo}\` (PPC fora da base`);
      expect((r.structuredContent as { dados: { path: string } }).dados.path).toBe(relativo);
    });
    recusados.forEach(([arquivo, motivo], i) => {
      const r = resultado(sessao.respostas[dentro.length + i]!);
      expect(r.isError, arquivo).toBe(true);
      expect(r.content[0]!.text, arquivo).toContain(motivo);
      expect(r.content[0]!.text, arquivo).not.toContain("400 horas");
    });
    expect(sessao.stderr).not.toContain("ERR_ACCESS_DENIED");
    expect(conteudoDaPasta(servidor.pasta)).toEqual(antes);
  });
});
