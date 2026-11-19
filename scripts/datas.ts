/** Data local `AAAA-MM-DD` de um instante; quem chama tira o instante de `DateTime.now`. */
export function dataLocalIso(data: Date): string {
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${mes}-${dia}`;
}
