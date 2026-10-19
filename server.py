"""OPTIONAL sample of a save backend (not required).
Static server + POST /save so the admin Save button writes data/rooms.json directly.
Without it, Save writes the file via the browser (Chrome/Edge) or downloads rooms.json.
Run:  python server.py   (then open http://localhost:8080/admin.html)"""
import json, shutil
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOMS = 'data/rooms.json'

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path != '/save':
            return self.send_error(404)
        try:
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            with open(ROOMS, encoding='utf-8') as f:
                data = json.load(f)
            by_id = {s['id']: s for s in body['surfaces']}
            for s in data['rooms'][0]['surfaces']:
                if s['id'] in by_id:
                    s['polygons'] = by_id[s['id']]['polygons']
            shutil.copyfile(ROOMS, ROOMS + '.bak')
            with open(ROOMS, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'ok')
        except Exception as e:  # report to the admin page
            self.send_response(500)
            self.end_headers()
            self.wfile.write(str(e).encode())

if __name__ == '__main__':
    ThreadingHTTPServer(('', 8080), Handler).serve_forever()
