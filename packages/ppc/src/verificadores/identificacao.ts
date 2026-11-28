/** Verificadores D de identificação do curso: denominação (CT-IDENT-01) e eixo (CT-IDENT-13) contra o CNCT. */
import { type Apontamento, chave, linhaDe, linkCnct, resultado, trecho, type Verificador } from "./comum.ts";

const SEM_CNCT = "O curso não foi identificado no CNCT; a pessoa confere a identificação antes da revisão.";

export const denominacaoCnct: Verificador = {
  id: "d-denominacao-cnct",
  ficha: "CT-IDENT-01",
  descricao:
    "A denominação “Técnico em …” mais próxima do início do PPC (200 primeiras linhas) começa pela denominação do CNCT, sem diferença de maiúsculas e acentos.",
  verificar(ppc, { cnct }) {
    if (!cnct) return resultado(this, [], { estado: "a_conferir", mensagem: SEM_CNCT });
    const inicio = ppc.linhas.slice(0, Math.min(ppc.linhas.length, 200)).join("\n");
    const denominacoes = [...inicio.matchAll(/t[ée]cnico em [a-záéíóúâêôãõç][^\n|*,;:.()]{2,60}/gi)].map((m) => ({
      texto: m[0].trim(),
      linha: linhaDe(inicio, m.index),
    }));
    const alvo = chave(cnct.denominacao);
    const fontes = [linkCnct(cnct.slug)];
    const igual = denominacoes.find((d) => chave(d.texto).startsWith(alvo));
    if (igual)
      return resultado(this, [], {
        estado: "atende",
        mensagem: `A denominação corresponde à do CNCT: "${cnct.denominacao}".`,
        evidencias: [trecho(ppc, igual.linha, igual.texto)],
        fontes,
      });
    if (!denominacoes.length)
      return resultado(
        this,
        [
          {
            estado: "a_conferir",
            mensagem: `Não encontramos a denominação "Técnico em …" no início do PPC. Pelo CNCT, é "${cnct.denominacao}".`,
            trechos: [],
            fontes,
            escalarParaIa: "nao_encontrado",
          },
        ],
        { estado: "a_conferir", mensagem: "" },
      );
    const primeira = denominacoes[0]!;
    return resultado(
      this,
      [
        {
          estado: "nao_atende",
          mensagem: `A denominação "${primeira.texto}" não corresponde à do CNCT: "${cnct.denominacao}".`,
          trechos: [trecho(ppc, primeira.linha, primeira.texto)],
          fontes,
        },
      ],
      { estado: "nao_atende", mensagem: "" },
    );
  },
};

export const eixoCnct: Verificador = {
  id: "d-eixo-cnct",
  ficha: "CT-IDENT-13",
  descricao:
    "Alguma declaração “Eixo Tecnológico: …” contém o eixo do CNCT. Divergência ou ausência saem a conferir: na base, a maioria das divergências era abreviação ou texto colado pela conversão.",
  verificar(ppc, { cnct }) {
    if (!cnct) return resultado(this, [], { estado: "a_conferir", mensagem: SEM_CNCT });
    const fontes = [linkCnct(cnct.slug)];
    // Basta uma declaração compatível (a matriz pode ter um "eixo" de núcleo).
    const eixos = [...ppc.markdown.matchAll(/Eixo\s+Tecnol[óo]gico\s*\**\s*[:\-–|]\s*\**\s*([^\n|*]+)/gi)];
    const eixoEsperado = chave(cnct.eixo_tecnologico);
    const compativel = eixos.find((eixo) => chave(eixo[1]!).includes(eixoEsperado));
    // O valor também pode vir sem separador ou na linha seguinte (célula de tabela, "Eixo Tecnológico**" ↵ valor).
    const linhaJanela = ppc.linhas.findIndex(
      (linha, i) =>
        /\beixo\b/.test(chave(linha)) &&
        chave(
          ppc.linhas
            .slice(i, i + 4)
            .join(" ")
            .replace(/[*|]/g, " "),
        ).includes(eixoEsperado),
    );
    if (compativel || linhaJanela >= 0) {
      const evidencia = compativel
        ? trecho(ppc, linhaDe(ppc.markdown, compativel.index), compativel[1]!.trim())
        : trecho(ppc, linhaJanela + 1);
      return resultado(this, [], {
        estado: "atende",
        mensagem: `O eixo declarado corresponde ao do CNCT: "${cnct.eixo_tecnologico}".`,
        evidencias: [evidencia],
        fontes,
      });
    }
    const apontamento: Apontamento = eixos.length
      ? {
          estado: "a_conferir",
          mensagem: `O eixo declarado ("${eixos[0]![1]!.trim()}") difere do CNCT: "${cnct.eixo_tecnologico}".`,
          trechos: [trecho(ppc, linhaDe(ppc.markdown, eixos[0]!.index), eixos[0]![1]!.trim())],
          fontes,
          escalarParaIa: "divergente",
        }
      : {
          estado: "a_conferir",
          mensagem: `Não encontramos o eixo tecnológico declarado. Pelo CNCT, é "${cnct.eixo_tecnologico}".`,
          trechos: [],
          fontes,
          escalarParaIa: "nao_encontrado",
        };
    return resultado(this, [apontamento], { estado: "a_conferir", mensagem: "" });
  },
};
