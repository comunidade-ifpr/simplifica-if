import { describe, expect, test } from "bun:test";
import { padronizarTurno } from "./ingresso.ts";

describe("padronizarTurno", () => {
  test("cobre as grafias dos editais de 2025 e 2026, com e sem marca de rodapé", () => {
    const casos: Array<[string, string]> = [
      ["Matutino", "matutino"],
      ["Vespertino", "vespertino"],
      ["Noturno", "noturno"],
      ["Integral", "integral"],
      ["Diurno (Integral)", "integral"],
      ["Diurno", "diurno"],
      ["Diurno¹", "diurno"],
      ["Diurno ²", "diurno"],
      ["Diurno (manhã e tarde)²", "diurno"],
      ["Diurno (tarde e manhã)¹", "diurno"],
      ["Matutino/Vespertino¹", "diurno"],
      ["Diurno (Manhã + 2 tardes)¹", "matutino-com-contraturno"],
      ["Diurno (manhã+duas tardes)¹", "matutino-com-contraturno"],
      ["Diurno (Manhã + 3 tardes por semana)¹", "matutino-com-contraturno"],
      ["Diurno (Manhã + 1 tarde por semana)²", "matutino-com-contraturno"],
      ["Diurno (Matutino + 1 tarde)²", "matutino-com-contraturno"],
      ["Matutino + duas tardes por semana¹", "matutino-com-contraturno"],
      ["Matutino (manhã + 2 tardes por semana¹", "matutino-com-contraturno"],
      ["Matutino com contraturno a tarde", "matutino-com-contraturno"],
      ["Matutino (com contraturno a tarde)²", "matutino-com-contraturno"],
      ["Diurno (Vespertino + 2 manhãs por semana)¹", "vespertino-com-contraturno"],
      ["Vespertino com contraturno pela manhã", "vespertino-com-contraturno"],
      ["Vespertino (com contraturno pela manhã)³", "vespertino-com-contraturno"],
    ];
    for (const [grafia, esperado] of casos) expect([grafia, padronizarTurno(grafia)]).toEqual([grafia, esperado]);
  });

  test("deixa para a curadoria a grafia que não reconhece", () => {
    expect(padronizarTurno("Sábados")).toBeUndefined();
    expect(padronizarTurno("Matutino e noturno")).toBeUndefined();
  });
});
