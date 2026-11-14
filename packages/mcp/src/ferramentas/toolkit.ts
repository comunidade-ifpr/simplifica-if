/**
 * As ferramentas da base do IFPR como um Toolkit do `effect/ai` (`FerramentasIfpr`) e os handlers
 * (`layerHandlers`), que só chamam o serviço `Leitura`. A ordem é a da tabela "Ferramentas" da
 * especificação M0.1; `pacote_contexto` (T4) ainda não existe.
 */
import * as Effect from "effect/Effect";
import { Toolkit } from "effect/ai";
import * as Leitura from "../leitura/Leitura.ts";
import { adequacaoArt71 } from "./adequacao-art71.ts";
import { buscarNorma } from "./buscar-norma.ts";
import { buscarSecoes } from "./buscar-secoes.ts";
import { citacoesDaNorma } from "./citacoes-da-norma.ts";
import { correspondencia } from "./correspondencia.ts";
import { etapa } from "./etapa.ts";
import { fatosPpc } from "./fatos-ppc.ts";
import { fichaCurso } from "./ficha-curso.ts";
import { fichaNorma } from "./ficha-norma.ts";
import { impactoDaNorma } from "./impacto-da-norma.ts";
import { lerDispositivos } from "./ler-dispositivos.ts";
import { lerSecao } from "./ler-secao.ts";
import { listarCursos } from "./listar-cursos.ts";
import { resolverCitacoes } from "./resolver-citacoes.ts";
import { sobreABase } from "./sobre-a-base.ts";

/** As definições (schemas, descrição e texto), na ordem da especificação. */
export const FERRAMENTAS = [
  buscarNorma,
  lerDispositivos,
  fichaNorma,
  correspondencia,
  resolverCitacoes,
  citacoesDaNorma,
  impactoDaNorma,
  adequacaoArt71,
  buscarSecoes,
  lerSecao,
  listarCursos,
  fichaCurso,
  fatosPpc,
  sobreABase,
  etapa,
] as const;

export const FerramentasIfpr = Toolkit.make(
  buscarNorma.tool,
  lerDispositivos.tool,
  fichaNorma.tool,
  correspondencia.tool,
  resolverCitacoes.tool,
  citacoesDaNorma.tool,
  impactoDaNorma.tool,
  adequacaoArt71.tool,
  buscarSecoes.tool,
  lerSecao.tool,
  listarCursos.tool,
  fichaCurso.tool,
  fatosPpc.tool,
  sobreABase.tool,
  etapa.tool,
);

/** Os handlers do Toolkit: cada ferramenta é um método de `Leitura`. */
export const layerHandlers = FerramentasIfpr.toLayer(
  Effect.gen(function* () {
    const leitura = yield* Leitura.Leitura;
    return FerramentasIfpr.of({
      buscar_norma: leitura.buscarNorma,
      ler_dispositivos: leitura.lerDispositivos,
      ficha_norma: leitura.fichaNorma,
      correspondencia: leitura.correspondencia,
      resolver_citacoes: leitura.resolverCitacoes,
      citacoes_da_norma: leitura.citacoesDaNorma,
      impacto_da_norma: leitura.impactoDaNorma,
      adequacao_art71: leitura.adequacaoArt71,
      buscar_secoes: leitura.buscarSecoes,
      ler_secao: leitura.lerSecao,
      listar_cursos: leitura.listarCursos,
      ficha_curso: leitura.fichaCurso,
      fatos_ppc: leitura.fatosPpc,
      sobre_a_base: leitura.sobreABase,
      etapa: leitura.etapa,
    });
  }),
);
