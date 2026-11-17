// @effect-diagnostics nodeBuiltinImport:off -- teste: lê os registros da base com node:fs
import { describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { validarJsonSchema } from "@simplifica-if/kb/schema";
import { RAIZ_BASE } from "../config.ts";
import {
  jsonSchemaRegistro,
  NOMES_REGISTROS,
  verificarSchemasRegistros,
  type NomeRegistro,
} from "./schemas-publicos.ts";

const ifpr = NodePath.join(RAIZ_BASE, "institucional", "ifpr");
function arquivos(dir: string): string[] {
  return NodeFS.readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = NodePath.join(dir, entrada.name);
    if (entrada.isDirectory()) return arquivos(caminho);
    return entrada.name.endsWith(".json") && entrada.name !== "index.json" ? [caminho] : [];
  });
}
const REGISTROS: Record<NomeRegistro, string[]> = {
  campus: arquivos(NodePath.join(ifpr, "campi")),
  curso: arquivos(NodePath.join(ifpr, "cursos")),
  processo_seletivo: arquivos(NodePath.join(ifpr, "processos-seletivos")),
  edital: arquivos(NodePath.join(ifpr, "editais")),
  oferta: arquivos(NodePath.join(ifpr, "ofertas")),
  conselho: arquivos(NodePath.join(ifpr, "conselhos")).filter((f) => f.endsWith("conselho.json")),
  reuniao_conselho: arquivos(NodePath.join(ifpr, "conselhos")).filter((f) => f.includes("/reunioes/")),
  processos_sei: [NodePath.join(ifpr, "processos-sei", "index.json")],
};

describe("JSON Schemas públicos dos registros", () => {
  test("os arquivos de schemas/registros/ estão em dia com o Effect Schema", () => {
    expect(verificarSchemasRegistros()).toEqual([]);
  });

  test.each(NOMES_REGISTROS)("todo registro de %s da base segue o schema gerado", (nome) => {
    const schema = jsonSchemaRegistro(nome);
    expect(REGISTROS[nome].length).toBeGreaterThan(0);
    const erros = REGISTROS[nome].flatMap((arquivo) =>
      validarJsonSchema(
        JSON.parse(NodeFS.readFileSync(arquivo, "utf-8")),
        schema,
        NodePath.relative(RAIZ_BASE, arquivo),
      ),
    );
    expect(erros).toEqual([]);
  });

  test("o schema recusa chave a mais, null e cnct_id fora do padrão", () => {
    const schema = jsonSchemaRegistro("curso");
    const base = { campus_id: "a", curso_slug: "b", nome: "C" };
    expect(validarJsonSchema(base, schema, "x")).toEqual([]);
    expect(validarJsonSchema({ ...base, extra: 1 }, schema, "x")).not.toEqual([]);
    expect(validarJsonSchema({ ...base, nivel: null }, schema, "x")).not.toEqual([]);
    expect(validarJsonSchema({ ...base, cnct_id: "cnct:catalogo" }, schema, "x")).not.toEqual([]);
  });
});
