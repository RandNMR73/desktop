"""Loopback-only, synthetic full-page capture fixture; prints its chosen port."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit,parse_qs
from pathlib import Path
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  q=parse_qs(urlsplit(self.path).query);rtl='rtl' if 'rtl' in q else 'ltr'
  size='height:2400px;width:2200px' if 'wide' in q else 'height:2400px;width:100%'
  body=f'''<!doctype html><html dir="{rtl}"><meta charset="utf-8"><title>Full-page capture test</title><style>*{{box-sizing:border-box}}html{{background:white}}body{{margin:0;{size};position:relative;background:rgb(240,240,240)}}.corner{{position:absolute;width:64px;height:64px}}#tl{{left:0;top:0;background:rgb(255,0,0)}}#tr{{right:0;top:0;background:rgb(0,255,0)}}#bl{{left:0;bottom:0;background:rgb(0,0,255)}}#br{{right:0;bottom:0;background:rgb(255,0,255)}}.gradient{{position:absolute;left:128px;top:128px;width:256px;height:256px;background:repeating-linear-gradient(white 0 63px,black 63px 64px)}}#fixed{{position:fixed;top:80px;left:400px;background:orange;width:100px;height:50px}}</style><div id="tl" class="corner"></div><div id="tr" class="corner"></div><div id="bl" class="corner"></div><div id="br" class="corner"></div><div class="gradient"></div><div id="fixed"></div></html>'''.encode()
  if 'scroll' in q: body=Path(__file__).with_name('capture-scroll-fixture.html').read_bytes()
  self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
server=HTTPServer(('127.0.0.1',0),Handler);print(server.server_port,flush=True);server.serve_forever()
