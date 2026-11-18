/**
 * Os canais da base: `meta.canal` do `kb.sqlite`, o envelope do simplifica-mcp e os manifestos da
 * atualização. `dev` é o banco compilado no checkout; `beta` e `estavel` são os de distribuição, os
 * únicos que têm manifesto. Módulo sem dependência, porque os contratos que a interface do app
 * importa o usam.
 */

/** Os canais de distribuição: os que têm manifesto de atualização. */
export const CANAIS_DISTRIBUICAO = ["beta", "estavel"] as const;
export type CanalDistribuicao = (typeof CANAIS_DISTRIBUICAO)[number];

export const CANAIS = ["dev", ...CANAIS_DISTRIBUICAO] as const;
export type Canal = (typeof CANAIS)[number];
