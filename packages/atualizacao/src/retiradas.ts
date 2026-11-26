/**
 * `catalogo/skills/retiradas.yaml`: o registro, só de acréscimos, das skills retiradas do app. Tirar a
 * pasta de uma skill do repositório não a tira dos computadores: a que veio no instalador continua lá, e
 * a baixada fica até outra skill chegar. O nome que entra aqui vai ao manifesto do canal
 * (`skills_retiradas`) e ao instalador, e o servidor deixa de usar a skill, venha de onde vier.
 *
 * ```yaml
 * retiradas:
 *   - skill: nome-da-skill      # o nome da pasta que saiu de catalogo/skills/
 *     data: 2026-11-26          # quando foi retirada
 *     motivo: Texto curto.      # público, como o resto do repositório
 * ```
 *
 * Um nome retirado não volta: a entrada não se apaga nem se edita (`soAcrescimos`), e a skill que a
 * substitui entra com outro nome.
 */
import * as Schema from "effect/Schema";
import { parse } from "yaml";
import { NomeSkill } from "./manifesto.ts";

/** O nome do arquivo, dentro da pasta de skills (`catalogo/skills/` no repositório, `skills/` no instalador). */
export const ARQUIVO_RETIRADAS = "retiradas.yaml";

export const SkillRetirada = Schema.Struct({
  skill: NomeSkill,
  data: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/, { message: "esperava AAAA-MM-DD" })),
  motivo: Schema.String.check(Schema.isMinLength(1)),
});

export const ArquivoRetiradas = Schema.Struct({ retiradas: Schema.Array(SkillRetirada) });
export type ArquivoRetiradas = typeof ArquivoRetiradas.Type;

const decodificar = Schema.decodeUnknownSync(ArquivoRetiradas, { onExcessProperty: "error" });

/** Lê o texto do arquivo; lança se ele não for YAML válido ou sair do formato. Vazio: nenhuma retirada. */
export function lerRetiradas(texto: string): ArquivoRetiradas {
  const lido: unknown = parse(texto, { schema: "core" });
  return decodificar(lido ?? { retiradas: [] });
}

/** Como `lerRetiradas`, para quem só precisa saber se o arquivo se lê: `undefined` no que ela recusa. */
export function tentarLerRetiradas(texto: string): ArquivoRetiradas | undefined {
  try {
    return lerRetiradas(texto);
  } catch {
    return undefined;
  }
}

/** Os nomes retirados, sem repetição, em ordem alfabética: o `skills_retiradas` do manifesto. */
export const nomesRetirados = (arquivo: ArquivoRetiradas): ReadonlyArray<string> =>
  [...new Set(arquivo.retiradas.map((entrada) => entrada.skill))].sort();

/** O arquivo novo só acrescenta: cada entrada antiga continua igual, na mesma ordem. Devolve os problemas. */
export function soAcrescimos(antes: ArquivoRetiradas, depois: ArquivoRetiradas): ReadonlyArray<string> {
  const problemas: string[] = [];
  antes.retiradas.forEach((entrada, indice) => {
    const atual = depois.retiradas[indice];
    if (atual === undefined) problemas.push(`a retirada da skill ${entrada.skill} saiu do registro`);
    else if (JSON.stringify(atual) !== JSON.stringify(entrada))
      problemas.push(`a retirada da skill ${entrada.skill} foi alterada`);
  });
  return problemas;
}

/** Skills que estão nas duas listas: a retirada não pode continuar no catálogo. Devolve os nomes. */
export const retiradasAindaNoCatalogo = (
  arquivo: ArquivoRetiradas,
  skillsDoCatalogo: ReadonlyArray<string>,
): ReadonlyArray<string> => nomesRetirados(arquivo).filter((nome) => skillsDoCatalogo.includes(nome));
