"""Run the maintainer interface on this computer only."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import threading
from urllib.parse import unquote, urlsplit
import webbrowser

from project import ROOT, atomic_catalog, backup, build, normalize_entries, read_catalog, site_data

LOCK = threading.RLock()


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body, mime="application/json; charset=utf-8"):
        if isinstance(body, dict):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def allowed(self, mutation=False):
        hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if self.headers.get("Host") not in hosts:
            self.reply(403, {"error": "只接受本机地址。"})
            return False
        if mutation and self.headers.get("Origin") not in {"http://" + host for host in hosts}:
            self.reply(403, {"error": "只接受维护页面发起的修改。"})
            return False
        return True

    def do_GET(self):
        if not self.allowed():
            return
        path = unquote(urlsplit(self.path).path)
        if path == "/data/site.json":
            with LOCK:
                self.reply(200, site_data(editable=True))
            return
        if path in {"/", "/index.html"}:
            target = ROOT / "src/index.html"
        elif path in {"/assets/app.js", "/assets/style.css"}:
            target = ROOT / "src" / Path(path).name
        elif path.startswith("/media/"):
            target = (ROOT / path.lstrip("/")).resolve()
            if not target.is_relative_to((ROOT / "media").resolve()):
                self.reply(403, {"error": "无权读取此文件。"})
                return
        else:
            self.reply(404, {"error": "文件不存在。"})
            return
        if not target.is_file():
            self.reply(404, {"error": "文件不存在。"})
            return
        mime = {".js": "text/javascript", ".css": "text/css", ".html": "text/html"}.get(target.suffix)
        mime = mime or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.reply(200, target.read_bytes(), mime)

    def mutation(self, method):
        if not self.allowed(mutation=True):
            return
        if self.headers.get_content_type() != "application/json":
            self.reply(415, {"error": "请求需使用 JSON 格式。"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 40 * 1024 * 1024:
                raise ValueError("上传请求为空或超过 40 MB。")
            payload = json.loads(self.rfile.read(length))
            path = urlsplit(self.path).path
            with LOCK:
                if method == "PUT" and path == "/api/catalog":
                    current = read_catalog()
                    if payload.get("revision") != current["revision"]:
                        self.reply(409, {"error": "项目已被更新。请刷新页面，重新检查后再保存。"})
                        return
                    records = normalize_entries(payload.get("entries"), upload=True)
                    atomic_catalog({"revision": current["revision"] + 1, "entries": records})
                    self.reply(200, site_data(editable=True))
                elif method == "POST" and path in {"/api/build", "/api/backup"}:
                    result = build() if path == "/api/build" else backup()
                    folder = ROOT / "releases"
                    folder.mkdir(exist_ok=True)
                    name = "Mathematical-Bridge-" + ("发布包" if path == "/api/build" else "维护备份") + ".zip"
                    (folder / name).write_bytes(result)
                    self.reply(200, result, "application/zip")
                else:
                    self.reply(404, {"error": "操作不存在。"})
        except (ValueError, TypeError, KeyError, AttributeError, OSError) as error:
            self.reply(400, {"error": str(error)})

    def do_PUT(self):
        self.mutation("PUT")

    def do_POST(self):
        self.mutation("POST")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{server.server_port}/"
    print("维护界面 " + url, flush=True)
    print("关闭此窗口或按 Ctrl+C 可结束本机维护。", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
