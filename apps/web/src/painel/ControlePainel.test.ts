import { assert, describe, it } from "@effect/vitest";
import { linkAtual, podeVoltar } from "../leitor/historico.ts";
import { contextoParaConversar } from "./conversar.ts";
import {
  ControlePainel,
  MAXIMO_TRILHA,
  type FichaRascunho,
  MAXIMO_MARCADOS,
  type OrigemAoLado,
} from "./ControlePainel.ts";

describe("ControlePainel", () => {
  it("abre no link, anda pela trilha e avisa quem observa", () => {
    const painel = new ControlePainel();
    let avisos = 0;
    const parar = painel.observar(() => (avisos += 1));
    assert.isFalse(painel.obter().aberto);

    painel.abrirLink("ifpr://norma/a");
    painel.abrirLink("ifpr://norma/b");
    assert.isTrue(painel.obter().aberto);
    assert.strictEqual(linkAtual(painel.obter().historico), "ifpr://norma/b");
    painel.voltar();
    assert.strictEqual(linkAtual(painel.obter().historico), "ifpr://norma/a");
    painel.avancar();
    assert.strictEqual(linkAtual(painel.obter().historico), "ifpr://norma/b");
    assert.strictEqual(avisos, 4);

    // o mesmo link não muda nada nem avisa, mas conta como pedido do painel
    const pedidos = painel.pedidosFeitos();
    painel.abrirLink("ifpr://norma/b");
    assert.strictEqual(avisos, 4);
    assert.strictEqual(painel.pedidosFeitos(), pedidos + 1);
    parar();
    painel.voltar();
    assert.strictEqual(avisos, 4);
  });

  it("fechar recolhe sem esquecer a trilha", () => {
    const painel = new ControlePainel();
    painel.abrirLink("ifpr://norma/a");
    painel.fechar();
    assert.isFalse(painel.obter().aberto);
    painel.abrirLink("ifpr://norma/b");
    assert.isTrue(painel.obter().aberto);
    assert.isTrue(podeVoltar(painel.obter().historico));
  });

  it("a tela de trabalho vale enquanto está montada, e sair duas vezes não conta em dobro", () => {
    const painel = new ControlePainel();
    assert.isFalse(painel.emTelaDeTrabalho());
    const sair = painel.entrarEmTelaDeTrabalho();
    assert.isTrue(painel.emTelaDeTrabalho());
    sair();
    sair();
    assert.isFalse(painel.emTelaDeTrabalho());
  });

  it("esquecer os links de um documento que saiu: tira da trilha e recolhe se era o atual", () => {
    const painel = new ControlePainel();
    const apagado = (link: string) => link.startsWith("ifpr://revisao-ppc/x/");
    painel.abrirLink("ifpr://revisao-ppc/x/1");
    painel.abrirLink("ifpr://norma/a");
    painel.esquecerLinks(apagado);
    assert.isTrue(painel.obter().aberto);
    assert.deepStrictEqual(painel.obter().historico.links, ["ifpr://norma/a"]);
    assert.isFalse(podeVoltar(painel.obter().historico));

    painel.abrirLink("ifpr://revisao-ppc/x/1#p-2");
    painel.esquecerLinks(apagado);
    assert.isFalse(painel.obter().aberto);
    assert.strictEqual(linkAtual(painel.obter().historico), "ifpr://norma/a");
  });

  it("abas: um link abre o Ler; mostrar abre na aba, e ⌘\\ esconde e mostra onde estava", () => {
    const painel = new ControlePainel();
    painel.mostrar("pasta");
    assert.deepStrictEqual([painel.obter().aberto, painel.obter().aba], [true, "pasta"]);
    painel.alternar();
    assert.isFalse(painel.obter().aberto);
    painel.alternar();
    assert.deepStrictEqual([painel.obter().aberto, painel.obter().aba], [true, "pasta"]);
    painel.abrirLink("ifpr://norma/a");
    assert.strictEqual(painel.obter().aba, "ler");
  });

  it("documentos abertos e fixados: uma aba por documento, fixar mantém no início, desafixar não fecha e fechar passa à vizinha", () => {
    const painel = new ControlePainel();
    painel.abrirLink("ifpr://norma/a#art1");
    painel.abrirLink("ifpr://norma/a#art2");
    assert.deepStrictEqual(painel.obter().abertos, ["ifpr://norma/a#art2"]);

    painel.abrirLink("ifpr://norma/b");
    painel.abrirLink("ifpr://norma/c");
    assert.deepStrictEqual(painel.obter().abertos, ["ifpr://norma/a#art2", "ifpr://norma/b", "ifpr://norma/c"]);

    // fechar aba inativa não troca o documento atual
    painel.fecharDocumento("ifpr://norma/b");
    assert.deepStrictEqual(painel.obter().abertos, ["ifpr://norma/a#art2", "ifpr://norma/c"]);
    assert.strictEqual(linkAtual(painel.obter().historico), "ifpr://norma/c");

    // fechar a aba ativa passa à vizinha; fechar a última limpa o Ler
    painel.fecharDocumento("ifpr://norma/c");
    assert.strictEqual(linkAtual(painel.obter().historico), "ifpr://norma/a#art2");
    painel.fecharDocumento("ifpr://norma/a");
    assert.deepStrictEqual(painel.obter().abertos, []);
    assert.isUndefined(linkAtual(painel.obter().historico));

    // fixados: um por documento, até o máximo, desafixar mantém a aba aberta, e saem com o documento esquecido
    painel.marcar("ifpr://norma/a#art1");
    painel.marcar("ifpr://norma/a#art2");
    assert.deepStrictEqual(painel.obter().marcados, ["ifpr://norma/a#art2"]);
    for (let i = 1; i < MAXIMO_MARCADOS + 2; i++) painel.marcar(`ifpr://norma/n${i}`);
    assert.strictEqual(painel.obter().marcados.length, MAXIMO_MARCADOS);
    assert.notInclude(painel.obter().marcados, `ifpr://norma/n${MAXIMO_MARCADOS}`);
    // cheia, o mesmo documento ainda troca de lugar no trecho
    painel.marcar("ifpr://norma/a#art3");
    assert.include(painel.obter().marcados, "ifpr://norma/a#art3");
    painel.desmarcar("ifpr://norma/a");
    assert.notInclude(painel.obter().marcados, "ifpr://norma/a#art3");
    assert.include(painel.obter().abertos, "ifpr://norma/a#art3");
    painel.marcar("ifpr://revisao-ppc/x/1");
    painel.esquecerLinks((link) => link.startsWith("ifpr://revisao-ppc/x/"));
    assert.notInclude(painel.obter().marcados, "ifpr://revisao-ppc/x/1");
    assert.notInclude(painel.obter().abertos, "ifpr://revisao-ppc/x/1");

    // voltar e avançar mantêm o trecho da aba fixada sincronizado
    const nav = new ControlePainel();
    nav.abrirLink("ifpr://norma/a#art10");
    nav.marcar("ifpr://norma/a#art10");
    nav.abrirLink("ifpr://norma/a#art28");
    assert.deepStrictEqual(nav.obter().marcados, ["ifpr://norma/a#art28"]);
    nav.voltar();
    assert.deepStrictEqual(nav.obter().marcados, ["ifpr://norma/a#art10"]);
    nav.avancar();
    assert.deepStrictEqual(nav.obter().marcados, ["ifpr://norma/a#art28"]);

    // esquecer o documento atual garante que o documento para o qual o histórico recua esteja nas abas
    const recuo = new ControlePainel();
    recuo.abrirLink("ifpr://norma/a");
    recuo.abrirLink("ifpr://revisao-ppc/x/1");
    recuo.fecharDocumento("ifpr://norma/a");
    recuo.esquecerLinks((link) => link.startsWith("ifpr://revisao-ppc/x/"));
    assert.strictEqual(linkAtual(recuo.obter().historico), "ifpr://norma/a");
    assert.deepStrictEqual(recuo.obter().abertos, ["ifpr://norma/a"]);
  });

  it("o que volta ao reabrir: a trilha (só os últimos links), os marcados, a aba e a conversa já aberta", () => {
    const painel = new ControlePainel();
    for (let i = 0; i < MAXIMO_TRILHA + 5; i += 1) painel.abrirLink(`ifpr://norma/${i}`);
    painel.voltar();
    painel.marcar("ifpr://norma/3");
    painel.prender(true);
    painel.conversar({ texto: "rascunho" });
    let guardado = painel.paraGuardar();
    assert.strictEqual(guardado.trilha.links.length, MAXIMO_TRILHA);
    assert.strictEqual(guardado.trilha.links[0], "ifpr://norma/5");
    assert.strictEqual(guardado.trilha.links[guardado.trilha.posicao], `ifpr://norma/${MAXIMO_TRILHA + 3}`);
    assert.deepStrictEqual(guardado.marcados, ["ifpr://norma/3"]);
    assert.isTrue(guardado.preso);
    assert.strictEqual(guardado.aba, "conversar");
    // o rascunho (sem id) não volta
    assert.isUndefined(guardado.conversa);
    painel.enviada("c1", { texto: "rascunho", chaves: [] });
    painel.conversar({ origem: { chave: "revisao-ppc:1" }, conversa: "c1" });
    guardado = painel.paraGuardar();
    assert.deepStrictEqual(guardado.conversa, { id: "c1", origem: { chave: "revisao-ppc:1" } });

    const reaberto = new ControlePainel();
    reaberto.restaurar(guardado);
    assert.deepStrictEqual(reaberto.paraGuardar(), guardado);
    assert.strictEqual(reaberto.obter().conversa.texto, "");
  });

  it("esquecer o documento de outra aba não recolhe o painel", () => {
    const painel = new ControlePainel();
    painel.abrirLink("ifpr://revisao-ppc/x/1");
    painel.mostrar("pasta");
    painel.esquecerLinks((link) => link.startsWith("ifpr://revisao-ppc/x/"));
    assert.isTrue(painel.obter().aberto);
  });

  it("a conversa ao lado: uma por origem, as fichas sem repetir, o pedido sem origem na do painel, e a apagada", () => {
    const painel = new ControlePainel();
    const ficha = (chave: string): FichaRascunho => ({
      chave,
      rotulo: chave,
      tipo: "documento",
      tirar: `Tirar ${chave}`,
    });
    const origem = (chave: string): OrigemAoLado => ({ chave });

    painel.conversar({
      origem: origem("revisao-ppc:1"),
      fichas: [ficha("ppc"), ficha("p1")],
      ofertas: [ficha("docx")],
    });
    assert.deepInclude(painel.obter(), { aberto: true, aba: "conversar" });
    assert.isTrue(painel.obter().conversa.focar);
    painel.focou();
    assert.isUndefined(painel.obter().conversa.focar);
    painel.tirarFicha("ppc");
    painel.porOferta("docx");
    assert.deepStrictEqual(
      painel.obter().conversa.fichas.map((f) => f.chave),
      ["p1", "docx"],
    );
    assert.deepStrictEqual(painel.obter().conversa.ofertas, []);
    painel.escreverTexto("O que falta?");
    painel.enviada("c", { texto: "O que falta?", chaves: ["p1", "docx"] });
    assert.deepInclude(painel.obter().conversa, { id: "c", texto: "" });
    assert.deepStrictEqual(painel.obter().conversa.fichas, []);
    // O estado é só dado: a etapa 7 o guarda nas preferências.
    assert.deepStrictEqual(JSON.parse(JSON.stringify(painel.obter())), painel.obter());

    // A mesma origem retoma a conversa e acrescenta a ficha nova; o pedido sem origem vai à mesma.
    painel.conversar({ origem: origem("revisao-ppc:1"), fichas: [ficha("ppc"), ficha("p2")] });
    painel.conversar({ fichas: [ficha("trecho"), ficha("p2")] });
    assert.strictEqual(painel.obter().conversa.id, "c");
    assert.deepStrictEqual(
      painel.obter().conversa.fichas.map((f) => f.chave),
      ["ppc", "p2", "trecho"],
    );
    // Outra origem abre o rascunho dela, ou a conversa que ela já tinha.
    painel.conversar({ origem: origem("revisao-ppc:2"), conversa: "d", fichas: [ficha("ppc2")] });
    assert.deepInclude(painel.obter().conversa, { id: "d" });
    // A apagada sai da aba; a de outra conversa, não.
    painel.conversaApagada("c");
    assert.strictEqual(painel.obter().conversa.id, "d");
    painel.conversaApagada("d");
    assert.deepInclude(painel.obter().conversa, { apagada: true });
    assert.isUndefined(painel.obter().conversa.id);
  });

  it("a conversa apagada não prende o pedido seguinte, que abre o rascunho com as fichas dele", () => {
    const painel = new ControlePainel();
    const ficha = (chave: string): FichaRascunho => ({ chave, rotulo: chave, tipo: "trecho", tirar: `Tirar ${chave}` });
    painel.conversar({ fichas: [ficha("a")] });
    painel.enviada("c", { texto: "", chaves: ["a"] });
    painel.conversaApagada("c");
    assert.isTrue(painel.obter().conversa.apagada);
    painel.conversar({ fichas: [ficha("trecho")], texto: "E isto?" });
    const conversa = painel.obter().conversa;
    assert.isUndefined(conversa.apagada);
    assert.isUndefined(conversa.id);
    assert.deepStrictEqual(
      conversa.fichas.map((f) => f.chave),
      ["trecho"],
    );
    assert.strictEqual(conversa.texto, "E isto?");
  });

  it("a continuação com outra IA troca a conversa da aba, com a caixa que ela trouxe; a de outra conversa, não", () => {
    const painel = new ControlePainel();
    const ficha = (chave: string): FichaRascunho => ({ chave, rotulo: chave, tipo: "trecho", tirar: `Tirar ${chave}` });
    painel.conversar({ texto: "Oi" });
    painel.enviada("antiga", { texto: "Oi", chaves: [] });
    const geracao = painel.geracaoDaConversa();
    painel.continuada("outra", "nova", { texto: "E agora?", fichas: [ficha("historico")] });
    assert.strictEqual(painel.obter().conversa.id, "antiga");
    painel.continuada("antiga", "nova", { texto: "E agora?", fichas: [ficha("historico")] });
    const conversa = painel.obter().conversa;
    assert.strictEqual(conversa.id, "nova");
    assert.strictEqual(conversa.texto, "E agora?");
    assert.deepStrictEqual(
      conversa.fichas.map((f) => f.chave),
      ["historico"],
    );
    assert.notStrictEqual(painel.geracaoDaConversa(), geracao);

    // A conversa ao lado da revisão continua ao lado dela.
    painel.conversar({ origem: { chave: "revisao-ppc:1" }, conversa: "da-revisao" });
    painel.continuada("da-revisao", "continuacao", { texto: "", fichas: [] });
    assert.deepStrictEqual(painel.obter().conversa.origem, { chave: "revisao-ppc:1" });
  });

  it("o envio: só o que foi sai da caixa, o que falhou volta, e outra conversa no meio não é tocada", () => {
    const painel = new ControlePainel();
    const ficha = (chave: string): FichaRascunho => ({ chave, rotulo: chave, tipo: "trecho", tirar: `Tirar ${chave}` });
    painel.conversar({ origem: { chave: "revisao-ppc:1" }, fichas: [ficha("ppc"), ficha("p1")] });
    painel.escreverTexto("O que falta?");
    const geracao = painel.geracaoDaConversa();
    // Enquanto a mensagem se prepara, chega outra pendência e a pessoa começa outra pergunta.
    painel.conversar({ origem: { chave: "revisao-ppc:1" }, fichas: [ficha("p2")] });
    painel.escreverTexto("E a outra?");
    assert.strictEqual(painel.geracaoDaConversa(), geracao);
    painel.enviada("c", { texto: "O que falta?", chaves: ["ppc", "p1"] });
    assert.deepInclude(painel.obter().conversa, { id: "c", texto: "E a outra?" });
    assert.deepStrictEqual(
      painel.obter().conversa.fichas.map((f) => f.chave),
      ["p2"],
    );
    // A mensagem não saiu: o texto (se a pessoa não escreveu outro) e as fichas voltam, com o aviso de uso.
    painel.escreverTexto("");
    painel.devolver("O que falta?", [ficha("ppc"), ficha("p1")], true);
    assert.deepInclude(painel.obter().conversa, { texto: "O que falta?", avisoUso: true });
    assert.deepStrictEqual(
      painel.obter().conversa.fichas.map((f) => f.chave),
      ["ppc", "p1", "p2"],
    );
    painel.avisoDeUso(false);
    assert.isUndefined(painel.obter().conversa.avisoUso);
    // "Nova conversa" e outra origem mudam a geração: o envio em curso não mexe na caixa delas.
    painel.novaConversa();
    assert.notStrictEqual(painel.geracaoDaConversa(), geracao);
  });

  it("a origem esquecida (a revisão apagada): a conversa segue livre, sem as fichas dela; o rascunho sai", () => {
    const painel = new ControlePainel();
    const ppc: FichaRascunho = { chave: "ppc:1", rotulo: "PPC", tipo: "documento", tirar: "Tirar o PPC" };
    const trecho: FichaRascunho = {
      chave: "trecho",
      rotulo: "Trecho",
      tipo: "trecho",
      tirar: "Tirar o trecho",
      ficha: { _tag: "texto", rotulo: "Trecho", texto: "O estágio." },
    };
    painel.conversar({ origem: { chave: "revisao-ppc:1" }, conversa: "c", fichas: [ppc, trecho] });
    painel.esquecerOrigem("revisao-ppc:2");
    assert.deepInclude(painel.obter().conversa.origem, { chave: "revisao-ppc:1" });
    painel.esquecerOrigem("revisao-ppc:1");
    assert.isUndefined(painel.obter().conversa.origem);
    assert.strictEqual(painel.obter().conversa.id, "c");
    assert.deepStrictEqual(painel.obter().conversa.fichas, [trecho]);

    painel.novaConversa();
    painel.conversar({ origem: { chave: "revisao-ppc:3" }, fichas: [ppc] });
    painel.esquecerOrigem("revisao-ppc:3");
    assert.deepStrictEqual(painel.obter().conversa, { fichas: [], ofertas: [], texto: "" });
  });

  it("⤢ guarda de onde a conversa saiu, para 'Trazer de volta'", () => {
    const painel = new ControlePainel();
    painel.conversar({ conversa: "c", origem: { chave: "revisao-ppc:1" } });
    painel.levarATelaCheia("/revisao-ppc?id=1");
    assert.strictEqual(painel.obter().conversa.voltarPara, "/revisao-ppc?id=1");
  });

  it("o contexto da tela: o último declarado vale, e sai quando a tela sai", () => {
    const painel = new ControlePainel();
    assert.deepStrictEqual(painel.contextoDaTela(), {});
    const sair = painel.declararContexto(() => ({ texto: "a" }));
    const sairOutra = painel.declararContexto(() => ({ texto: "b" }));
    assert.deepStrictEqual(painel.contextoDaTela(), { texto: "b" });
    sairOutra();
    assert.deepStrictEqual(painel.contextoDaTela(), { texto: "a" });
    sair();
    assert.deepStrictEqual(painel.contextoDaTela(), {});
  });
  it("a continuação feita na tela cheia só troca o id: a conversa segue lá, com o 'Trazer de volta' de antes", () => {
    const painel = new ControlePainel();
    painel.conversar({ conversa: "c1", origem: { chave: "revisao-ppc:1" }, texto: "começada" });
    painel.levarATelaCheia("/revisao-ppc?id=1");
    painel.continuada("c1", "c2");
    assert.deepInclude(painel.obter().conversa, { id: "c2", voltarPara: "/revisao-ppc?id=1", texto: "começada" });
    assert.deepStrictEqual(painel.obter().conversa.origem, { chave: "revisao-ppc:1" });
  });

  it("a lista refeita com outro curso: a origem e os links do PPC seguem para ela, e os outros ficam", () => {
    const painel = new ControlePainel();
    painel.abrirLink("ifpr://norma/a");
    painel.abrirLink("ifpr://revisao-ppc/A/ppc#p-1");
    painel.marcar("ifpr://revisao-ppc/A/ppc#p-1");
    painel.conversar({ conversa: "c", origem: { chave: "revisao-ppc:A", ia: "codex" } });
    painel.trocarOrigem("revisao-ppc:B", "revisao-ppc:C");
    assert.deepStrictEqual(painel.obter().conversa.origem, { chave: "revisao-ppc:A", ia: "codex" });
    painel.trocarOrigem("revisao-ppc:A", "revisao-ppc:B");
    painel.trocarLinks("ifpr://revisao-ppc/A/", "ifpr://revisao-ppc/B/");
    assert.deepStrictEqual(painel.obter().conversa.origem, { chave: "revisao-ppc:B", ia: "codex" });
    assert.deepStrictEqual(painel.obter().historico, {
      links: ["ifpr://norma/a", "ifpr://revisao-ppc/B/ppc#p-1"],
      posicao: 1,
    });
    assert.deepStrictEqual(painel.obter().marcados, ["ifpr://revisao-ppc/B/ppc#p-1"]);
    // ⌘J com a revisão nova na tela vai à mesma conversa.
    painel.conversar({ origem: { chave: "revisao-ppc:B" } });
    assert.strictEqual(painel.obter().conversa.id, "c");
  });

  it("a aba Pasta na pasta pedida; a aba escolhida volta à de sempre", () => {
    const painel = new ControlePainel();
    painel.mostrarPasta("da-tela");
    assert.deepInclude(painel.obter(), { aberto: true, aba: "pasta", pastaDe: "da-tela" });
    painel.mostrar("pasta");
    assert.isUndefined(painel.obter().pastaDe);
    assert.isTrue(painel.obter().aberto);
  });

  it("o painel que a continuidade reabriu não é um gesto da pessoa, até ela pedir, abrir ou fechar o painel", () => {
    const painel = new ControlePainel();
    const guardado = {
      aberto: true,
      aba: "ler" as const,
      trilha: { links: [], posicao: -1 },
      marcados: [],
      preso: false,
    };
    painel.restaurar(guardado);
    assert.isTrue(painel.abertoPelaContinuidade());
    painel.voltar();
    assert.isTrue(painel.abertoPelaContinuidade());
    painel.abrirLink("ifpr://norma/a");
    assert.isFalse(painel.abertoPelaContinuidade());
    painel.restaurar({ ...guardado, aberto: false });
    painel.restaurar(guardado);
    assert.isTrue(painel.abertoPelaContinuidade());
    painel.fechar();
    painel.alternar();
    assert.isFalse(painel.abertoPelaContinuidade());
    const outro = new ControlePainel();
    outro.alternar();
    assert.isFalse(outro.abertoPelaContinuidade());
  });

  it("⌘J na revisão com o PPC no Ler em outra pendência: valem as fichas da tela, uma pendência só", () => {
    const painel = new ControlePainel();
    const ficha = (chave: string): FichaRascunho => ({ chave, rotulo: chave, tipo: "pendencia", tirar: chave });
    const origem = { chave: "revisao-ppc:1" };
    painel.declararContexto(() => ({ origem, fichas: [ficha("ppc:1"), ficha("pendencia:A")] }));
    painel.abrirLink("ifpr://revisao-ppc/1/ppc#p-B");
    const pedido = contextoParaConversar({
      painel,
      pedidoDoLink: () => ({ origem, fichas: [ficha("ppc:1"), ficha("pendencia:B")] }),
    });
    assert.deepStrictEqual(
      pedido.fichas?.map((f) => f.chave),
      ["ppc:1", "pendencia:A"],
    );
    // Um documento da base no Ler entra junto.
    painel.abrirLink("ifpr://norma/a");
    const comNorma = contextoParaConversar({ painel, pedidoDoLink: () => undefined });
    assert.deepStrictEqual(
      comNorma.fichas?.map((f) => f.chave),
      ["ppc:1", "pendencia:A", "link:ifpr://norma/a"],
    );
  });
});
