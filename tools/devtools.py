#!/usr/bin/env python3
"""Talk to Steam's UI (SharedJSContext) over the Chrome DevTools Protocol.

Needs Steam started with ~/.steam/steam/.cef-enable-remote-debugging present
(DevTools on localhost:8080). Standard library only.

Usage:
  devtools.py eval <js expression | @file>   evaluate in Steam's main world
  devtools.py watch <seconds>                print console errors, warnings and
                                             plugin output from every context
"""
import base64
import json
import os
import socket
import struct
import sys
import time
import urllib.request
from urllib.parse import urlparse


def ws_connect(url):
    u = urlparse(url)
    sock = socket.create_connection((u.hostname, u.port), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall((f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\n"
                  f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
    resp = b""
    while b"\r\n\r\n" not in resp:
        resp += sock.recv(4096)
    if b" 101 " not in resp.split(b"\r\n")[0]:
        raise SystemExit(resp.decode(errors="replace"))
    return sock


def send(sock, text):
    data = text.encode()
    mask = os.urandom(4)
    header = bytes([0x81])
    n = len(data)
    if n < 126:
        header += bytes([0x80 | n])
    elif n < 65536:
        header += bytes([0x80 | 126]) + struct.pack(">H", n)
    else:
        header += bytes([0x80 | 127]) + struct.pack(">Q", n)
    sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


def recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise EOFError
        buf += chunk
    return buf


def recv(sock):
    msg = b""
    while True:
        b1, b2 = recv_exact(sock, 2)
        n = b2 & 0x7F
        if n == 126:
            n = struct.unpack(">H", recv_exact(sock, 2))[0]
        elif n == 127:
            n = struct.unpack(">Q", recv_exact(sock, 8))[0]
        msg += recv_exact(sock, n)
        if b1 & 0x80:
            return msg.decode(errors="replace")


TARGET = "SharedJSContext"


def connect():
    targets = json.loads(urllib.request.urlopen("http://127.0.0.1:8080/json", timeout=5).read())
    target = next((t for t in targets if t["title"] == TARGET), None)
    if not target:
        raise SystemExit(f"no {TARGET} target; have: {[t['title'] for t in targets]}")
    sock = ws_connect(target["webSocketDebuggerUrl"])
    sock.settimeout(1)
    return sock


def messages(sock, seconds):
    """Yield CDP messages until the deadline; never blocks past it."""
    end = time.time() + seconds
    while time.time() < end:
        try:
            yield json.loads(recv(sock))
        except (socket.timeout, TimeoutError):
            continue


def cmd_eval(expr):
    if expr.startswith("@"):
        expr = open(expr[1:]).read()
    sock = connect()
    send(sock, json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
        "expression": expr, "returnByValue": True, "awaitPromise": True}}))
    for msg in messages(sock, 15):
        if msg.get("id") == 1:
            result = msg.get("result", {})
            if "exceptionDetails" in result:
                print("EXCEPTION:", json.dumps(result["exceptionDetails"])[:1500])
            else:
                print(json.dumps(result.get("result", {}).get("value"), indent=1)[:6000])
            return
    print("no answer within 15 s")


def cmd_watch(seconds):
    sock = connect()
    send(sock, json.dumps({"id": 1, "method": "Runtime.enable"}))
    names = {}
    for msg in messages(sock, seconds):
        method, params = msg.get("method"), msg.get("params", {})
        if method == "Runtime.executionContextCreated":
            ctx = params["context"]
            names[ctx["id"]] = ctx.get("name") or "main"
        elif method == "Runtime.consoleAPICalled":
            ctx = names.get(params.get("executionContextId"), "?")
            text = " ".join(str(a.get("value", a.get("description", ""))) for a in params["args"])
            if params["type"] in ("error", "warning") or ctx != "main":
                print(f"[{ctx}] {params['type']}: {text[:800]}", flush=True)
        elif method == "Runtime.exceptionThrown":
            details = params["exceptionDetails"]
            text = details.get("exception", {}).get("description") or details.get("text")
            print(f"[{names.get(details.get('executionContextId'), '?')}] exception: {text[:800]}", flush=True)


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("eval", "watch"):
        raise SystemExit(__doc__)
    if sys.argv[1] == "eval":
        cmd_eval(sys.argv[2])
    else:
        cmd_watch(float(sys.argv[2]))


if __name__ == "__main__":
    main()
