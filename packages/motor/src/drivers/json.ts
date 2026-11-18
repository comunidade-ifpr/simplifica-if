/** Leitura tolerante das mensagens JSON dos providers: campo ausente ou de outro tipo vira vazio. */

export type Registro = Record<string, unknown>;

export const registro = (valor: unknown): Registro =>
  typeof valor === "object" && valor !== null ? (valor as Registro) : {};

export const texto = (valor: unknown): string => (typeof valor === "string" ? valor : "");
