/** Data local `AAAA-MM-DD` de um instante; quem chama tira o instante de `DateTime.now`. */
export function dataLocalIso(data: Date): string {
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${mes}-${dia}`;
}

/** Instante em São Paulo, com precisão de segundos e fuso explícito. */
export function agoraEmSaoPaulo(data: Date): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(data)
      .map((parte) => [parte.type, parte.value]),
  );
  const fuso = String(partes.timeZoneName).replace("GMT", "") || "+00:00";
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}:${partes.second}${fuso}`;
}
