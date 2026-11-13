/**
 * Caminhos da skill analise-ppc, resolvidos como em `common.py`: o diretório
 * da skill é o pai de `scripts/`, com symlinks resolvidos (assim o caminho é o
 * mesmo quando a skill é aberta por `.claude/skills`), e a raiz do projeto é o
 * primeiro ancestral que contém `base-conhecimento/`.
 */
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export type CaminhosAnalise = {
  appDir: string;
  baseConhecimentoDir: string;
  manifestNormasPath: string;
  baseAnaliseDir: string;
  fichasDir: string;
  topicosFichasPath: string;
  marcosNormativosPath: string;
  validacoesCruzadasDir: string;
  schemasDir: string;
  contratosDir: string;
  indicePath: string;
  mapaFichasPath: string;
  promptsDir: string;
  outputDir: string;
};

function ehDiretorio(caminho: string): boolean {
  return existsSync(caminho) && statSync(caminho).isDirectory();
}

/** Caminhos de uma skill instalada em `appDir` (o diretório que contém `base-analise/`). */
export function caminhosDaSkill(appDir: string): CaminhosAnalise {
  const app = realpathSync(appDir);
  let raiz = path.resolve(app, "../../..");
  for (let candidato = app; ; candidato = path.dirname(candidato)) {
    if (ehDiretorio(path.join(candidato, "base-conhecimento"))) {
      raiz = candidato;
      break;
    }
    if (path.dirname(candidato) === candidato) break;
  }
  const baseConhecimentoDir = path.join(raiz, "base-conhecimento");
  const baseAnaliseDir = path.join(app, "base-analise");
  return {
    appDir: app,
    baseConhecimentoDir,
    manifestNormasPath: path.join(baseConhecimentoDir, "manifest.json"),
    baseAnaliseDir,
    fichasDir: path.join(baseAnaliseDir, "fichas"),
    topicosFichasPath: path.join(baseAnaliseDir, "topicos-fichas.json"),
    marcosNormativosPath: path.join(baseAnaliseDir, "marcos-normativos.json"),
    validacoesCruzadasDir: path.join(baseAnaliseDir, "validacoes-cruzadas"),
    schemasDir: path.join(baseAnaliseDir, "schemas"),
    contratosDir: path.join(baseAnaliseDir, "contratos"),
    indicePath: path.join(baseAnaliseDir, "indice.json"),
    mapaFichasPath: path.join(baseAnaliseDir, "mapa-fichas.md"),
    promptsDir: path.join(app, "prompts"),
    outputDir: path.join(app, "output"),
  };
}

/** Caminhos desta skill (a que contém este arquivo). */
export function caminhosPadrao(): CaminhosAnalise {
  return caminhosDaSkill(path.join(import.meta.dir, ".."));
}
