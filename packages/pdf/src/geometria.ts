/**
 * Os traços retos de uma página (`segmentosDoDesenho`), lidos da lista de operações do pdfjs: as
 * bordas das tabelas. Só linhas horizontais e verticais entram; curvas, diagonais e o caminho de
 * recorte (`endPath`) ficam de fora, e o retângulo preenchido de branco também (fundo, não borda).
 *
 * O caminho vem em `constructPath` (`[operação de pintura, [dados], caixa]`), com os comandos de
 * `DrawOPS` (0 moveTo, 1 lineTo, 2 curveTo, 3 quadraticCurveTo, 4 closePath) em coordenadas do
 * usuário; a matriz corrente (`transform`, com `save` e `restore`) as leva às coordenadas da página,
 * as mesmas do `transform` dos itens de texto.
 */

/** Os códigos de `OPS` do pdfjs que a leitura usa. */
export interface CodigosOps {
  readonly save: number;
  readonly restore: number;
  readonly transform: number;
  readonly constructPath: number;
  readonly endPath: number;
  readonly fill: number;
  readonly eoFill: number;
  readonly setFillRGBColor: number;
  readonly setFillGray: number;
}

export interface SegmentoHorizontal {
  readonly y: number;
  readonly x0: number;
  readonly x1: number;
}

export interface SegmentoVertical {
  readonly x: number;
  readonly y0: number;
  readonly y1: number;
}

export interface Segmentos {
  readonly horizontais: SegmentoHorizontal[];
  readonly verticais: SegmentoVertical[];
}

type Matriz = readonly [number, number, number, number, number, number];
const IDENTIDADE: Matriz = [1, 0, 0, 1, 0, 0];

function multiplicar(m: Matriz, n: Matriz): Matriz {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function aplicar(m: Matriz, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Tolerância, em pontos, para um traço contar como horizontal ou vertical. */
const TOLERANCIA_EIXO = 1;

function ehBranco(cor: unknown): boolean {
  if (typeof cor === "string") return /^#?f{6}$/iu.test(cor);
  if (Array.isArray(cor) || ArrayBuffer.isView(cor)) {
    const valores = Array.from(cor as ArrayLike<number>);
    const escala = valores.some((v) => v > 1) ? 255 : 1;
    return valores.length >= 1 && valores.every((v) => v / escala >= 0.97);
  }
  return false;
}

/** Espessura máxima, em pontos, do retângulo preenchido que conta como borda. */
const ESPESSURA_MAXIMA = 3;

interface Subcaminho {
  readonly pontos: [number, number][];
  fechado: boolean;
  curva: boolean;
}

/** Os subcaminhos de um `constructPath`, com os pontos já nas coordenadas da página. */
function subcaminhos(dados: ArrayLike<number>, matriz: Matriz): Subcaminho[] {
  const lista: Subcaminho[] = [];
  let atual: Subcaminho | undefined;
  let k = 0;
  while (k < dados.length) {
    const comando = dados[k]!;
    if (comando === 0) {
      atual = { pontos: [aplicar(matriz, dados[k + 1]!, dados[k + 2]!)], fechado: false, curva: false };
      lista.push(atual);
      k += 3;
    } else if (comando === 1) {
      atual?.pontos.push(aplicar(matriz, dados[k + 1]!, dados[k + 2]!));
      k += 3;
    } else if (comando === 2 || comando === 3) {
      const passo = comando === 2 ? 7 : 5;
      if (atual) {
        atual.curva = true;
        atual.pontos.push(aplicar(matriz, dados[k + passo - 2]!, dados[k + passo - 1]!));
      }
      k += passo;
    } else if (comando === 4) {
      if (atual) atual.fechado = true;
      k += 1;
    } else break;
  }
  return lista;
}

export function segmentosDoDesenho(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  ops: CodigosOps,
): Segmentos {
  const horizontais: SegmentoHorizontal[] = [];
  const verticais: SegmentoVertical[] = [];
  const pilha: { matriz: Matriz; brancoNoFundo: boolean }[] = [];
  let matriz = IDENTIDADE;
  let brancoNoFundo = false;

  const traco = (a: [number, number], b: [number, number]) => {
    if (Math.abs(a[1] - b[1]) <= TOLERANCIA_EIXO && Math.abs(a[0] - b[0]) > TOLERANCIA_EIXO)
      horizontais.push({ y: (a[1] + b[1]) / 2, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]) });
    else if (Math.abs(a[0] - b[0]) <= TOLERANCIA_EIXO && Math.abs(a[1] - b[1]) > TOLERANCIA_EIXO)
      verticais.push({ x: (a[0] + b[0]) / 2, y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) });
  };

  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null;
    if (fn === ops.save) pilha.push({ matriz, brancoNoFundo });
    else if (fn === ops.restore)
      ({ matriz, brancoNoFundo } = pilha.pop() ?? { matriz: IDENTIDADE, brancoNoFundo: false });
    else if (fn === ops.transform && args) matriz = multiplicar(args as unknown as Matriz, matriz);
    else if (fn === ops.setFillRGBColor && args) brancoNoFundo = ehBranco(args.length === 1 ? args[0] : args);
    else if (fn === ops.setFillGray && args) brancoNoFundo = Number(args[0]) >= 0.97;
    else if (fn === ops.constructPath && args) {
      const pintura = args[0] as number;
      if (pintura === ops.endPath) continue;
      const soPreenche = pintura === ops.fill || pintura === ops.eoFill;
      if (soPreenche && brancoNoFundo) continue;
      const dados = (args[1] as ArrayLike<number>[] | undefined)?.[0] ?? (args[1] as ArrayLike<number> | undefined);
      if (!dados || typeof (dados as ArrayLike<number>).length !== "number") continue;
      for (const sub of subcaminhos(dados, matriz)) {
        if (!soPreenche) {
          for (let j = 1; j < sub.pontos.length; j += 1) traco(sub.pontos[j - 1]!, sub.pontos[j]!);
          if (sub.fechado && sub.pontos.length > 2) traco(sub.pontos.at(-1)!, sub.pontos[0]!);
          continue;
        }
        // Do que só é preenchido, vale o retângulo fino (a borda desenhada como retângulo); o
        // retângulo largo é o fundo da célula, recuado da borda, e criaria colunas que não existem.
        if (sub.curva || sub.pontos.length < 4) continue;
        const xs = sub.pontos.map((p) => p[0]);
        const ys = sub.pontos.map((p) => p[1]);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        if (y1 - y0 <= ESPESSURA_MAXIMA && x1 - x0 > ESPESSURA_MAXIMA) horizontais.push({ y: (y0 + y1) / 2, x0, x1 });
        else if (x1 - x0 <= ESPESSURA_MAXIMA && y1 - y0 > ESPESSURA_MAXIMA)
          verticais.push({ x: (x0 + x1) / 2, y0, y1 });
      }
    }
  }
  return { horizontais, verticais };
}
