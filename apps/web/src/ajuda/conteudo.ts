/**
 * Os textos da Ajuda: as perguntas frequentes e o contato de quem mantém o app. As respostas repetem,
 * em poucas frases, o que o aviso de uso (`components/AvisoUso.tsx`) e Configurações já dizem.
 */

/** O e-mail de quem mantém o app. */
export const EMAIL_CONTATO = "gustavo.rahal@ifpr.edu.br";

export const URL_REPOSITORIO = "https://github.com/comunidade-ifpr/simplifica-if";
export const URL_COMO_CONTRIBUIR = `${URL_REPOSITORIO}/blob/main/CONTRIBUTING.md`;

/** O `mailto:` do contato, com o assunto já escrito. */
export function linkEmail(assunto: string): string {
  return `mailto:${EMAIL_CONTATO}?subject=${encodeURIComponent(`Simplifica IF: ${assunto}`)}`;
}

export interface Pergunta {
  readonly id: string;
  readonly pergunta: string;
  /** Um parágrafo por item. */
  readonly resposta: ReadonlyArray<string>;
}

export const PERGUNTAS: ReadonlyArray<Pergunta> = [
  {
    id: "custo",
    pergunta: "Preciso pagar para usar?",
    resposta: [
      "O Simplifica IF é gratuito e de código aberto. As conversas e as tarefas usam a IA da sua conta pessoal (Claude, ChatGPT ou Gemini), e o que essa conta permite depende do plano que você tem com a empresa da IA.",
      "O Explorar e a pré-conferência de “Revisar um PPC” funcionam sem IA.",
    ],
  },
  {
    id: "privacidade",
    pergunta: "O que sai do meu computador?",
    resposta: [
      "Seu perfil, suas conversas e as pastas das tarefas ficam só neste computador. Vai para a IA o que você escreve ou anexa e os arquivos da pasta da tarefa, e a empresa da IA pode guardar o que recebe.",
      "Por isso, não anexe dados pessoais (CPF, notas, laudos, endereço ou contato) nem documentos de acesso restrito.",
    ],
  },
  {
    id: "confianca",
    pergunta: "Posso confiar no que a IA responde?",
    resposta: [
      "A IA pode errar. As respostas citam a norma, o PPC ou o registro de onde a informação saiu, e cada citação grifada abre a fonte no trecho citado.",
      "Confira a fonte antes de usar a resposta num documento oficial. Se a resposta estiver errada, use “Isto está errado”, abaixo dela.",
    ],
  },
  {
    id: "base",
    pergunta: "De quando é a base?",
    resposta: [
      "A data da base aparece no Início, acima da pergunta. Em Configurações › Atualizações você vê a versão em uso e procura uma mais nova.",
    ],
  },
  {
    id: "falta",
    pergunta: "A norma ou o PPC que procuro não está na base. E agora?",
    resposta: [
      "A base ainda não tem tudo. Escreva dizendo o que falta, com o link da publicação oficial, se tiver: o documento entra numa próxima versão da base.",
    ],
  },
  {
    id: "arquivos",
    pergunta: "Onde ficam os arquivos das tarefas?",
    resposta: [
      "Cada tarefa tem uma pasta em Documentos/Simplifica IF, com os anexos e o que a IA produziu. Apagar uma conversa no app não apaga a pasta, a menos que você escolha mandá-la para a lixeira.",
    ],
  },
  {
    id: "independente",
    pergunta: "O Simplifica IF é do IFPR?",
    resposta: [
      "Por enquanto, não. É um projeto independente, para ajudar os colegas no trabalho do dia a dia. É mantido por Gustavo Rahal, servidor do IFPR, e outros colaboradores da instituição: não representa o IFPR nem é mantido oficialmente por ele. A base reúne normas e documentos públicos do IFPR e da legislação federal.",
      "Se o IFPR quiser adotar o Simplifica IF oficialmente, ficamos felizes em ajudar na adoção.",
    ],
  },
];
