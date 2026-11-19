// @effect-diagnostics nodeBuiltinImport:off -- a raiz do projeto é constante de módulo, lida também pelas validações síncronas da base
import * as NodePath from "node:path";

export const RAIZ_PROJETO = NodePath.resolve(import.meta.dirname, "..");
export const RAIZ_BASE = NodePath.join(RAIZ_PROJETO, "base-conhecimento");
