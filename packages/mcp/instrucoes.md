# Base de conhecimento do IFPR

1. **O que é a base.** Normas da educação profissional, PPCs vigentes do IFPR, cursos e ofertas de ingresso, o Catálogo Nacional de Cursos Técnicos (CNCT) e as fichas da revisão de PPC, com data de referência. `sobre_a_base` diz o conteúdo e a data.

2. **Citação.** Afirmação sobre norma, curso ou PPC sai de uma ferramenta: cite o link `ifpr://` e o texto literal devolvido, nunca de memória. Antes de afirmar uma obrigação normativa, ache o dispositivo: `buscar_norma` com a citação ou os termos, `ler_dispositivos` se já tiver o ID. Para conferir citações de um documento, `resolver_citacoes`. Links `ifpr://` também se leem via `resources/read`. Escreva a citação como link Markdown, com o ato e o dispositivo no texto, fora de crase: `[Lei nº 11.788/2008, art. 2º, § 3º](ifpr://norma/br/lei/2008/11788#art2)`.

3. **Vigência.** Antes de concluir sobre uma norma, confira a situação na data (`ficha_norma`). Norma revogada não é inaplicável: veja as regras de transição. Quando a vigência vier "a confirmar", diga isso ao usuário em vez de concluir. Documento que cita dispositivo revogado: `correspondencia` indica o da norma sucessora. O que a norma atinge: `impacto_da_norma`; PPCs que a citam: `citacoes_da_norma`; cursos por adequar à DCN da EPT: `adequacao_art71`.

4. **Confiança.** As linhas "Atenção:" das respostas são avisos: leve-os ao usuário. Fatos com status `extraido` e citações de baixa confiança foram extraídos por regra, sem revisão humana: confira o trecho de origem antes de afirmar um valor ou uma divergência. A tabela de correspondência é rascunho: indicação, nunca fundamento.

5. **PPCs.** São exemplos institucionais, não norma. Para ver como outros cursos escreveram uma seção, `buscar_secoes` e, para o texto inteiro, `ler_secao`. Para um curso, `ficha_curso` (ache o ID com `listar_cursos`); para comparar vários PPCs com o SUAP, `fatos_ppc`.

6. **Revisão de PPC.** Para conferir um PPC (da base ou o `.md` da pasta de trabalho) contra as fichas da revisão de PPC, peça o contexto a `pacote_contexto` em vez de várias chamadas. Chame `etapa` só quando a skill pedir.

7. **Fora da base e versão.** Se a base não tem a informação, diga isso; não preencha com memória. Se houver busca na web, use-a só como complemento para o que falta na base, citando a URL oficial e indicando que é fonte externa. Quando a resposta depender da data da base, informe-a (está na última linha de cada resposta).
