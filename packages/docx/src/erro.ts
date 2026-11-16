// @effect-diagnostics extendsNativeError:off -- leitura síncrona, fora de Effect: o DOCX inválido é sinalizado por exceção
/** Arquivo que não é um DOCX legível: não é ZIP, está corrompido, protegido ou passa dos limites. */
export class ErroDocx extends Error {}
