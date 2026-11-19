/**
 * A marca do Simplifica IF como cenas: camadas de formas com preenchimento, das quais saem tanto os SVGs
 * (`paraSvg`) quanto os PNGs do ícone (`raster.ts`). Uma descrição só para os dois, para que o ícone do
 * Dock e o SVG não divirjam.
 *
 * - Logo: "simplifica" em Open Sans 300 colado (respiro de 0,06 em) a "IF" em 800, com o ponto vermelho.
 * - Ícone: "IF." numa placa branca; `relevo` com degradê e sombra, `plano` para 16 a 32 px.
 */
import { ALTURA_MAIUSCULA, type Corrida, IF, SIMPLIFICA } from "./glifos.ts";

export type Ponto = readonly [number, number];

export type Forma =
  /** Um `d` de SVG absoluto, escalado e deslocado (sem rotação, para o H e o V continuarem válidos). */
  | { readonly tipo: "caminho"; readonly d: string; readonly escala: number; readonly origem: Ponto }
  | { readonly tipo: "circulo"; readonly centro: Ponto; readonly raio: number }
  /** O quadrado arredondado dos ícones do macOS: |x|^n + |y|^n = 1; `furo` inverte o sentido (vira buraco). */
  | {
      readonly tipo: "superelipse";
      readonly centro: Ponto;
      readonly semilado: number;
      readonly expoente: number;
      readonly furo?: boolean;
    };

export type Preenchimento =
  | { readonly tipo: "cor"; readonly cor: string }
  | { readonly tipo: "linear"; readonly de: Ponto; readonly ate: Ponto; readonly paradas: readonly [string, string] }
  | {
      readonly tipo: "radial";
      readonly centro: Ponto;
      readonly raio: number;
      readonly paradas: readonly [string, string];
    };

export interface Camada {
  readonly formas: ReadonlyArray<Forma>;
  readonly preenchimento: Preenchimento;
  readonly opacidade?: number;
  /** Desvio-padrão do desfoque gaussiano, em unidades da cena (sombras). */
  readonly desfoque?: number;
  readonly deslocamento?: Ponto;
}

export interface Cena {
  readonly largura: number;
  readonly altura: number;
  /** Para o `<title>` do SVG. */
  readonly titulo: string;
  readonly camadas: ReadonlyArray<Camada>;
}

export const COR = {
  verde: "#1F8A42",
  vermelho: "#C72E2E",
  cinza: "#2D2D2D",
  /** No fundo escuro, o verde e o vermelho do IFPR mais claros (o #1F8A42 some sobre #141414). */
  verdeEscuro: "#4CAF6A",
  vermelhoEscuro: "#E05252",
} as const;

/** Os pontos de uma superelipse, no sentido horário (ou anti-horário, para `furo`). */
export function pontosSuperelipse(centro: Ponto, semilado: number, expoente: number, n: number, furo = false): Ponto[] {
  const pontos: Ponto[] = [];
  for (let i = 0; i < n; i++) {
    const t = ((furo ? n - i : i) / n) * 2 * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pontos.push([
      centro[0] + semilado * Math.sign(c) * Math.abs(c) ** (2 / expoente),
      centro[1] + semilado * Math.sign(s) * Math.abs(s) ** (2 / expoente),
    ]);
  }
  return pontos;
}

// ---------------------------------------------------------------------------------------------------
// Logo

export type VarianteLogo = "claro" | "escuro" | "sobre-verde";

/** Respiro entre "simplifica" e "IF", em unidades de corpo 100. */
const RESPIRO = 6;
/** O ponto do logo: raio e folga entre a tinta do F e a borda do ponto. */
const PONTO_LOGO = { raio: 11.5, folga: 6.5 };

export function cenaLogo(variante: VarianteLogo): Cena {
  const cores = {
    claro: { texto: COR.cinza, marca: COR.verde, ponto: COR.vermelho, anel: undefined },
    escuro: { texto: "#F2F2F2", marca: COR.verdeEscuro, ponto: COR.vermelhoEscuro, anel: undefined },
    // Vermelho direto sobre o verde "vibra" (luminância parecida): o anel branco separa os dois.
    "sobre-verde": { texto: "#FFFFFF", marca: "#FFFFFF", ponto: COR.vermelho, anel: "#FFFFFF" },
  }[variante];
  const topo = -SIMPLIFICA.caixa[1];
  const xS = -SIMPLIFICA.caixa[0];
  const xIF = xS + SIMPLIFICA.avanco + RESPIRO;
  const raio = PONTO_LOGO.raio;
  const cx = xIF + IF.caixa[2] + PONTO_LOGO.folga + raio;
  const anel = cores.anel === undefined ? 0 : 4.5; // cerca de 1 px no cabeçalho (24 px de altura)
  const largura = cx + raio + anel;
  const altura = topo + SIMPLIFICA.caixa[3];
  const corrida = (c: Corrida, x: number): Forma => ({ tipo: "caminho", d: c.d, escala: 1, origem: [x, topo] });
  const ponto: Forma = { tipo: "circulo", centro: [cx, topo - raio], raio };
  return {
    largura: arredondar(largura),
    altura: arredondar(altura),
    titulo: "Simplifica IF",
    camadas: [
      { formas: [corrida(SIMPLIFICA, xS)], preenchimento: { tipo: "cor", cor: cores.texto } },
      { formas: [corrida(IF, xIF)], preenchimento: { tipo: "cor", cor: cores.marca } },
      ...(cores.anel === undefined
        ? []
        : [
            {
              formas: [{ tipo: "circulo", centro: ponto.centro, raio: raio + anel }],
              preenchimento: { tipo: "cor", cor: cores.anel },
            } satisfies Camada,
          ]),
      { formas: [ponto], preenchimento: { tipo: "cor", cor: cores.ponto } },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------
// Ícone

export interface OpcoesIcone {
  /** `mac`: placa de 824 numa tela de 1024, com sombra (a grade da Apple); `windows`: placa quase sangrada. */
  readonly plataforma: "mac" | "windows";
  /** `relevo`: degradê nas letras e no ponto e sombra curta; `plano`: cores chapadas, letras maiores (≤ 32 px). */
  readonly estilo: "relevo" | "plano";
}

export const LADO_ICONE = 1024;
/** O ponto do ícone, em unidades de corpo 100: centro a 1,07 em da origem do "IF" (a folga até o F igual ao vão I–F), raio de 0,13 em. */
const PONTO_ICONE = { centro: 107, raio: 13 };

export function cenaIcone({ plataforma, estilo }: OpcoesIcone): Cena {
  const meio = LADO_ICONE / 2;
  const semilado = plataforma === "mac" ? 412 : 482;
  const centro: Ponto = [meio, meio];
  const relevo = estilo === "relevo";
  // Corpo da fonte proporcional à placa: 600 na placa de 824 (o IF com cerca de 52% da altura da placa, como os
  // glifos dos ícones vizinhos no Dock), maior no plano.
  const corpo = (relevo ? 600 : 630) * (semilado / 412);
  const e = corpo / 100;
  const esquerda = IF.caixa[0];
  const direita = PONTO_ICONE.centro + PONTO_ICONE.raio;
  const x = meio - ((direita - esquerda) * e) / 2 - esquerda * e;
  const base = meio + (ALTURA_MAIUSCULA * e) / 2;
  const raio = PONTO_ICONE.raio * e;
  const cx = x + PONTO_ICONE.centro * e;
  const cy = base - raio;
  const letras: Forma = { tipo: "caminho", d: IF.d, escala: e, origem: [x, base] };
  const ponto: Forma = { tipo: "circulo", centro: [cx, cy], raio };
  const placa: Forma = { tipo: "superelipse", centro, semilado, expoente: 5 };
  // Sem a sombra externa, a placa do Windows precisa de um aro mais visível para não sumir em fundo claro.
  const borda = relevo ? (plataforma === "mac" ? 4 : 12) : 36;

  const camadas: Camada[] = [];
  if (plataforma === "mac") {
    camadas.push({
      formas: [placa],
      preenchimento: { tipo: "cor", cor: "#000000" },
      opacidade: 0.22,
      desfoque: 12,
      deslocamento: [0, 12],
    });
  }
  camadas.push(
    {
      formas: [placa],
      preenchimento: {
        tipo: "linear",
        de: [meio, meio - semilado],
        ate: [meio, meio + semilado],
        paradas: ["#FFFFFF", "#EEF1EE"],
      },
    },
    {
      formas: [placa, { tipo: "superelipse", centro, semilado: semilado - borda, expoente: 5, furo: true }],
      preenchimento: { tipo: "cor", cor: "#D6D9D6" },
    },
  );
  if (relevo) {
    camadas.push(
      {
        formas: [letras, ponto],
        preenchimento: { tipo: "cor", cor: "#0B3D1C" },
        opacidade: 0.35,
        desfoque: 0.028 * corpo,
        deslocamento: [0, 0.032 * corpo],
      },
      {
        formas: [letras],
        preenchimento: {
          tipo: "linear",
          de: [x, base - ALTURA_MAIUSCULA * e],
          ate: [x, base],
          paradas: ["#34B062", "#16683A"],
        },
      },
      {
        formas: [ponto],
        preenchimento: {
          tipo: "radial",
          centro: [cx - raio + 0.7 * raio, cy - raio + 0.6 * raio],
          raio: 1.6 * raio,
          paradas: ["#EE5A5A", "#A82222"],
        },
      },
    );
  } else {
    camadas.push(
      { formas: [letras], preenchimento: { tipo: "cor", cor: COR.verde } },
      { formas: [ponto], preenchimento: { tipo: "cor", cor: COR.vermelho } },
    );
  }
  return { largura: LADO_ICONE, altura: LADO_ICONE, titulo: "Simplifica IF", camadas };
}

// ---------------------------------------------------------------------------------------------------
// SVG

const arredondar = (v: number): number => Math.round(v * 100) / 100;
const num = (v: number): string => {
  const r = arredondar(v);
  return Object.is(r, -0) ? "0" : String(r);
};

/** Os comandos de um `d` absoluto (M L H V Q C Z), com os comandos repetidos implícitos desfeitos. */
export function lerComandos(d: string): Array<{ readonly letra: string; readonly valores: number[] }> {
  const aridade: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, Z: 0 };
  const comandos: Array<{ letra: string; valores: number[] }> = [];
  const fichas = d.match(/[MLHVQCZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  let letra = "";
  let i = 0;
  while (i < fichas.length) {
    const ficha = fichas[i]!;
    if (/^[A-Za-z]$/.test(ficha)) {
      if (ficha !== ficha.toUpperCase()) throw new Error(`comando relativo não suportado: ${ficha}`);
      letra = ficha;
      i++;
      if (letra === "Z") comandos.push({ letra, valores: [] });
      continue;
    }
    const n = aridade[letra];
    if (n === undefined || n === 0) throw new Error(`número sem comando no caminho: ${ficha}`);
    comandos.push({ letra, valores: fichas.slice(i, i + n).map(Number) });
    i += n;
    // Depois de um M, os pares seguintes são L (regra do SVG).
    if (letra === "M") letra = "L";
  }
  return comandos;
}

function caminhoTransformado(d: string, escala: number, origem: Ponto): string {
  const tx = (v: number) => num(origem[0] + v * escala);
  const ty = (v: number) => num(origem[1] + v * escala);
  return lerComandos(d)
    .map(({ letra, valores }) => {
      switch (letra) {
        case "H":
          return `H${tx(valores[0]!)}`;
        case "V":
          return `V${ty(valores[0]!)}`;
        case "Z":
          return "Z";
        default:
          return letra + valores.map((v, k) => (k % 2 === 0 ? tx(v) : ty(v))).join(" ");
      }
    })
    .join("");
}

function dDaForma(forma: Forma): string {
  switch (forma.tipo) {
    case "caminho":
      return caminhoTransformado(forma.d, forma.escala, forma.origem);
    case "circulo": {
      const [cx, cy] = forma.centro;
      const r = forma.raio;
      return `M${num(cx - r)} ${num(cy)}A${num(r)} ${num(r)} 0 1 0 ${num(cx + r)} ${num(cy)}A${num(r)} ${num(r)} 0 1 0 ${num(cx - r)} ${num(cy)}Z`;
    }
    case "superelipse": {
      const pontos = pontosSuperelipse(forma.centro, forma.semilado, forma.expoente, 256, forma.furo);
      return `M${pontos.map(([px, py]) => `${num(px)} ${num(py)}`).join("L")}Z`;
    }
  }
}

/** A cena em SVG, sem texto (só contornos): abre igual em qualquer máquina, sem a fonte instalada. */
export function paraSvg(cena: Cena): string {
  const defs: string[] = [];
  const corpo: string[] = [];
  cena.camadas.forEach((camada, i) => {
    const p = camada.preenchimento;
    let fill: string;
    if (p.tipo === "cor") {
      fill = p.cor;
    } else {
      const id = `p${i}`;
      const paradas = `<stop offset="0" stop-color="${p.paradas[0]}"/><stop offset="1" stop-color="${p.paradas[1]}"/>`;
      defs.push(
        p.tipo === "linear"
          ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(p.de[0])}" y1="${num(p.de[1])}" x2="${num(p.ate[0])}" y2="${num(p.ate[1])}">${paradas}</linearGradient>`
          : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(p.centro[0])}" cy="${num(p.centro[1])}" r="${num(p.raio)}">${paradas}</radialGradient>`,
      );
      fill = `url(#${id})`;
    }
    const atributos = [`fill="${fill}"`];
    if (camada.opacidade !== undefined) atributos.push(`opacity="${camada.opacidade}"`);
    if (camada.desfoque !== undefined) {
      const id = `f${i}`;
      defs.push(
        `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${num(camada.desfoque)}"/></filter>`,
      );
      atributos.push(`filter="url(#${id})"`);
    }
    if (camada.deslocamento !== undefined) {
      atributos.push(`transform="translate(${num(camada.deslocamento[0])} ${num(camada.deslocamento[1])})"`);
    }
    corpo.push(`<path ${atributos.join(" ")} d="${camada.formas.map(dDaForma).join("")}"/>`);
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(cena.largura)} ${num(cena.altura)}" role="img">`,
    `<title>${cena.titulo}</title>`,
    ...(defs.length > 0 ? [`<defs>${defs.join("")}</defs>`] : []),
    ...corpo,
    "</svg>",
    "",
  ].join("\n");
}
