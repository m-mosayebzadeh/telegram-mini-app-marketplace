"""
Taps through the running dev app the way a person would, in a real
browser, and says what worked (TECHNICAL_REQUIREMENTS.md section 43).

Unit tests pass while a real screen fails — the selection bar did, twice:
once hidden by the list's fade, once with its taps taken by the world. So
after an interface change, this runs against the dev servers:

    backend/.venv/Scripts/python frontend/scripts/drive-app.py

It signs test people in by making sessions directly (development only),
drives Chrome through its debugging port, and leaves the data as it found
it where it changes anything (a pin is taken back off).
"""

import asyncio
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "backend"))
os.chdir(os.path.join(ROOT, "backend"))

from app.auth import sessions  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.models.user import User  # noqa: E402

import websockets  # noqa: E402

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BASE = "http://localhost:5174"
SHOTS = os.path.join(tempfile.gettempdir(), "cosmos-drive")
RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))


class Page:
    def __init__(self, ws):
        self.ws, self.n = ws, 0

    async def call(self, method, **params):
        self.n += 1
        await self.ws.send(json.dumps({"id": self.n, "method": method, "params": params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == self.n:
                return msg.get("result", {})

    async def js(self, expression):
        r = await self.call("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True)
        return r.get("result", {}).get("value")

    async def go(self, path, settle=5):
        await self.call("Page.navigate", url=BASE + path)
        await asyncio.sleep(settle)

    async def center(self, selector):
        return await self.js(f"""(() => {{ const el = document.querySelector({json.dumps(selector)}); if (!el) return null;
            const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] }})()""")

    async def press(self, x, y, hold_ms=0):
        for kind in ("mouseMoved", "mousePressed"):
            await self.call("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1)
        await asyncio.sleep(hold_ms / 1000)
        await self.call("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="left", clickCount=1)
        await asyncio.sleep(0.6)

    async def tap(self, selector, hold_ms=0):
        point = await self.center(selector)
        if point is None:
            return False
        await self.press(point[0], point[1], hold_ms)
        return True

    async def shot(self, name):
        os.makedirs(SHOTS, exist_ok=True)
        data = (await self.call("Page.captureScreenshot", format="png"))["data"]
        with open(os.path.join(SHOTS, name + ".png"), "wb") as f:
            f.write(base64.b64decode(data))


async def open_as(user_id: int, width: int, height: int, port: int):
    with SessionLocal() as db:
        token = sessions.start_session(db, db.get(User, user_id), provider="dev", user_agent="drive-app")
        db.commit()
    chrome = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--remote-debugging-port={port}",
                               f"--user-data-dir={tempfile.mkdtemp()}", f"--window-size={width},{height}", "about:blank"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            tab = next(t for t in json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/json").read()) if t["type"] == "page")
            break
        except Exception:
            time.sleep(0.2)
    ws = await websockets.connect(tab["webSocketDebuggerUrl"], max_size=50_000_000)
    page = Page(ws)
    await page.call("Network.setCookie", name=sessions.COOKIE, value=token, url=BASE, httpOnly=True)
    await page.call("Emulation.setDeviceMetricsOverride", width=width, height=height, deviceScaleFactor=1, mobile=width < 600)
    return chrome, ws, page


async def person_side(page: Page):
    """Sara on a phone: the conversation list, selecting, the bar, support."""
    await page.go("/sky/talk", settle=6)
    check("the conversation list shows rows", (await page.js("document.querySelectorAll('.cos-talklist-row').length")) > 0)
    await page.tap(".cos-talklist-row", hold_ms=700)
    check("holding a row brings up the selection bar", bool(await page.js("!!document.querySelector('.cos-talklist-select')")))
    pinned_before = await page.js("(async()=>(await (await fetch('/api/conversations?limit=50')).json()).filter(c=>c.pinned).length)()")
    # The pin is the first of the bar's actions (the cross before them closes it).
    tapped = await page.tap('.cos-talklist-select .cos-select-actions .cos-talk-tool')
    await asyncio.sleep(1.5)
    pinned_after = await page.js("(async()=>(await (await fetch('/api/conversations?limit=50')).json()).filter(c=>c.pinned).length)()")
    check("a button on the selection bar does something", tapped and pinned_after != pinned_before, f"pinned {pinned_before} → {pinned_after}")
    # Leave the data as it was: unpin whatever this pinned.
    if pinned_after > pinned_before:
        await page.js("(async()=>{const l=await (await fetch('/api/conversations?limit=50')).json();const p=l.filter(c=>c.pinned).pop();if(p) await fetch('/api/conversations/'+p.id+'/pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pinned:false})})})()")
    await page.shot("person-list")

    await page.go("/settings", settle=4)
    tapped = await page.js("""(() => { const row = [...document.querySelectorAll('button')].find(b => /پشتیبانی|support/i.test(b.textContent)); if (!row) return false; row.scrollIntoView(); return true })()""")
    await asyncio.sleep(0.5)
    point = await page.js("""(() => { const row = [...document.querySelectorAll('button')].find(b => /پشتیبانی|support/i.test(b.textContent)); const r = row.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2] })()""") if tapped else None
    if point:
        await page.press(point[0], point[1])
        await asyncio.sleep(3)
    path = await page.js("location.pathname")
    check("contact support opens the conversation with the team", path.startswith("/conversations/"), path)


async def staff_side(page: Page):
    """Soheil (the owner): the support tab and a support conversation."""
    await page.go("/sky/talk", settle=6)
    tabs = await page.js("[...document.querySelectorAll('.cos-talklist-tab')].map(t=>t.textContent)")
    check("staff see two tabs", isinstance(tabs, list) and len(tabs) == 2, str(tabs))
    await page.tap(".cos-talklist-tab:nth-of-type(2)")
    await asyncio.sleep(2)
    check("the support tab lists conversations", (await page.js("document.querySelectorAll('.cos-talklist-row').length")) > 0)
    header = await page.js("document.querySelector('.cos-header-count')?.textContent || ''")
    check("the line under the name follows the support tab", header != "", header)
    await page.tap(".cos-talklist-row")
    await asyncio.sleep(4)
    check("a support conversation opens", (await page.js("location.pathname")).startswith("/conversations/"))
    check("staff see the support band", bool(await page.js("!!document.querySelector('.cos-support-band')")))
    check("staff are not offered 'see in the world'", not await page.js("!!document.querySelector('.cos-talk-go')"))
    await page.shot("staff-support")


async def main():
    procs = []
    try:
        chrome, ws, page = await open_as(2, 420, 860, 9341)  # Sara
        procs.append((chrome, ws))
        await person_side(page)
        chrome, ws, page = await open_as(44, 420, 860, 9342)  # Soheil
        procs.append((chrome, ws))
        await staff_side(page)
    finally:
        for chrome, ws in procs:
            await ws.close()
            chrome.terminate()
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)} passed, {len(failed)} failed. Screenshots in {SHOTS}")
    sys.exit(1 if failed else 0)


asyncio.run(main())
