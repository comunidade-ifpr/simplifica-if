#!/usr/bin/env python3
"""Converte para Markdown os PPCs referenciados nos registros de cursos.

Lê `base-conhecimento/institucional/ifpr/cursos/<campus_id>/<curso_slug>.json` (`ppc.url` e
`ppc.markdown_path`) e grava o Markdown em `base-conhecimento/<ppc.markdown_path>`. O registro do curso
não é alterado: um PPC conta como convertido quando o Markdown existe. As falhas ficam em
`tmp/conversao-ppcs-erros.json` (fora da base) e só são tentadas de novo com `--retry-errors`.
CPF, RG, celular, matrícula de estudante e SIAPE saem como marcadores neutros (`omitir_dados_pessoais`, a mesma
regra de `packages/kb/src/ppcs/dados-pessoais.ts`).

Cada Markdown sai com o front matter de proveniência (`proveniencia: registrada`): URL de origem,
SHA-256 dos bytes baixados, data da conversão e versão do conversor. O contrato do front matter é
`packages/kb/src/ppcs/front-matter.ts`; a base guarda só o PPC vigente, e versões anteriores ficam
no histórico do git.

Dependência opcional:
    uv venv
    uv pip install -r requirements-ppc.txt
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import re
import tempfile
from http.client import IncompleteRead
from pathlib import Path
from urllib.parse import quote, unquote, urlparse, urlsplit, urlunsplit
from urllib.request import Request, urlopen


# Raiz lógica da base pública: os markdown_path dos campi são relativos a ela.
ROOT = Path(__file__).resolve().parents[1] / "base-conhecimento"
INSTITUCIONAL_ROOT = ROOT / "institucional"
USER_AGENT = "simplifica-if-ppc-converter/1.0"


def google_drive_download_url(url: str) -> str:
    match = re.search(r"/file/d/([^/]+)/", url)
    if not match:
        return url
    return f"https://drive.google.com/uc?export=download&id={match.group(1)}"


def normalize_url(url: str) -> str:
    parts = urlsplit(url)
    path = quote(unquote(parts.path), safe="/:%")
    query = quote(unquote(parts.query), safe="=&?/:+,%")
    return urlunsplit((parts.scheme, parts.netloc, path, query, parts.fragment))


def suffix_for_url(url: str, content_type: str | None) -> str:
    parsed = urlparse(url)
    path = unquote(parsed.path)
    suffix = Path(path).suffix
    if suffix:
        return suffix
    if content_type and "pdf" in content_type.lower():
        return ".pdf"
    return ".bin"


def download_source(url: str, tmpdir: Path) -> tuple[Path, str]:
    source_url = normalize_url(google_drive_download_url(url))
    request = Request(source_url, headers={"User-Agent": USER_AGENT})
    content = b""
    suffix = ".bin"
    last_error: Exception | None = None
    for _attempt in range(3):
        try:
            with urlopen(request, timeout=60) as response:
                content = response.read()
                suffix = suffix_for_url(response.geturl(), response.headers.get("Content-Type"))
            break
        except IncompleteRead as exc:
            last_error = exc
    else:
        if last_error is not None:
            raise last_error
    source_path = tmpdir / f"ppc{suffix}"
    source_path.write_bytes(content)
    return source_path, hashlib.sha256(content).hexdigest()


def extracted_text_is_weak(markdown: str) -> bool:
    markdown = re.sub(r"\*\*==> picture \[[^\]]+\] intentionally omitted <==\*\*", "", markdown)
    text = re.sub(r"\s+", "", markdown)
    return len(text) < 500


def convert_file(source_path: Path, force_ocr: bool = False) -> tuple[str, str]:
    """Markdown convertido e a descrição do conversor (versões e uso de OCR)."""
    try:
        import pymupdf
        import pymupdf4llm
    except ImportError as exc:
        raise SystemExit("Instale as dependências opcionais com: uv venv && uv pip install -r requirements-ppc.txt") from exc

    def conversor(ocr: str) -> str:
        versao_llm = getattr(pymupdf4llm, "__version__", "?")
        versao_pdf = getattr(pymupdf, "__version__", None) or getattr(pymupdf, "VersionBind", "?")
        versoes = f"pymupdf4llm {versao_llm}; pymupdf {versao_pdf}"
        return f"scripts/converter_ppcs_markdown.py; {versoes}; ocr {ocr}"

    if force_ocr:
        return pymupdf4llm.to_markdown(str(source_path), force_ocr=True, use_ocr=True), conversor("forcado")

    markdown = pymupdf4llm.to_markdown(str(source_path), use_ocr=False)
    if extracted_text_is_weak(markdown):
        return pymupdf4llm.to_markdown(str(source_path), use_ocr=True), conversor("automatico")
    return markdown, conversor("nao")


ESCALAR_SIMPLES = re.compile(r"^[^\W_][\w.\/:@%?=&+-]*$")


def escalar_yaml(valor: str) -> str:
    """Como `serializarFrontMatterPpc` (TypeScript): aspas só quando o YAML simples mudaria o valor."""
    if ESCALAR_SIMPLES.match(valor) and ": " not in valor:
        return valor
    return json.dumps(valor, ensure_ascii=False)


def front_matter_proveniencia(markdown_path: str, url: str, sha256: str, conversor: str, data: str) -> str:
    """Front matter de proveniência registrada, na ordem de `CAMPOS_PROVENIENCIA`."""
    campus_id, curso_slug = Path(markdown_path).with_suffix("").parts[-2:]
    campos = [
        ("id", f"ppc:{campus_id}/{curso_slug}"),
        ("fonte_url", url),
        ("fonte_sha256", sha256),
        ("convertido_em", data),
        ("conversor", conversor),
        ("proveniencia", "registrada"),
    ]
    return "---\n" + "".join(f"{campo}: {escalar_yaml(valor)}\n" for campo, valor in campos) + "---\n"


def iter_curso_paths(campus_filter: str | None) -> list[Path]:
    cursos_root = INSTITUCIONAL_ROOT / "ifpr" / "cursos"
    pastas = [cursos_root / campus_filter] if campus_filter else sorted(p for p in cursos_root.iterdir() if p.is_dir())
    return [path for pasta in pastas if pasta.is_dir() for path in sorted(pasta.glob("*.json"))]


# Mesma regra de packages/kb/src/ppcs/dados-pessoais.ts; os casos de packages/kb/src/ppcs/dados-pessoais.casos.json
# valem para as duas (dados-pessoais.test.ts). Letra = [^\W\d_] (o \p{L} do JavaScript).
MARCADORES = {
    "cpf": "[CPF omitido]",
    "rg": "[RG omitido]",
    "telefone": "[telefone omitido]",
    "matricula": "[matrícula omitida]",
    "siape": "[SIAPE omitido]",
}
_INICIO = r"(?<![^\W_])"  # não precedido de letra ou dígito
_FIM = r"(?![^\W\d_])"  # não seguido de letra
_SEPARADOR = r"(?:[\s*_:|]|<br\s*/?>|n\.?\s?[º°o]\.?(?![^\W\d_])|n[º°]|número)*"
_NUMERO_CPF = r"\d{3}[.\s]?\d{3}[.\s]?\d{3}\s?[-–.]?\s?\d{2}(?!\d)"
_NUMERO_RG = r"(?:[A-Z]{2}[-\s]?)?(?:\d{1,3}(?:[.\s]\d{3}){1,3}|\d{4,13})(?:\s?[-–]\s?[\dXx])?(?!\d)"
_ROTULO_RG = r"(?:RG|R\.G\.?|Registro\s+Geral|(?:c[ée]dula|carteira|doc(?:umento)?\.?)\s+de\s+identidade|identidade(?=\s*:))"
_RE_RG_CPF = re.compile(
    rf"({_INICIO}(RG|CPF)\s*(?:/|e)\s*(?:RG|CPF){_FIM}{_SEPARADOR})({_NUMERO_RG}|{_NUMERO_CPF})(\s*(?:/|,|e)\s*)({_NUMERO_CPF}|{_NUMERO_RG})",
    re.IGNORECASE,
)
_RE_CPF_ROTULADO = re.compile(rf"({_INICIO}CPF{_FIM}{_SEPARADOR})({_NUMERO_CPF})", re.IGNORECASE)
_RE_RG_ROTULADO = re.compile(rf"({_INICIO}{_ROTULO_RG}{_FIM}{_SEPARADOR})({_NUMERO_RG})", re.IGNORECASE)
_RE_CPF_FORMATADO = re.compile(r"(?<![\d.])(\d{3})\.(\d{3})\.(\d{3})-(\d{2})(?!\d)")
_RE_CELULAR = re.compile(
    r"(?<![\d/.,])(?:(?:\+55\s?)?(?:\(0?\d{2}\)\s?|0?\d{2}[\s.-])9\s?\d{4}[\s.-]?\d{4}|9\d{4}[\s-]\d{4}|9\s\d{4}[\s-]\d{4})(?!\d)"
)
_RE_MATRICULA = re.compile(r"(?<![\d/])(?<!\d<br>)20[0-2]\d{8}(?!\d)")
_RE_SIAPE_ROTULADO = re.compile(
    rf"({_INICIO}SIAPE{_FIM}(?:[\s*_:|.\-–]|<br\s*/?>|n\.?\s?[º°o]\.?(?![^\W\d_])|n[º°])*)(\d{{4,8}})(?!\d)",
    re.IGNORECASE,
)
_RE_AUTOR_ANTES = re.compile(r"[A-ZÀ-Ý]{2,},\s*(?:[A-Z]\.\s?)*$")
_RE_CELULA_SIAPE = re.compile(r"^[\s*_]*\d{4,8}(?:[\s*_]*(?:<br\s*/?>|,|/)[\s*_]*\d{4,8})*[\s*_]*$")


def _digitos(texto: str) -> int:
    return len(re.sub(r"\D", "", texto))


def cpf_valido(numero: str) -> bool:
    if not re.fullmatch(r"\d{11}", numero) or len(set(numero)) == 1:
        return False
    numeros = [int(c) for c in numero]
    for tamanho in (9, 10):
        soma = sum(numeros[i] * (tamanho + 1 - i) for i in range(tamanho))
        if (soma * 10) % 11 % 10 != numeros[tamanho]:
            return False
    return True


def _rg_valido(numero: str, texto: str, inicio: int) -> bool:
    return _digitos(numero) >= 5 and not _RE_AUTOR_ANTES.search(texto[max(0, inicio - 60) : inicio])


def _marcador_do_rotulo(rotulo: str) -> str:
    return MARCADORES["cpf"] if rotulo.upper() == "CPF" else MARCADORES["rg"]


def _celulas(linha: str) -> list[str] | None:
    aparada = linha.strip()
    if not aparada.startswith("|"):
        return None
    return re.sub(r"\|$", "", re.sub(r"^\|", "", aparada)).split("|")


def _colunas_siape(texto: str, contagem: dict[str, int]) -> str:
    linhas = texto.split("\n")
    colunas: list[int] = []
    for i, linha in enumerate(linhas):
        partes = _celulas(linha)
        if partes is None:
            colunas = []
            continue
        com_siape = [indice for indice, celula in enumerate(partes) if re.search("SIAPE", celula, re.IGNORECASE)]
        if com_siape:
            colunas = com_siape
            continue
        if not colunas:
            continue
        novas = []
        mudou = False
        for indice, celula in enumerate(partes):
            if indice in colunas and _RE_CELULA_SIAPE.match(celula):
                mudou = True
                contagem["siape"] += len(re.findall(r"\d{4,8}", celula))
                celula = re.sub(r"\d{4,8}", MARCADORES["siape"], celula)
            novas.append(celula)
        if mudou:
            linhas[i] = linha.replace("|".join(partes), "|".join(novas), 1)
    return "\n".join(linhas)


def aplicar_omissao(texto: str) -> tuple[str, dict[str, int]]:
    """Troca CPF, RG, celular, matrícula de estudante e SIAPE por marcadores neutros (veja AGENTS.md)."""
    contagem = {categoria: 0 for categoria in MARCADORES}

    def rg_cpf(m: re.Match[str]) -> str:
        rotulo, primeiro, a, meio, b = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        if _digitos(a) < 5 or _digitos(b) < 5 or not _rg_valido(a, m.string, m.start()):
            return m.group(0)
        segundo = "RG" if primeiro.upper() == "CPF" else "CPF"
        contagem["cpf"] += 1
        contagem["rg"] += 1
        return f"{rotulo}{_marcador_do_rotulo(primeiro)}{meio}{_marcador_do_rotulo(segundo)}"

    def cpf(m: re.Match[str]) -> str:
        contagem["cpf"] += 1
        return m.group(1) + MARCADORES["cpf"]

    def rg(m: re.Match[str]) -> str:
        if not _rg_valido(m.group(2), m.string, m.start()):
            return m.group(0)
        contagem["rg"] += 1
        return m.group(1) + MARCADORES["rg"]

    def cpf_formatado(m: re.Match[str]) -> str:
        if not cpf_valido("".join(m.groups())):
            return m.group(0)
        contagem["cpf"] += 1
        return MARCADORES["cpf"]

    def siape(m: re.Match[str]) -> str:
        contagem["siape"] += 1
        return m.group(1) + MARCADORES["siape"]

    def contar(categoria: str):
        def trocar(_: re.Match[str]) -> str:
            contagem[categoria] += 1
            return MARCADORES[categoria]

        return trocar

    texto = _RE_RG_CPF.sub(rg_cpf, texto)
    texto = _RE_CPF_ROTULADO.sub(cpf, texto)
    texto = _RE_RG_ROTULADO.sub(rg, texto)
    texto = _RE_CPF_FORMATADO.sub(cpf_formatado, texto)
    texto = _RE_SIAPE_ROTULADO.sub(siape, texto)
    texto = _colunas_siape(texto, contagem)
    texto = _RE_MATRICULA.sub(contar("matricula"), texto)
    texto = _RE_CELULAR.sub(contar("telefone"), texto)
    return texto, contagem


def omitir_dados_pessoais(texto: str) -> str:
    return aplicar_omissao(texto)[0]


# Mesma limpeza de scripts/dados/urls.ts (semPlanilhasGoogle, semSessaoSei); urls.test.ts confere as duas.
_RE_PLANILHA_GOOGLE = re.compile(r"https?://docs\.google\.com/spreadsheets/[^\s\"'<>)\]]*", re.IGNORECASE)
_RE_URL_SESSAO_SEI = re.compile(r"https?://[^\s\"'<>)\]|]*infra_hash=[\w%-]*", re.IGNORECASE)
_RE_HASH_SOLTO = re.compile(r"[?&]?\s?infra_hash\s?=\s?[0-9a-f]{8,}(?: [0-9a-f]{4,})?", re.IGNORECASE)
_RE_PARAMETRO_SESSAO = re.compile(r"[?&]infra_(?:hash|sistema|unidade_atual)=[\w%-]*", re.IGNORECASE)


def _sem_sessao(m: re.Match[str]) -> str:
    limpa = _RE_PARAMETRO_SESSAO.sub("", m.group(0))
    return limpa if "?" in limpa else limpa.replace("&", "?", 1)


def limpar_urls(texto: str) -> str:
    """Tira link de planilha do Google (fica o texto) e os parâmetros de sessão do SEI (infra_hash)."""
    texto = _RE_PLANILHA_GOOGLE.sub("planilha interna (link omitido)", texto)
    return _RE_HASH_SOLTO.sub("", _RE_URL_SESSAO_SEI.sub(_sem_sessao, texto))


def sanitize_markdown(markdown: str) -> str:
    markdown = markdown.replace("\x00", "")
    local_file_scheme = "file:" + "//"
    markdown = re.sub(r"<?" + re.escape(local_file_scheme) + r"[^)\]\s>]+>?", "", markdown)
    markdown = post_process_markdown(markdown)
    return markdown


def post_process_markdown(markdown: str) -> str:
    """Remove artefatos recorrentes do conversor preservando texto OCR útil.

    O PyMuPDF4LLM marca imagens omitidas e pode envolver o texto extraído por OCR
    em blocos "Start/End of picture text". O texto desses blocos às vezes contém
    matrizes, quadros e formulários importantes, então removemos só os marcadores.
    """

    markdown = re.sub(
        r"^[ \t]*(?:\*\*)?\d{1,4}(?:\*\*)?[ \t]*\n"
        r"(?:[ \t]*\n)?"
        r"[ \t]*\*\*==> picture \[[0-9]+ x [0-9]+\] intentionally omitted <==\*\*[ \t]*\n",
        "",
        markdown,
        flags=re.MULTILINE,
    )
    markdown = re.sub(
        r"^[ \t]*\*\*==> picture \[[0-9]+ x [0-9]+\] intentionally omitted <==\*\*[ \t]*\n"
        r"(?:[ \t]*\n)?"
        r"[ \t]*(?:\*\*)?\d{1,4}(?:\*\*)?[ \t]*\n",
        "",
        markdown,
        flags=re.MULTILINE,
    )
    markdown = re.sub(
        r"^[ \t]*\*\*==> picture \[[0-9]+ x [0-9]+\] intentionally omitted <==\*\*[ \t]*\n",
        "",
        markdown,
        flags=re.MULTILINE,
    )
    markdown = markdown.replace("**----- Start of picture text -----**<br>\n", "")
    markdown = markdown.replace("**----- End of picture text -----**<br>\n", "")
    markdown = re.sub(r"^[ \t]*eme<br>[ \t]*\n?", "", markdown, flags=re.MULTILINE)
    markdown = re.sub(
        r"^\|\|\*\*INSTITUTO FEDERAL DO PARANÁ\*\*\|[ \t]*Pró-Reitoria de Ensino[ \t]*-\*\*PROENS\*\*\|\|\|[ \t]*\n",
        "",
        markdown,
        flags=re.MULTILINE,
    )
    markdown = re.sub(
        r"[ \t]*\*\*INSTITUTO FEDERAL DO PARANÁ\*\*[ \t]*\|[ \t]*Pró-Reitoria de Ensino[ \t]*-[ \t]*\*\*PROENS\*\*[ \t]*",
        " ",
        markdown,
    )
    markdown = re.sub(r"^\|{7,}\n", "", markdown, flags=re.MULTILINE)
    markdown = re.sub(r"[ \t]+$", "", markdown, flags=re.MULTILINE)
    markdown = re.sub(r"\n{3,}", "\n\n", markdown)
    return omitir_dados_pessoais(limpar_urls(markdown))


ERROS_PATH = ROOT.parent / "tmp" / "conversao-ppcs-erros.json"


def ler_erros() -> dict[str, str]:
    try:
        return json.loads(ERROS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def gravar_erros(erros: dict[str, str]) -> None:
    ERROS_PATH.parent.mkdir(parents=True, exist_ok=True)
    ERROS_PATH.write_text(json.dumps(erros, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def should_convert(curso: dict[str, object], force: bool, retry_errors: bool = False, erros: dict[str, str] | None = None) -> bool:
    ppc = curso.get("ppc")
    if not isinstance(ppc, dict) or not isinstance(ppc.get("url"), str):
        return False
    if force:
        return True
    chave = f"{curso.get('campus_id')}/{curso.get('curso_slug')}"
    if chave in (erros or {}) and not retry_errors:
        return False
    return not (ROOT / markdown_path_do_curso(curso)).exists()


def markdown_path_do_curso(curso: dict[str, object]) -> str:
    ppc = curso.get("ppc")
    caminho = ppc.get("markdown_path") if isinstance(ppc, dict) else None
    if isinstance(caminho, str) and caminho:
        return caminho
    return f"institucional/ifpr/ppcs/{curso.get('campus_id')}/{curso.get('curso_slug')}.md"


def convert_ppc(
    curso_path: Path, force: bool, force_ocr: bool, dry_run: bool, retry_errors: bool, erros: dict[str, str]
) -> int:
    curso = json.loads(curso_path.read_text(encoding="utf-8"))
    if not isinstance(curso, dict) or not should_convert(curso, force, retry_errors, erros):
        return 0
    chave = f"{curso.get('campus_id')}/{curso.get('curso_slug')}"
    url = curso["ppc"]["url"]
    markdown_path = markdown_path_do_curso(curso)
    target = ROOT / markdown_path
    print(f"{chave}: {url} -> {markdown_path}", flush=True)
    if dry_run:
        return 1

    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            source_path, sha256 = download_source(url, Path(tmp))
            convertido, conversor = convert_file(source_path, force_ocr=force_ocr)
            markdown = sanitize_markdown(convertido)
    except Exception as exc:
        erros[chave] = f"Falha na conversão: {exc.__class__.__name__}: {exc}"
        print(f"{chave}: erro - {erros[chave]}", flush=True)
        return 1
    if not markdown.strip():
        erros[chave] = "Conversão sem texto extraído; provável PDF digitalizado que exige OCR (--force-ocr)."
        print(f"{chave}: {erros[chave]}", flush=True)
        return 1
    erros.pop(chave, None)
    hoje = datetime.date.today().isoformat()
    target.write_text(front_matter_proveniencia(markdown_path, url, sha256, conversor, hoje) + markdown, encoding="utf-8")
    if not isinstance(curso["ppc"].get("markdown_path"), str):
        print(f"{chave}: convertido; acrescente ppc.markdown_path = {markdown_path} ao registro do curso", flush=True)
    else:
        print(f"{chave}: convertido", flush=True)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--campus", help="Filtra por id do campus, ex.: colombo")
    parser.add_argument("--curso", help="Filtra por slug do curso")
    parser.add_argument("--force", action="store_true", help="Reconverte PPCs que já têm Markdown na base")
    parser.add_argument(
        "--retry-errors", action="store_true", help="Tenta de novo os PPCs que falharam (tmp/conversao-ppcs-erros.json)"
    )
    parser.add_argument("--force-ocr", action="store_true", help="Força OCR em todas as páginas")
    parser.add_argument("--dry-run", action="store_true", help="Mostra o que seria convertido sem escrever arquivos")
    args = parser.parse_args()

    total = 0
    erros = ler_erros()
    for curso_path in iter_curso_paths(args.campus):
        if args.curso and curso_path.stem != args.curso:
            continue
        total += convert_ppc(curso_path, args.force, args.force_ocr, args.dry_run, args.retry_errors, erros)
    if not args.dry_run:
        gravar_erros(erros)
    print(f"PPCs processados: {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
