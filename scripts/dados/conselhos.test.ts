import { describe, expect, test } from "vite-plus/test";
import { auditarConselhos, carregarConselhos, type Conselhos } from "./conselhos.ts";

describe("conselhos", () => {
  test("os registros do Consepe na base são válidos e não têm campos de pessoa", () => {
    const { dados, erros } = carregarConselhos();
    expect(erros).toEqual([]);
    expect(dados.conselhos.map((c) => c.dados.conselho_id)).toEqual(["consepe"]);
    const texto = JSON.stringify(dados);
    expect(texto).not.toMatch(/relator|conselheir/i);
  });

  test("acusa documento fora da reunião e curso inexistente ou de outro campus", () => {
    const { dados } = carregarConselhos();
    const reuniao = dados.reunioes[0]!;
    const item = { ...reuniao.dados.itens_pauta[0]!, documento_id: "x", campus_id: "a", curso_id: "b/c" };
    const alterado: Conselhos = {
      ...dados,
      reunioes: [{ ...reuniao, dados: { ...reuniao.dados, itens_pauta: [item] } }],
    };
    const erros = auditarConselhos(alterado, new Set(["a"]), new Set(["b/c"]));
    expect(erros.map((erro) => erro.split(`${item.item_id}: `)[1])).toEqual([
      "documento_id fora da reunião: x",
      "curso_id de outro campus: b/c",
    ]);
  });
});
