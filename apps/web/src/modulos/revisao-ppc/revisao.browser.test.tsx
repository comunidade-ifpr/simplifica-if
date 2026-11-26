/**
 * Peças da tela "Revisar um PPC" no Chromium, sem servidor: a linha da pendência (a mensagem inteira
 * só aberta, o trecho do PPC com o rótulo, "Ver no PPC" e "Copiar trecho") e a faixa da IA pausada ("Ver andamento",
 * bloco a bloco, e "Encerrar conferência por aqui").
 */
import type {
  BlocoRevisaoIa,
  EstadoRevisaoIa,
  ListaPendencias,
  PendenciaViva,
} from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "../../index.css";
import type { Api } from "../../conexao/api.ts";
import { type ContextoApp, ProvedorApp } from "../../contexto.tsx";
import type { ControleConversa } from "../../conversa/ControleConversa.ts";
import { ControleRevisao, estadoIaInicial, estadoInicialRevisao, type EstadoRevisao } from "./ControleRevisao.ts";
import { FaixaIa } from "./FaixaIa.tsx";
import { LinhaPendencia } from "./LinhaPendencia.tsx";

const montados: Array<() => void> = [];
afterEach(() => {
  for (const desmontar of montados.splice(0)) desmontar();
});

const listaMinima: ListaPendencias = {
  id: "lista-1",
  arquivoOriginal: "/a/PPC.docx",
  sha256: "abc123456789",
  revisao: null,
  criadaEm: "2026-11-22T10:00:00Z",
  atualizadaEm: "2026-11-22T10:00:00Z",
  provider: "claude",
  uso: { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, custoUsd: 0 },
  resultado: {
    arquivoOriginal: "/a/PPC.docx",
    arquivoComentado: "/a/PPC - revisão prévia (Simplifica IF).docx",
    dataBase: "2026-11-22",
    curso: { cnct: null, forma: null, origem: "documento" },
    totalCriterios: 3,
    conferidos: 0,
    conferidosIa: 0,
    paraConferirIa: 0,
    leituraIa: "nenhuma",
    criterios: [],
    foraDaRevisao: [],
  },
  pendencias: [],
};

/** A API sem servidor: a faixa pede os modelos da IA (`providers.detectar`), e sem eles mostra o id do modelo. */
const semServidor = { chamar: () => Promise.reject(new Error("sem servidor no teste")) } as unknown as Api;

function montar(elemento: React.ReactNode, revisao: ControleRevisao, api: Api = semServidor) {
  const contexto: ContextoApp = { api, conversa: {} as ControleConversa, revisao };
  const conteiner = document.createElement("div");
  conteiner.style.cssText = "width:900px";
  document.body.append(conteiner);
  const raiz = createRoot(conteiner);
  raiz.render(<ProvedorApp valor={contexto}>{elemento}</ProvedorApp>);
  montados.push(() => {
    raiz.unmount();
    conteiner.remove();
  });
  return conteiner;
}

const TITULO = "Cita a Resolução CNE/CP nº 1/2021, revogada pela Resolução CNE/CP nº 2/2026, com vigência a confirmar.";
const EXPLICACAO =
  `${TITULO} `.repeat(3) +
  "\nRegras de transição: o PPC elaborado antes da vigência pode manter a citação até a próxima revisão.";

const viva: PendenciaViva = {
  chave: "CT-SUP-12:abc",
  pendencia: {
    ficha: "CT-SUP-12",
    tituloFicha: "Referências com vigência normativa atualizada",
    tema: "Referências",
    ordemTema: 9,
    estado: "a_conferir",
    titulo: TITULO,
    explicacao: EXPLICACAO,
    faltas: ["a norma que a substituiu", "a data da vigência"],
    oQueFazer: "Substitua a norma revogada pela vigente.",
    trecho: "Resolução CNE/CP nº 1, de 5 de janeiro de 2021",
    secao: "7 REFERÊNCIAS",
    fontes: [],
    tambemEm: [],
    noDocumento: "no-trecho",
    origem: "codigo",
    dependeDoCurso: false,
  },
  situacao: "aberta",
  resolvidaPor: null,
  historico: [],
  sugestao: null,
  aceitaIa: true,
};

const abertos: string[] = [];

it("a linha recolhida mostra só o título, em até duas linhas; aberta, a explicação com as quebras, o que falta em lista e o trecho com 'Copiar trecho'", async () => {
  const revisao = new ControleRevisao({} as Api, {
    ...estadoInicialRevisao(),
    fase: "resultado",
    listaId: listaMinima.id,
    lista: listaMinima,
  });
  const conteiner = montar(
    <ul>
      <li data-chave={viva.chave}>
        <LinhaPendencia
          id="pendencia-teste"
          viva={viva}
          aoAbrirLink={(link) => abertos.push(link)}
          linkNoPpc="ifpr://revisao/lista-1/20261122#p-CT-SUP-12:abc"
        />
      </li>
    </ul>,
    revisao,
  );
  const titulo = () => [...conteiner.querySelectorAll("span")].find((s) => s.textContent === TITULO)!;
  const explicacao = () => conteiner.querySelector<HTMLElement>("[data-explicacao]")!;
  await expect.poll(() => titulo()?.className).toContain("line-clamp-2");
  await expect.element(page.getByText("Trecho no PPC")).not.toBeVisible();

  await page.getByRole("button", { name: /Cita a Resolução/ }).click();
  await expect.poll(() => titulo().className).not.toContain("line-clamp-2");
  expect(explicacao().textContent).toBe(EXPLICACAO);
  expect(explicacao().className).toContain("whitespace-pre-line");
  // A explicação cabe na tela: nada cortado com reticências.
  expect(explicacao().scrollHeight).toBeLessThanOrEqual(explicacao().clientHeight + 1);
  // O que falta, um item por linha.
  await expect.element(page.getByText("O que falta")).toBeVisible();
  expect([...conteiner.querySelectorAll("li li")].map((li) => li.textContent)).toEqual([
    "a norma que a substituiu",
    "a data da vigência",
  ]);
  await expect.element(page.getByText("Trecho no PPC")).toBeVisible();
  await expect.element(page.getByText("Resolução CNE/CP nº 1, de 5 de janeiro de 2021")).toBeVisible();

  let copiado = "";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (texto: string) => ((copiado = texto), Promise.resolve()) },
  });
  await page.getByRole("button", { name: "Copiar trecho" }).click();
  await expect.element(page.getByRole("button", { name: "Trecho copiado" })).toBeVisible();
  expect(copiado).toBe(viva.pendencia.trecho);

  // "Ver no PPC" abre o documento inteiro no painel, no trecho da pendência.
  await page.getByRole("button", { name: "Ver no PPC" }).click();
  expect(abertos).toEqual(["ifpr://revisao/lista-1/20261122#p-CT-SUP-12:abc"]);
});

const bloco = (
  id: string,
  ordemTema: number,
  tema: string,
  estado: BlocoRevisaoIa["estado"],
  extra: Partial<BlocoRevisaoIa> = {},
): BlocoRevisaoIa => ({
  id,
  tipo: "S",
  tema,
  ordemTema,
  fichas: 1,
  titulosFichas: [`Critério de ${tema}`],
  estado,
  etapa: null,
  iniciadoEm: null,
  ultimaAtividadeEm: null,
  naoConferidas: 0,
  pendenciasEncontradas: 0,
  segundos: null,
  ...extra,
});

const pausada = {
  id: "revisao-1",
  lista: "lista-1",
  arquivoOriginal: "/a/PPC.docx",
  provider: "claude",
  modelo: "claude-sonnet-5-5",
  modo: "rapido",
  situacao: "pausada",
  motivo: "O Claude demorou demais para responder sobre o tema “Matriz” (j-02).",
  limite: false,
  blocoPausado: "j-02",
  blocos: [
    bloco("s-01-1", 1, "Identificação", "pronto", { segundos: 30, pendenciasEncontradas: 1 }),
    bloco("j-02", 2, "Matriz", "pendente"),
    bloco("j-03", 3, "Estágio", "pendente"),
  ],
  estimativa: {
    provider: "claude",
    blocos: 3,
    fichas: 3,
    tokensEntrada: 1,
    tokensSaida: 1,
    minutos: 1,
    custoUsd: null,
    percentualJanela: 1,
    limiteDoPlano: "do limite de 5 horas",
  },
  uso: { entrada: 1000, saida: 200, cacheLeitura: 0, cacheEscrita: 0, custoUsd: 0 },
  resultado: null,
  criadaEm: "2026-11-22T10:00:00Z",
  atualizadaEm: "2026-11-22T10:05:00Z",
} satisfies EstadoRevisaoIa;

const estadoComIa = (estadoIa: EstadoRevisaoIa): EstadoRevisao => ({
  ...estadoInicialRevisao(),
  fase: "resultado",
  listaId: listaMinima.id,
  lista: listaMinima,
  ia: {
    ...estadoIaInicial(),
    providerEscolhido: estadoIa.provider,
    usaveis: ["claude"],
    modo: estadoIa.modo,
    estado: estadoIa,
  },
});

it("a faixa pausada: 'Ver andamento' abre o painel por tema, e 'Encerrar conferência por aqui' encerra", async () => {
  let encerrou = 0;
  const clienteFake = {
    "revisaoPpc.apagarIa": () => {
      encerrou += 1;
      return Promise.resolve(null);
    },
    "revisaoPpc.lista": () => Promise.resolve(listaMinima),
    "revisaoPpc.prepararIa": () => Promise.resolve({ ...pausada, situacao: "preparada" as const }),
    "providers.detectar": () => Promise.reject(new Error("sem detecção no teste")),
  };
  const apiFake = {
    chamar: (fn: (cliente: typeof clienteFake) => Promise<unknown>) => fn(clienteFake),
  } as unknown as Api;
  const revisao = new ControleRevisao(apiFake, estadoComIa(pausada));
  montar(<FaixaIa faltam={2} />, revisao, apiFake);

  await expect.element(page.getByText("Conferência pausada — 1 de 3 temas")).toBeVisible();
  // Quieta: o painel só abre a pedido.
  expect(page.getByRole("list", { name: "Andamento por tema" }).query()).toBeNull();
  await page.getByRole("button", { name: "Ver andamento" }).click();
  const painel = page.getByRole("list", { name: "Andamento por tema" });
  await expect.element(painel).toBeVisible();
  await expect.element(painel.getByText("Conferido em 30 s; 1 ponto encontrado.", { exact: false })).toBeVisible();
  await expect.element(painel.getByText("A conferência parou neste tema.", { exact: false })).toBeVisible();
  await expect.element(painel.getByText(pausada.motivo)).toBeVisible();
  await expect.element(page.getByText(/Modelo claude-sonnet-5-5/)).toBeVisible();

  await page.getByRole("button", { name: "Encerrar conferência por aqui" }).click();
  await expect.poll(() => encerrou).toBe(1);
});

it("sem tema lido, a faixa pausada não oferece encerrar", async () => {
  const semProntos = { ...pausada, blocos: pausada.blocos.map((b) => ({ ...b, estado: "pendente" as const })) };
  const revisao = new ControleRevisao({} as Api, estadoComIa(semProntos));
  montar(<FaixaIa faltam={3} />, revisao);
  await expect.element(page.getByRole("button", { name: "Retomar" })).toBeVisible();
  expect(page.getByRole("button", { name: "Encerrar conferência por aqui" }).query()).toBeNull();
});
