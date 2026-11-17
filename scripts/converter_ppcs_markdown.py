#!/usr/bin/env python3
"""Converte para Markdown os PPCs referenciados nos registros de cursos.

Lê `base-conhecimento/institucional/ifpr/cursos/<campus_id>/<curso_slug>.json` (`ppc.url` e
`ppc.markdown_path`) e grava o Markdown em `base-conhecimento/<ppc.markdown_path>`. O registro do curso
não é alterado: um PPC conta como convertido quando o Markdown existe, e as falhas só aparecem na saída.
Números de CPF e RG saem como `[CPF omitido]` e `[RG omitido]` (`omitir_documentos_pessoais`, a mesma
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


# Mesma regra de packages/kb/src/ppcs/dados-pessoais.ts; dados-pessoais.test.ts confere as duas.
_INICIO = r"(?<![^\W_])"  # não precedido de letra ou dígito
_FIM = r"(?![^\W\d_])"  # não seguido de letra
_SEPARADOR = r"(?:[\s*_:]|n\.?\s?[º°o]\.?|n[º°]|número)*"
_NUMERO_CPF = r"\d{3}[.\s]?\d{3}[.\s]?\d{3}\s?[-–.]?\s?\d{2}(?!\d)"
_NUMERO_RG = r"\d(?:[\d.]{2,12}\d|\d{2,12})(?:\s?[-–]\s?[\dXx])?(?!\d)"
_RE_CPF_ROTULADO = re.compile(rf"({_INICIO}CPF{_FIM}{_SEPARADOR})({_NUMERO_CPF})", re.IGNORECASE)
_RE_RG_ROTULADO = re.compile(
    rf"({_INICIO}(?:RG|R\.G\.|Registro\s+Geral|(?:c[ée]dula|carteira)\s+de\s+identidade){_FIM}{_SEPARADOR})({_NUMERO_RG})",
    re.IGNORECASE,
)
_RE_CPF_FORMATADO = re.compile(r"(?<![\d.])(\d{3})\.(\d{3})\.(\d{3})-(\d{2})(?!\d)")


def cpf_valido(digitos: str) -> bool:
    if not re.fullmatch(r"\d{11}", digitos) or len(set(digitos)) == 1:
        return False
    numeros = [int(c) for c in digitos]
    for tamanho in (9, 10):
        soma = sum(numeros[i] * (tamanho + 1 - i) for i in range(tamanho))
        if (soma * 10) % 11 % 10 != numeros[tamanho]:
            return False
    return True


def omitir_documentos_pessoais(texto: str) -> str:
    """Troca números de CPF e RG de declarações e termos anexos por marcadores neutros."""
    texto = _RE_CPF_ROTULADO.sub(lambda m: m.group(1) + "[CPF omitido]", texto)
    texto = _RE_RG_ROTULADO.sub(lambda m: m.group(1) + "[RG omitido]", texto)
    return _RE_CPF_FORMATADO.sub(
        lambda m: "[CPF omitido]" if cpf_valido("".join(m.groups())) else m.group(0),
        texto,
    )


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
    return omitir_documentos_pessoais(markdown)


def should_convert(curso: dict[str, object], force: bool) -> bool:
    ppc = curso.get("ppc")
    if not isinstance(ppc, dict) or not isinstance(ppc.get("url"), str):
        return False
    markdown_path = markdown_path_do_curso(curso)
    return force or not (ROOT / markdown_path).exists()


def markdown_path_do_curso(curso: dict[str, object]) -> str:
    ppc = curso.get("ppc")
    caminho = ppc.get("markdown_path") if isinstance(ppc, dict) else None
    if isinstance(caminho, str) and caminho:
        return caminho
    return f"institucional/ifpr/ppcs/{curso.get('campus_id')}/{curso.get('curso_slug')}.md"


def convert_ppc(curso_path: Path, force: bool, force_ocr: bool, dry_run: bool) -> int:
    curso = json.loads(curso_path.read_text(encoding="utf-8"))
    if not isinstance(curso, dict) or not should_convert(curso, force):
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
        print(f"{chave}: erro - Falha na conversão: {exc.__class__.__name__}: {exc}", flush=True)
        return 1
    if not markdown.strip():
        print(f"{chave}: sem texto extraído; provável PDF digitalizado que exige OCR (--force-ocr)", flush=True)
        return 1
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
    parser.add_argument("--force-ocr", action="store_true", help="Força OCR em todas as páginas")
    parser.add_argument("--dry-run", action="store_true", help="Mostra o que seria convertido sem escrever arquivos")
    args = parser.parse_args()

    total = 0
    for curso_path in iter_curso_paths(args.campus):
        if args.curso and curso_path.stem != args.curso:
            continue
        total += convert_ppc(curso_path, args.force, args.force_ocr, args.dry_run)
    print(f"PPCs processados: {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
