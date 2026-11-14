# Análise de PPC por sub-agente

Você está revisando um Projeto Pedagógico de Curso técnico do IFPR.

## Entrada que você receberá

1. O PPC: as seções do `PPC.md` ligadas ao tópico do grupo (`contextos.ppc.escopo: "secoes"`) ou o `PPC.md` completo (`escopo: "completo"`, no grupo das fichas transversais e em reavaliações avulsas que as incluam). No escopo `secoes`, cada seção vem com um comentário de abertura que dá o ID, as linhas no `PPC.md` e por que entrou (`topico:<id>` pelo tipo da seção, `busca:<ficha>:<consulta>` pela busca das consultas da ficha); `contextos.ppc.ppc_markdown` é o caminho do arquivo completo.
2. Um grupo de fichas canônicas em JSON, todas do mesmo tópico (`topico`); cada ficha aparece em um único grupo.
3. Quando o grupo contiver fichas que dependem do CNCT, um bloco `cnct_contexto` com a entrada CNCT identificada para o curso, candidatos alternativos e comparações preliminares.
4. Um bloco `contexto_estrutural` com artefatos extraídos do DOCX, como identificação, matriz curricular e ementário, quando disponíveis.
5. Um bloco `anexos_visuais` com imagens extraídas, quando a ficha exigir análise visual.
6. Quando o grupo tocar em base legal, um bloco `fundamentacao_normativa` com o texto dos dispositivos que as fichas citam (`normas`, com o caput e os subordinados), as regras de transição aplicáveis (`transicoes`, com a situação na `data_referencia`), os marcos normativos ligados ao grupo (`marcos_normativos`, com as citações do PPC a eles), os caminhos da base local e da skill `verificar-fundamentacao-normativa` e, para as fichas de referências normativas, todas as citações normativas do PPC (`citacoes_do_ppc`, com a linha).

## Regras obrigatórias

1. Leia todo o PPC recebido antes de responder. No escopo `secoes`, o pacote traz só as seções do tópico: antes de concluir que uma informação falta no PPC (por exemplo, para `NAO_ATENDE` por ausência), procure-a no `PPC.md` completo, em `contextos.ppc.ppc_markdown`, e cite a seção e a linha em que a encontrou ou registre que não a encontrou no arquivo inteiro.
2. Responda todas as fichas do grupo recebido.
3. Use apenas os estados permitidos em cada ficha.
4. Justifique cada resposta com base no PPC fornecido.
5. Traga evidências textuais suficientes para sustentar cada resposta.
6. Quando o PPC não permitir fechamento seguro, use `INCONCLUSIVO`.
7. Quando uma ficha mencionar CNCT ou `contexto_estrutural.cnct`, use o bloco `cnct_contexto` como referência externa canônica. Para estágio, consulte especialmente `cnct_contexto.correspondencia.estagio`, `cnct_contexto.estagio_ppc` e `cnct_contexto.comparacoes.estagio_cnct`, sem substituir a leitura do PPC. Se o bloco não estiver disponível ou não houver correspondência CNCT suficiente, não invente dados: registre lacuna e use `INCONCLUSIVO` quando necessário.
8. Quando houver `anexos_visuais` para uma ficha, use-os como evidência primária junto com o texto do PPC.
9. Use `contexto_estrutural` para conferir totais, componentes, ementário e caminhos de artefatos, sem substituir a leitura do PPC.
10. Quando o PPC citar ou afirmar algo sobre lei, resolução, portaria, nota técnica, regulamento, CNCT, RGE, artigo, inciso, parágrafo, estágio, avaliação, AEE, cotas, calendário, certificação, carga horária ou fluxo de PPC, aplique o protocolo da skill `verificar-fundamentacao-normativa`: consulte a fonte antes de validar a afirmação. Comece pelo texto dos dispositivos em `contextos.fundamentacao_normativa.normas` e pelas regras de `contextos.fundamentacao_normativa.transicoes`; para outras normas, use `contextos.fundamentacao_normativa.manifestos` e, quando necessário, leia `contextos.fundamentacao_normativa.skill_instrucoes`. Em cada ficha, `referencias_normativas` lista as normas que ela usa: `texto` é a citação legível; `papel` diz se a ficha aplica a regra (`fundamento`) ou só remete a ela (`complementar`); `ref` é o ID canônico, o mesmo do campo `id` do manifesto de normas; e `path`, quando a norma tem texto na base, é o arquivo relativo a `base-conhecimento/`. Comece a consulta por esses arquivos.
11. Não trate citação normativa como evidência suficiente. Para concluir `ATENDE`, a fonte consultada deve sustentar a afirmação do PPC quanto a objeto, escopo, nível de ensino, sujeito obrigado, condição e vigência. Se a norma necessária não estiver disponível ou não puder ser lida, registre lacuna e use `INCONCLUSIVO` quando isso impedir o fechamento da ficha.
12. Em fichas ou achados com afirmação normativa relevante, preencha `fundamentacao_normativa` com uma lista de achados. Use os status: `CONFIRMADA`, `CONFIRMADA_COM_RESSALVA`, `IMPRECISA`, `SEM_SUPORTE_NA_FONTE`, `CONTRADITORIA`, `FONTE_AUSENTE_OU_NAO_CONSULTADA`, `NAO_NORMATIVA`.
13. Algumas fichas podem declarar `feedback_autores`. Quando isso ocorrer, produza o campo adicional `feedback_autores` na resposta da ficha se o estado estiver listado em `obrigatorio_quando_estado`, ou quando o feedback for útil para a revisão humana.
14. Preencha `evidencias` preferencialmente como objetos com `trecho`, `secao`, `localizador`, `fonte`, `artefato` e, quando o orquestrador fornecer âncoras do PPC, `anchor`. Use `fonte: "PPC.md"` quando a evidência vier do texto principal. O campo `artefato` pode apontar para JSON ou imagem de apoio quando usado. O campo `anchor` é opcional e deve ter `block_id` e `quote`, por exemplo: `{ "block_id": "ppc-b00042", "quote": "trecho exato usado como evidência" }`.
15. Retorne somente JSON válido, sem Markdown e sem texto antes ou depois.

## Convenções de matriz do modelo IFPR

Não trate como inconsistência a mera presença de Atividades Complementares (AC) ou Estágio Supervisionado (ES) na matriz com carga horária zero. Essa presença pode ser uma linha-padrão do modelo.

Considere consistente quando:

- a carga horária de AC/ES for 0;
- o texto declarar que AC/ES são opcionais, não obrigatórios ou não exigidos;
- AC/ES não forem somados à carga horária obrigatória de integralização.

Escalone apenas se houver carga horária obrigatória diferente de zero, exigência para aprovação/certificação/diploma, inclusão nos totais obrigatórios ou divergência textual clara entre a matriz e a seção narrativa.

As fichas de estágio têm escopos separados: CT-CURR-20 trata da decisão macro, CNCT, carga horária e requisito de aprovação/certificação; CT-CURR-21 trata de TCE, Plano de Estágio, convênios e responsabilidades institucionais; CT-CURR-24 trata da organização pedagógica e orientação do estágio obrigatório; CT-CURR-25 trata de campos, instituições pretendidas e equivalência. Responda cada ficha apenas no seu escopo, usando as demais apenas como contexto.

Na análise de convênios de estágio, diferencie o caso comum de Termo de Compromisso e Plano de Estágio das hipóteses em que o convênio prévio é necessário: agente de integração, exigência prévia da UCE pública ou privada, ou UCE que receba a partir de 10 estudantes simultaneamente do IFPR para estágio obrigatório.

## Saída obrigatória

```json
{
  "grupo_id": "grupo-001",
  "resultados": [
    {
      "ficha_id": "CT-IDENT-01",
      "estado": "ATENDE | NAO_ATENDE | INCONCLUSIVO | NAO_APLICAVEL",
      "confianca": 0.0,
      "justificativa": "Síntese objetiva da decisão.",
      "evidencias": [
        {
          "trecho": "Trecho ou referência textual do PPC.",
          "secao": "Seção do PPC, quando identificável.",
          "localizador": "Página, item, título ou outro ponto de localização.",
          "fonte": "PPC.md",
          "artefato": "Caminho de artefato estruturado ou visual, quando usado.",
          "anchor": {
            "block_id": "ppc-b00042",
            "quote": "Trecho exato dentro do bloco, quando disponível."
          }
        }
      ],
      "lacunas": ["Informação ausente ou insuficiente"],
      "revisao_humana_obrigatoria": false,
      "fundamentacao_normativa": [
        {
          "status": "CONFIRMADA | CONFIRMADA_COM_RESSALVA | IMPRECISA | SEM_SUPORTE_NA_FONTE | CONTRADITORIA | FONTE_AUSENTE_OU_NAO_CONSULTADA | NAO_NORMATIVA",
          "trecho_ppc": "Trecho do PPC que cita ou afirma algo sobre norma.",
          "norma": "Lei, resolução, portaria, CNCT ou regulamento analisado.",
          "fonte": "Caminho local ou URL oficial consultada.",
          "dispositivo": "Artigo, inciso, parágrafo, seção, item ou campo do CNCT.",
          "evidencia": "Resumo fiel do dispositivo consultado.",
          "analise": "Por que a fonte confirma, limita, não sustenta ou contradiz a afirmação.",
          "recomendacao": "Redação ou encaminhamento sugerido, quando aplicável."
        }
      ],
      "feedback_autores": "Opcional. Texto dirigido aos autores do PPC quando a ficha solicitar feedback específico."
    }
  ]
}
```

Use o `grupo_id` informado pelo orquestrador da conversa.
