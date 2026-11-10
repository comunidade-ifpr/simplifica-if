import { describe, expect, test } from "bun:test";
import { BASES_NOTION, carregarDataSources, esquemaConfigNotion, validarConfigNotion } from "./config.ts";

function configValida() {
  return {
    parent_page_id: "pagina",
    databases: Object.fromEntries(
      BASES_NOTION.map((chave) => [chave, { id: `id-${chave}`, data_source_id: `ds-${chave}`, title: chave }]),
    ),
  };
}

describe("config/notion.json", () => {
  test("a configuração real passa na validação e no schema", () => {
    const fontes = carregarDataSources();
    expect(Object.keys(fontes).sort()).toEqual([...BASES_NOTION].sort());
    for (const id of Object.values(fontes)) expect(id.trim()).not.toBe("");
  });

  test("configuração válida não tem erros e o schema devolve os data sources", () => {
    const config = configValida();
    expect(validarConfigNotion(config)).toEqual([]);
    expect(esquemaConfigNotion.parse(config).databases.cursos.data_source_id).toBe("ds-cursos");
  });

  test("mantém as mensagens de cada defeito", () => {
    expect(validarConfigNotion(null)).toEqual(["config/notion.json: databases deve ser objeto"]);
    expect(validarConfigNotion({ parent_page_id: "p", databases: [] })).toEqual([
      "config/notion.json: databases deve ser objeto",
    ]);
    const config = configValida();
    delete (config.databases as Record<string, unknown>).campi;
    config.databases.cursos!.data_source_id = "  ";
    config.parent_page_id = "";
    expect(validarConfigNotion(config)).toEqual([
      "config/notion.json: parent_page_id ausente",
      "config/notion.json: base ausente: campi",
      "config/notion.json: databases.cursos.data_source_id ausente",
    ]);
  });

  test("o schema recusa o que a validação recusaria", () => {
    const config = configValida();
    config.databases.tarefas!.data_source_id = 7 as unknown as string;
    expect(esquemaConfigNotion.safeParse(config).success).toBe(false);
    expect(esquemaConfigNotion.safeParse({ databases: {} }).success).toBe(false);
  });
});
