import { describe, expect, it } from "vite-plus/test";
import { dominioDoLink } from "./abrir.ts";

describe("destino de uma tarefa de link", () => {
  it.each([
    ["https://suap.ifpr.edu.br/accounts/login/?next=/", "suap.ifpr.edu.br"],
    // A porta faz parte do destino: a pessoa vê aonde vai.
    ["https://suap.ifpr.edu.br:8443/x", "suap.ifpr.edu.br:8443"],
    ["https://www.ifpr.edu.br/", "ifpr.edu.br"],
    ["https://www.example.org:8443/x", "example.org:8443"],
    // Sem o `www.` não sobraria um domínio.
    ["https://www.com/", "www.com"],
    ["https://www.com:8443/", "www.com:8443"],
    ["https://wwwx.example.org/", "wwwx.example.org"],
    ["não é URL", "não é URL"],
  ])("%s → %s", (url, destino) => {
    expect(dominioDoLink(url)).toBe(destino);
  });
});
