/** Dispositivos de norma por extenso, para quem lê no Word ou na tela (os IDs do `kb`: `art29-par2`). */

const ROMANOS = /^(?=[ivxlc]+$)c{0,3}(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;
const ordinal = (n: string) => (Number(n) <= 9 ? `${n}º` : n);

/** `art29-par2` → "art. 29, § 2º"; `art28-xviii` → "art. 28, inciso XVIII"; `anexo1-art5` → "Anexo 1, art. 5º". */
export function rotuloDispositivo(dispositivo: string): string {
  return dispositivo
    .split("-")
    .map((parte) => {
      let m = /^art(\d+)([a-z]?)$/i.exec(parte);
      if (m) return `art. ${ordinal(m[1]!)}${m[2] ? `-${m[2].toUpperCase()}` : ""}`;
      if (parte === "parunico") return "parágrafo único";
      m = /^par(\d+)$/.exec(parte);
      if (m) return `§ ${ordinal(m[1]!)}`;
      m = /^anexo(\d*)$/.exec(parte);
      if (m) return `Anexo${m[1] ? ` ${m[1]}` : ""}`;
      // Letra só é alínea, salvo i, v e x, que são incisos (c e l, em romanos, seriam 100 e 50).
      if (/^[a-z]$/.test(parte) && !"ivx".includes(parte)) return `alínea ${parte}`;
      if (ROMANOS.test(parte)) return `inciso ${parte.toUpperCase()}`;
      return parte;
    })
    .join(", ");
}
