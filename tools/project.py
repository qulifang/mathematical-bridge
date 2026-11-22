"""Shared project validation, publication and backups. Python standard library only."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TYPES = {
    "lesson": {".ppt", ".pptx", ".pdf"},
    "system": {".doc", ".docx", ".pdf", ".md", ".txt"},
    "tool": {".zip", ".7z", ".rar", ".pdf"},
    "session": {".pbn"},
    "photo": {".jpg", ".jpeg", ".png", ".webp"},
}


def read_catalog():
    return json.loads((ROOT / "content/catalog.json").read_text(encoding="utf-8"))


def atomic_catalog(catalog):
    directory = ROOT / "content"
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory, delete=False) as stream:
        json.dump(catalog, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        temporary = Path(stream.name)
    try:
        os.replace(temporary, directory / "catalog.json")
    finally:
        temporary.unlink(missing_ok=True)


def media_path(value):
    if not isinstance(value, str) or "\\" in value:
        raise ValueError("附件路径格式不正确。")
    relative = Path(value)
    if not relative.parts or relative.parts[0] != "media" or ".." in relative.parts:
        raise ValueError("附件路径需以 media/ 开头，且不能跨目录。")
    path = (ROOT / value).resolve()
    if not path.is_relative_to((ROOT / "media").resolve()) or not path.is_file():
        raise ValueError("附件不存在，或不在 media 文件夹中。")
    return path


def parse_pbn(raw):
    text = raw.decode("utf-8-sig", errors="replace")
    boards, numbers = [], set()
    for block in re.split(r'(?=^\s*\[Board\s+")', text, flags=re.M):
        tags = dict(re.findall(r'^\s*\[(\w+)\s+"([^"]*)"\]', block, re.M))
        number = tags.get("Board")
        if number is None:
            continue
        if number in numbers:
            raise ValueError(f"第 {number} 副重复。每副牌请保留一条记录。")
        numbers.add(number)
        match = re.fullmatch(r"([NESW]):\s*(.+)", tags.get("Deal", "").upper())
        if not match:
            raise ValueError(f"第 {number} 副缺少完整牌面。")
        groups, hands, cards = match[2].split(), {}, set()
        if len(groups) != 4:
            raise ValueError(f"第 {number} 副应有四手牌。")
        start = "NESW".index(match[1])
        for index, group in enumerate(groups):
            parts = group.split(".")
            if len(parts) != 4 or sum(map(len, parts)) != 13 or any(not re.fullmatch(r"[AKQJT2-9]*", part) for part in parts):
                raise ValueError(f"第 {number} 副手牌格式错误。")
            hands["NESW"[(start + index) % 4]] = parts
            cards.update(str(suit) + rank for suit, part in enumerate(parts) for rank in part)
        if len(cards) != 52:
            raise ValueError(f"第 {number} 副有重复牌。")
        dd_raw = tags.get("DoubleDummyTricks", "")
        dd = [int(value, 16) for value in dd_raw] if re.fullmatch(r"[0-9a-dA-D]{20}", dd_raw) else None
        if dd is None:
            rows = re.findall(r"^\s*([NSEW])\s+(NT|[SHDC])\s+(1[0-3]|[0-9])\s*$", block, re.M)
            values = {(seat, suit): int(tricks) for seat, suit, tricks in rows}
            if len(values) == 20:
                dd = [values[(seat, suit)] for seat in "NSEW" for suit in ["NT", "S", "H", "D", "C"]]
        vul = {"none": "None", "love": "None", "ns": "NS", "ew": "EW", "all": "All", "both": "All"}.get(tags.get("Vulnerable", "").lower())
        dealer = tags.get("Dealer", "").upper()
        boards.append({"number": number, "hands": hands, "dealer": dealer if dealer in "NESW" and len(dealer) == 1 else "",
                       "vul": vul, "dd": dd, "optimum": tags.get("OptimumScore", "")})
    if not boards:
        raise ValueError("PBN 文件中没有可显示的 Board 和 Deal 记录。")
    return boards


def text_field(item, key, limit=12000):
    value = item.get(key, "")
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError(f"{key} 字段格式或长度不正确。")
    return value


def decode_asset(data):
    if not isinstance(data, str) or ";base64," not in data:
        raise ValueError("附件编码不正确。")
    try:
        raw = base64.b64decode(data.split(",", 1)[1], validate=True)
    except ValueError as error:
        raise ValueError("附件无法解码。") from error
    if not raw or len(raw) > 15 * 1024 * 1024:
        raise ValueError("每份附件需大于 0，且不超过 15 MB。")
    return raw


def save_blob(raw, kind, entry_id, extension, suffix=""):
    folder = ROOT / "media" / kind
    folder.mkdir(parents=True, exist_ok=True)
    name = entry_id + "-" + hashlib.sha256(raw).hexdigest()[:16] + suffix + extension
    target = folder / name
    if not target.exists():
        with tempfile.NamedTemporaryFile(dir=folder, delete=False) as stream:
            stream.write(raw)
            temporary = Path(stream.name)
        os.replace(temporary, target)
    return target.relative_to(ROOT).as_posix()


def normalize_entries(entries, upload=False):
    if not isinstance(entries, list) or len(entries) > 5000:
        raise ValueError("内容记录格式或数量不正确。")
    normalized, ids = [], set()
    for item in entries:
        kind, entry_id = item.get("type"), item.get("id")
        if kind not in {*TYPES, "story"} or not isinstance(entry_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", entry_id) or entry_id in ids:
            raise ValueError("栏目或条目编号不正确，或编号重复。")
        ids.add(entry_id)
        record = {key: text_field(item, key) for key in ["title", "date", "description"]}
        if kind != "photo" and (not record["title"].strip() or len(record["title"]) > 100):
            raise ValueError("请填写不超过 100 字的标题。")
        record.update(id=entry_id, type=kind)
        if kind == "story":
            for key in ["session", "board", "process", "thinking", "result", "lead", "attribution"]:
                record[key] = text_field(item, key)
            if item.get("category") not in {"叫牌", "坐庄", "防守"}:
                raise ValueError("复盘分类不正确。")
            record["category"] = item["category"]
            for key in ["contributor", "contributorSeat", "auctionTitle"]:
                record[key] = text_field(item, key, 100)
            if not record["contributor"].strip() and not record["attribution"].strip():
                raise ValueError("请填写本局署名。")
            if record["contributorSeat"] not in {"", "N", "E", "S", "W"}:
                raise ValueError("署名方位不正确。")
            view_seat = text_field(item, "viewSeat", 1)
            if view_seat not in {"", "N", "E", "S", "W"}:
                raise ValueError("单手视角方位不正确。")
            if view_seat:
                record["viewSeat"] = view_seat
            sections = item.get("sections")
            if sections is not None:
                if not isinstance(sections, list) or len(sections) > 30 or any(not isinstance(part, dict) for part in sections):
                    raise ValueError("内容段落格式不正确，最多30段。")
                record["sections"] = [{"title": text_field(part, "title", 100), "body": text_field(part, "body")} for part in sections]
            notes = item.get("auctionNotes", {})
            if not isinstance(notes, dict) or len(notes) > 400 or any(not re.fullmatch(r"[1-9][0-9]{0,2}", key) or int(key) > len(item.get("auction", [])) for key in notes):
                raise ValueError("叫品提示的序号超出叫牌序列。")
            record["auctionNotes"] = {key: text_field(notes, key, 500) for key in notes}
            if item.get("endgame"):
                diagram = item["endgame"]
                remaining = diagram.get("remaining", {})
                if set(remaining) != set("NESW") or any(not isinstance(parts, list) or len(parts) != 4 or any(not isinstance(part, str) or not re.fullmatch(r"[AKQJT2-9]*", part) or len(set(part)) != len(part) for part in parts) for parts in remaining.values()):
                    raise ValueError("残局需填写四家，每家按四种花色填写不重复余牌。")
                counts = {sum(map(len, parts)) for parts in remaining.values()}
                if len(counts) != 1 or not 1 <= next(iter(counts)) <= 13:
                    raise ValueError("残局四家余牌张数需要相同，且在1至13之间。")
                seat, card = diagram.get("seat"), diagram.get("card", "")
                if seat not in "NESW" or not re.fullmatch(r"[SHDC][AKQJT2-9]", card) or card[1] not in remaining[seat]["SHDC".index(card[0])]:
                    raise ValueError("当前出牌需属于对应方位的余牌，如 SQ。")
                record["endgame"] = {"remaining": remaining, "seat": seat, "card": card}
            if item.get("auction"):
                auction = item["auction"]
                if not isinstance(auction, list) or len(auction) > 400 or any(not isinstance(bid, str) or not re.fullmatch(r"Pass|X|XX|[1-7](NT|[SHDC])", bid) for bid in auction):
                    raise ValueError("叫牌序列格式错误。")
                record["auction"] = auction
        elif item.get("href") and kind in {"lesson", "system", "tool"}:
            href = text_field(item, "href", 2000)
            parsed = urlsplit(href)
            if parsed.scheme not in {"https", "http"} or not parsed.netloc or parsed.username:
                raise ValueError("网页链接需使用 http 或 https。")
            record["href"] = href
            record["linkLabel"] = text_field(item, "linkLabel", 30)
            record["library"] = bool(item.get("library"))
        else:
            file = item.get("file") or {}
            name = text_field(file, "name", 240)
            extension = Path(name).suffix.lower()
            if extension not in TYPES[kind]:
                raise ValueError("附件类型不符合当前栏目。")
            if file.get("data") and upload:
                raw = decode_asset(file["data"])
                if kind == "session":
                    parse_pbn(raw)
                file_path = save_blob(raw, kind, entry_id, extension)
            else:
                file_path = text_field(file, "path", 500)
                raw = media_path(file_path).read_bytes()
            record["file"] = {"name": name, "path": file_path, "size": len(raw)}
            if kind == "photo":
                if file.get("thumbnailData") and upload:
                    thumb = save_blob(decode_asset(file["thumbnailData"]), kind, entry_id, ".jpg", "-thumb")
                    record["file"]["thumbnail"] = thumb
                elif file.get("thumbnail"):
                    media_path(file["thumbnail"])
                    record["file"]["thumbnail"] = file["thumbnail"]
            if kind == "session":
                parse_pbn(raw)
        normalized.append(record)
    sessions = {record["id"]: record for record in normalized if record["type"] == "session"}
    for record in normalized:
        if record["type"] == "story" and record.get("endgame") and not record.get("session"):
            raise ValueError("残局牌图需要关联训练活动及牌号。")
        if record["type"] == "story" and any("[[残局]]" in part["body"] for part in record.get("sections", [])) and not record.get("endgame"):
            raise ValueError("正文包含残局标记，请填写残局余牌。")
        if record["type"] == "story" and record.get("session"):
            session = sessions.get(record["session"])
            if not session:
                raise ValueError("复盘关联的训练活动不存在。请解除关联或选择其他活动。")
            numbers = {board["number"] for board in parse_pbn(media_path(session["file"]["path"]).read_bytes())}
            if record["board"] not in numbers:
                raise ValueError("复盘关联的牌号不存在。")
            if record.get("endgame"):
                board = next(b for b in parse_pbn(media_path(session["file"]["path"]).read_bytes()) if b["number"] == record["board"])
                for seat, parts in record["endgame"]["remaining"].items():
                    if any(not set(holding) <= set(board["hands"][seat][suit]) for suit, holding in enumerate(parts)):
                        raise ValueError("残局余牌不属于关联牌例的原始手牌。")
    return normalized


def site_data(editable=False):
    catalog = read_catalog()
    entries = normalize_entries(catalog["entries"])
    for item in entries:
        if item["type"] == "session":
            item["boards"] = parse_pbn(media_path(item["file"]["path"]).read_bytes())
    return {"editable": editable, "revision": catalog["revision"], "entries": entries,
            "conventions": json.loads((ROOT / "content/conventions.json").read_text(encoding="utf-8"))}


def build():
    data = site_data()
    files = {}
    for name in ["app.js", "style.css"]:
        raw = (ROOT / "src" / name).read_bytes()
        stem, ext = name.rsplit(".", 1)
        files[name] = "assets/" + stem + "-" + hashlib.sha256(raw).hexdigest()[:12] + "." + ext
    template = (ROOT / "src/index.html").read_text(encoding="utf-8")
    template = re.sub(r'<button[^>]+id="manage-open".*?</button>', "", template, flags=re.S)
    template = re.sub(r'<dialog id="manager".*?</dialog>', "", template, flags=re.S)
    for name, destination in files.items():
        template = template.replace("assets/" + name, destination)
    with tempfile.TemporaryDirectory(dir=ROOT) as directory:
        staging = Path(directory)
        (staging / "data").mkdir()
        (staging / "assets").mkdir()
        (staging / "index.html").write_text(template, encoding="utf-8")
        (staging / "data/site.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        for name, destination in files.items():
            (staging / destination).write_bytes((ROOT / "src" / name).read_bytes())
        for item in data["entries"]:
            if "file" not in item:
                continue
            for key in ["path", "thumbnail"]:
                if not item["file"].get(key):
                    continue
                relative = item["file"][key]
                target = staging / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(media_path(relative).read_bytes())
        (staging / "CNAME").write_text("fdmathbridge.top\n", encoding="ascii")
        (staging / ".nojekyll").touch()
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
            for file in sorted(staging.rglob("*")):
                if file.is_file():
                    archive.write(file, file.relative_to(staging).as_posix())
    return stream.getvalue()


def backup():
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        for directory in ["src", "tools", "content", "media", "docs", ".github"]:
            for file in sorted((ROOT / directory).rglob("*")):
                if file.is_file() and "__pycache__" not in file.parts:
                    archive.write(file, file.relative_to(ROOT).as_posix())
        for name in ["README.md", "AGENTS.md", ".gitignore", ".gitattributes", "启动维护.cmd"]:
            archive.write(ROOT / name, name)
    return stream.getvalue()


def main():
    parser = argparse.ArgumentParser(description="生成 Mathematical Bridge 静态网站。")
    parser.add_argument("--output-dir", type=Path, help="将网页写到新目录，供 GitHub Pages 使用。")
    args = parser.parse_args()
    release = build()
    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=False)
        with zipfile.ZipFile(io.BytesIO(release)) as archive:
            archive.extractall(args.output_dir)
        print(f"网页已生成：{args.output_dir}")
    else:
        releases = ROOT / "releases"
        releases.mkdir(exist_ok=True)
        (releases / "Mathematical-Bridge-发布包.zip").write_bytes(release)
        print("发布包已生成。")


if __name__ == "__main__":
    main()
