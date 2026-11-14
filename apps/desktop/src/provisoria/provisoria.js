// Página provisória: confere a ponte do preload e o servidor local (o ingresso comprado com o token).
const estado = document.getElementById("estado");
const ponte = window.simplifica;
if (!ponte) {
  estado.textContent = "Sem a ponte do desktop (window.simplifica).";
} else {
  ponte
    .conexao()
    .then(async ({ urlServidor, token }) => {
      const resposta = await fetch(`${urlServidor}/ingresso`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      estado.textContent = `Servidor local em ${urlServidor}: ingresso ${resposta.ok ? "aceito" : `recusado (${resposta.status})`}.`;
      document.title = resposta.ok ? "Simplifica IF: conectado" : "Simplifica IF: recusado";
    })
    .catch((erro) => {
      estado.textContent = `Falha na conexão: ${erro instanceof Error ? erro.message : String(erro)}`;
    });
}
