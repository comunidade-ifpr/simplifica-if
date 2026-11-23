import { expect, test } from "vite-plus/test";
import { alteracoesAnotadas, atoDaNota } from "./alteracoes-anotadas.ts";
import { notasDoTexto } from "./estrutura.ts";
import { montarRegistro } from "./registro.ts";

const registro = montarRegistro("[]", null);

test("o ato da nota, nas formas de data do Planalto", () => {
  expect(atoDaNota("(Redação dada pela Lei nº 14.945, de 2024)")).toEqual({
    ato: "Lei nº 14.945/2024",
    id: "br/lei/2024/14945",
    ano: 2024,
  });
  expect(atoDaNota("(Incluído pela Lei nº 10.793, de 1º.12.2003)")?.id).toBe("br/lei/2003/10793");
  expect(atoDaNota("(Redação dada pela Lei nº 13.281, de 4/5/2016)")?.id).toBe("br/lei/2016/13281");
  expect(atoDaNota("(Revogado Lei nº 14.945, de 2024)")?.id).toBe("br/lei/2024/14945");
  expect(atoDaNota("(Incluído pela Lei Complementar nº 150, de 2015)")).toMatchObject({
    ato: "Lei Complementar nº 150/2015",
    id: "br/lc/2015/150",
  });
  expect(atoDaNota("(Redação dada pela Medida Provisória nº 914, de 2019)")?.id).toBe("br/mp/2019/914");
  // resolução: só com o registro, pelo resolvedor de citações
  expect(atoDaNota("(Incluído pela Resolução CNE/CEB nº 6, de 17 de julho de 2025)")).toBeNull();
  expect(atoDaNota("(Incluído pela Resolução CNE/CEB nº 6, de 17 de julho de 2025)", registro)).toEqual({
    ato: "Resolução CNE/CEB nº 6/2025",
    id: "br/cne-ceb/res/2025/6",
    ano: 2025,
  });
  expect(atoDaNota("(Revogado)")).toBeNull();
  expect(atoDaNota("(Vigência)")).toBeNull();
});

test("agrupa por ato, do mais recente ao mais antigo; vide e regulamento não são alteração", () => {
  const disp = (dispositivo: string, texto: string) => ({ dispositivo, notas: notasDoTexto(texto) });
  const alteracoes = alteracoesAnotadas([
    disp("#art1", "Texto. (Redação dada pela Lei nº 11.741, de 2008)"),
    disp("#art2", "Texto. (Incluído pela Lei nº 14.945, de 2024) (Vide Lei nº 13.415, de 2017)"),
    disp("#art2-par1", "(Revogado pela Lei nº 14.945, de 2024)"),
    disp("#art3", "Texto. (Regulamento) (Vigência)"),
    disp("#art4", "Texto. (Renumerado pela Lei nº 11.741, de 2008) (Redação dada pela Lei nº 11.741, de 2008)"),
  ]);
  expect(alteracoes).toEqual([
    {
      ato: "Lei nº 14.945/2024",
      id: "br/lei/2024/14945",
      ano: 2024,
      redacao: 0,
      inclusao: 1,
      revogacao: 1,
      dispositivos: ["#art2", "#art2-par1"],
    },
    {
      ato: "Lei nº 11.741/2008",
      id: "br/lei/2008/11741",
      ano: 2008,
      redacao: 2,
      inclusao: 0,
      revogacao: 0,
      dispositivos: ["#art1", "#art4"],
    },
  ]);
});
