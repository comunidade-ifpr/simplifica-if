/**
 * Caminhos da skill revisar-ppc, resolvidos como em `common.py`: o diretório
 * da skill é o pai de `scripts/`, com symlinks resolvidos (assim o caminho é o
 * mesmo quando a skill é aberta por `.claude/skills`), e a raiz do projeto é o
 * primeiro ancestral que contém `base-conhecimento/`.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

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
  return NodeFS.existsSync(caminho) && NodeFS.statSync(caminho).isDirectory();
}

/** Caminhos de uma skill instalada em `appDir` (o diretório que contém `base-analise/`). */
export function caminhosDaSkill(appDir: string): CaminhosAnalise {
  const app = NodeFS.realpathSync(appDir);
  let raiz = NodePath.resolve(app, "../../..");
  for (let candidato = app; ; candidato = NodePath.dirname(candidato)) {
    if (ehDiretorio(NodePath.join(candidato, "base-conhecimento"))) {
      raiz = candidato;
      break;
    }
    if (NodePath.dirname(candidato) === candidato) break;
  }
  const baseConhecimentoDir = NodePath.join(raiz, "base-conhecimento");
  const baseAnaliseDir = NodePath.join(app, "base-analise");
  return {
    appDir: app,
    baseConhecimentoDir,
    manifestNormasPath: NodePath.join(baseConhecimentoDir, "manifest.json"),
    baseAnaliseDir,
    fichasDir: NodePath.join(baseAnaliseDir, "fichas"),
    topicosFichasPath: NodePath.join(baseAnaliseDir, "topicos-fichas.json"),
    marcosNormativosPath: NodePath.join(baseAnaliseDir, "marcos-normativos.json"),
    validacoesCruzadasDir: NodePath.join(baseAnaliseDir, "validacoes-cruzadas"),
    schemasDir: NodePath.join(baseAnaliseDir, "schemas"),
    contratosDir: NodePath.join(baseAnaliseDir, "contratos"),
    indicePath: NodePath.join(baseAnaliseDir, "indice.json"),
    mapaFichasPath: NodePath.join(baseAnaliseDir, "mapa-fichas.md"),
    promptsDir: NodePath.join(app, "prompts"),
    outputDir: NodePath.join(app, "output"),
  };
}

/** Caminhos desta skill (a que contém este arquivo). */
export function caminhosPadrao(): CaminhosAnalise {
  return caminhosDaSkill(NodePath.join(import.meta.dirname, ".."));
}
