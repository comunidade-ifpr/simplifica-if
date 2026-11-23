/**
 * Leituras das ferramentas de normas (T2): `buscar_norma`, `ler_dispositivos`, `ficha_norma`,
 * `correspondencia` e `resolver_citacoes`, sobre o serviço `Normas` do kb. Cada uma recebe a entrada
 * já decodificada e devolve a `Resposta` com os avisos; o texto para a IA fica nas ferramentas.
 */
import * as Normas from "@simplifica-if/kb/Normas";
import type { EventoVigencia } from "@simplifica-if/kb/normas/vigencia";
import * as Effect from "effect/Effect";
import { type Aviso, type Base, type DispositivoTexto, EntradaInvalida, type NormaResumo } from "../contratos.ts";
import { paginar, responder } from "../envelope.ts";
import type * as BuscarNorma from "../ferramentas/buscar-norma.ts";
import * as Correspondencia from "../ferramentas/correspondencia.ts";
import type * as FichaNorma from "../ferramentas/ficha-norma.ts";
import type * as LerDispositivos from "../ferramentas/ler-dispositivos.ts";
import * as ResolverCitacoes from "../ferramentas/resolver-citacoes.ts";
import { linkDe, linkNorma } from "../links.ts";
import { avisosDasNormas, dispositivoTexto, leitorDeNormas, relacaoSaida, resumoDaNorma } from "./comum.ts";

function ocorreu(valor: EventoVigencia["ocorreu"]): string {
  return valor === true ? "sim" : valor === false ? "não" : "a confirmar";
}

export const makeNormas = Effect.fn("Leitura.makeNormas")(function* (base: Base) {
  const normas = yield* Normas.Normas;

  const buscarNorma = Effect.fn("Leitura.buscarNorma")(function* (e: typeof BuscarNorma.Entrada.Type) {
    const norma = leitorDeNormas(normas);
    const { resultados: achados } = yield* normas.buscar(e.consulta, {
      limite: e.limite,
      ...(e.situacao ? { situacao: e.situacao } : {}),
      ...(e.vigentes ? { vigentes: e.vigentes } : {}),
      ...(e.em ? { em: e.em } : {}),
    });
    // laço por resultado da busca (até 20): cada um consulta a norma e o trecho
    const resultados = yield* Effect.forEach(
      achados,
      Effect.fnUntraced(function* (r) {
        const registrada = yield* norma(r.norma.id);
        if (!registrada) return yield* Effect.die(`norma do resultado fora da tabela normas: ${r.norma.id}`);
        const resultado: {
          -readonly [K in keyof BuscarNorma.Resultado]: BuscarNorma.Resultado[K];
        } = { norma: resumoDaNorma(registrada), origem: r.origem, pontuacao: r.pontuacao };
        if (r.dispositivo) resultado.dispositivo = yield* dispositivoTexto(normas, r.dispositivo);
        if (r.metadados) {
          resultado.metadados = {
            texto: r.metadados.texto,
            fonte: { path: r.metadados.path, linha_inicio: r.metadados.linha, linha_fim: r.metadados.linha },
          };
        }
        if (r.pedido) resultado.citado_fora_do_texto = r.pedido;
        return resultado as BuscarNorma.Resultado;
      }),
    );
    const avisos: Aviso[] = [];
    if (resultados.length === 0) {
      avisos.push({
        tipo: "nao-encontrado",
        mensagem:
          "nenhuma norma encontrada na base para a consulta; tente outros termos ou resolver_citacoes, e não preencha com memória",
      });
    }
    for (const r of resultados) {
      if (r.citado_fora_do_texto && r.dispositivo) {
        avisos.push({
          tipo: "nao-encontrado",
          mensagem: `o dispositivo citado não está no texto da base; mostrando o mais próximo, ${r.dispositivo.id}`,
          ref: r.citado_fora_do_texto,
        });
      }
    }
    avisos.push(...avisosDasNormas(resultados.map((r) => r.norma)));
    return responder(base, { resultados }, { avisos });
  });

  const lerDispositivos = Effect.fn("Leitura.lerDispositivos")(function* (e: typeof LerDispositivos.Entrada.Type) {
    const norma = leitorDeNormas(normas);
    const dispositivos: LerDispositivos.Dispositivo[] = [];
    const resumos: NormaResumo[] = [];
    const naoEncontrados: string[] = [];
    for (const id of new Set(e.ids)) {
      const achado = yield* normas.dispositivo(id);
      const trecho = achado ? yield* normas.trecho(id, { subordinados: e.filhos }) : null;
      const registrada = achado ? yield* norma(achado.disp.norma) : null;
      if (!achado || !trecho || !registrada) {
        naoEncontrados.push(id);
        continue;
      }
      const { pai } = achado.disp;
      resumos.push(resumoDaNorma(registrada));
      dispositivos.push({
        ...(yield* dispositivoTexto(normas, trecho)),
        norma: registrada.titulo,
        notas: trecho.notas.map((n) => n.texto),
        pai: pai === null ? null : `${achado.disp.norma}${pai.slice(pai.indexOf("#"))}`,
        estrutura: achado.disp.estrutura,
      });
    }
    const avisos: Aviso[] = naoEncontrados.map((id) => ({
      tipo: "nao-encontrado",
      mensagem: "dispositivo não encontrado no texto da base; confira o ID com buscar_norma ou resolver_citacoes",
      ref: id,
    }));
    avisos.push(...avisosDasNormas(resumos));
    return responder(base, { dispositivos, nao_encontrados: naoEncontrados }, { avisos });
  });

  const fichaNorma = Effect.fn("Leitura.fichaNorma")(function* (e: typeof FichaNorma.Entrada.Type) {
    const ato = e.id.split("#")[0]!;
    const norma = yield* leitorDeNormas(normas)(ato);
    if (!norma) {
      return yield* new EntradaInvalida({
        mensagem: `norma não encontrada na base: ${e.id}. Use buscar_norma ou resolver_citacoes para achar o ID canônico.`,
      });
    }
    const vigencia = yield* normas.vigencia(ato, e.em ? { em: e.em } : {});
    const relacoes = yield* normas.relacoes(ato);
    const resumo = resumoDaNorma(norma);
    const avisos: Aviso[] = vigencia.pendencias.map((p) => ({ tipo: "vigencia-a-confirmar", mensagem: p, ref: ato }));
    avisos.push(...avisosDasNormas([resumo]).filter((a) => a.tipo !== "vigencia-a-confirmar"));
    const sucessoras = yield* normas.sucessoras(ato);
    const anotadas = yield* normas.alteracoesAnotadas(ato);
    const leitor = leitorDeNormas(normas);
    const alteracoesAnotadas = yield* Effect.forEach(anotadas, (a) =>
      Effect.map(leitor(a.id), (registrada) => ({
        ato: a.ato,
        id: a.id,
        // só o ato com texto na base abre no leitor
        link: registrada?.situacao === "base" ? linkNorma(a.id) : null,
        redacao: a.redacao,
        inclusao: a.inclusao,
        revogacao: a.revogacao,
        dispositivos: a.dispositivos,
      })),
    );
    return responder(
      base,
      {
        norma: {
          ...resumo,
          orgao: norma.orgao,
          tipo_documento: norma.tipo_documento,
          numero: norma.numero,
          ano: norma.ano,
          fonte_url: norma.fonte_url,
          fonte_referencia: norma.fonte_referencia,
          pontos_chave: norma.pontos_chave,
          notas_da_fonte: norma.notas_da_fonte,
        },
        vigencia: {
          data: vigencia.data,
          status: vigencia.status,
          certo: vigencia.certo,
          inicio: vigencia.inicio,
          eventos: vigencia.eventos.map((ev) => ({
            tipo: ev.tipo,
            origem: ev.origem,
            operador: ev.operador,
            alvo_dispositivo: ev.alvo_dispositivo,
            alcance: ev.alcance,
            efeito_de: ev.efeito_de,
            efeito_minimo: ev.efeito_minimo,
            ocorreu: ocorreu(ev.ocorreu),
          })),
          pendencias: vigencia.pendencias,
        },
        relacoes: { entrada: relacoes.entrada.map(relacaoSaida), saida: relacoes.saida.map(relacaoSaida) },
        alteracoes_anotadas: alteracoesAnotadas,
        sucessoras,
        transicoes: vigencia.transicoes.map((t) => ({
          id: t.id,
          dispositivo: `${t.norma}${t.dispositivo}`,
          tipo: t.tipo,
          norma_anterior: t.norma_anterior ?? null,
          aplica_a: t.aplica_a,
          regra: t.regra,
          situacao_na_data: t.situacao,
          inicio: t.inicio,
          fim: t.fim,
          inicio_em: t.inicio_em,
          inicio_minimo: t.inicio_minimo,
          fim_em: t.fim_em,
          evidencia: t.evidencia,
          link: linkNorma(t.norma, t.dispositivo.slice(1)),
        })),
      },
      { avisos },
    );
  });

  const trecho = Effect.fn("Leitura.trecho")(function* (id: string) {
    const t = yield* normas.trecho(id);
    return t ? yield* dispositivoTexto(normas, t) : null;
  });

  const correspondencia = Effect.fn("Leitura.correspondencia")(function* (e: typeof Correspondencia.Entrada.Type) {
    const ato = e.id.split("#")[0]!;
    const comDispositivo = e.id.includes("#");
    const tabelas = yield* normas.tabelasDeCorrespondencia(ato);
    const resultados = yield* normas.correspondencia(e.id);
    const avisos: Aviso[] = [];
    if (comDispositivo && e.cursor !== undefined) {
      return yield* new EntradaInvalida({
        mensagem: "cursor só vale na consulta da norma inteira (ID sem dispositivo)",
      });
    }
    const { itens: pagina, pagina: dadosPagina } = comDispositivo
      ? { itens: resultados, pagina: undefined }
      : yield* paginar(resultados, {
          limite: Correspondencia.PAGINA_CORRESPONDENCIA,
          cursor: e.cursor,
          consulta: { id: e.id },
        });
    // laço por item da página (até 10 artigos, ou os de um dispositivo)
    const itens = yield* Effect.forEach(
      pagina,
      Effect.fnUntraced(function* (r) {
        const origem = yield* trecho(r.id);
        if (!origem) return yield* Effect.die(`dispositivo de origem da correspondência fora do texto: ${r.id}`);
        const destino: DispositivoTexto[] = [];
        for (const d of r.textos_destino) {
          const t = yield* trecho(d.id);
          if (t) destino.push(t);
          else
            avisos.push({
              tipo: "nao-encontrado",
              mensagem: "dispositivo de destino fora do texto da base",
              ref: d.id,
            });
        }
        const item: Correspondencia.Item = {
          origem,
          tipo: r.item.tipo,
          destino,
          nota: r.item.nota ?? null,
          herdado_de: r.herdado_de === null ? null : `${ato}${r.herdado_de}`,
          detalhes: r.detalhes.map((x) => ({
            origem: `${ato}${x.origem}`,
            tipo: x.tipo,
            destino: x.destino.map((d) => `${r.destino_ato}${d}`),
            nota: x.nota ?? null,
          })),
        };
        return item;
      }),
    );
    const tabela = tabelas[0];
    if (!tabela) {
      avisos.push({
        tipo: "nao-encontrado",
        mensagem: "não há tabela de correspondência com origem nesta norma",
        ref: ato,
      });
    } else if (itens.length === 0) {
      avisos.push({
        tipo: "nao-encontrado",
        mensagem: "o dispositivo não está na tabela de correspondência nem no texto da norma",
        ref: e.id,
      });
    }
    for (const t of tabelas) {
      if (t.status === "rascunho") {
        avisos.push({
          tipo: "correspondencia-rascunho",
          mensagem: `a tabela de correspondência ${t.origem} → ${t.destino} é rascunho, sem revisão jurídica: use como indicação, nunca como fundamento`,
          ref: t.arquivo,
        });
      }
    }
    return responder(
      base,
      {
        tabela: tabela
          ? {
              arquivo: tabela.arquivo,
              origem: tabela.origem,
              destino: tabela.destino,
              status: tabela.status,
              elaborado_em: tabela.elaborado_em ?? null,
              revisado_por: tabela.revisado_por ?? null,
            }
          : null,
        itens,
      },
      { avisos, pagina: dadosPagina },
    );
  });

  const resolverCitacoes = Effect.fn("Leitura.resolverCitacoes")(function* (e: typeof ResolverCitacoes.Entrada.Type) {
    // laço por citação (até 50): o resolvedor é uma regra pura sobre o registro carregado na layer
    const itens = yield* Effect.forEach(
      e.citacoes,
      Effect.fnUntraced(function* (texto) {
        const r = yield* normas.resolver(texto);
        const sufixos = r.dispositivos ?? (r.dispositivoId ? [r.dispositivoId] : []);
        const item: ResolverCitacoes.Item = {
          texto,
          id: r.id,
          dispositivos: r.id ? sufixos.map((d) => `${r.id}${d}`) : [],
          regra: r.regra,
          confianca: r.confianca,
          situacao: r.situacao,
          titulo: r.titulo ?? null,
          // `cnct:` é o catálogo (ou um curso dele), que tem link próprio; o resto é norma
          link: r.id ? linkDe(r.id) : null,
        };
        return item;
      }),
    );
    const avisos: Aviso[] = [];
    const baixas = itens.filter((i) => i.id !== null && i.confianca < ResolverCitacoes.CONFIANCA_CONFERIR).length;
    if (baixas > 0) {
      avisos.push({
        tipo: "citacao-baixa-confianca",
        mensagem: `${baixas} ${baixas === 1 ? "citação resolvida" : "citações resolvidas"} com confiança abaixo de 0,9: confira no trecho original antes de afirmar`,
      });
    }
    const naoResolvidas = itens.filter((i) => i.id === null).length;
    if (naoResolvidas > 0) {
      avisos.push({
        tipo: "nao-encontrado",
        mensagem: `${naoResolvidas} ${naoResolvidas === 1 ? "citação não identificada" : "citações não identificadas"}: tente buscar_norma com os termos, e não preencha com memória`,
      });
    }
    // o CNCT (`cnct:`) está na base, nos catálogos: não é "sem texto"
    const semTexto = [
      ...new Set(
        itens
          .filter((i) => (i.situacao === "stub" || i.situacao === "externo") && !i.id!.startsWith("cnct:"))
          .map((i) => i.id!),
      ),
    ];
    for (const id of semTexto) {
      avisos.push({
        tipo: "stub-sem-texto",
        mensagem: "norma citada sem texto na base: não afirme o conteúdo dela",
        ref: id,
      });
    }
    return responder(base, { itens }, { avisos });
  });

  return { buscarNorma, lerDispositivos, fichaNorma, correspondencia, resolverCitacoes };
});
