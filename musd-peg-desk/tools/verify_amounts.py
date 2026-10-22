"""Dry-runs (eth_call) every redemption size Peg Desk suggests, plus a few typed amounts, on Mezo testnet.

Usage:  python3 tools/verify_amounts.py [URL]
Env:    CHROMIUM=/path/to/chromium (optional), HTTPS_PROXY (optional)
"Full" sizes close whole loans and do not depend on the BTC price, so they should always pass.
"Partial" sizes depend on the oracle not moving between planning and execution; they may fail on a busy oracle.
"""
import os, sys, json
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = sys.argv[1] if len(sys.argv) > 1 else "file://" + os.path.join(ROOT, "index.html")
kw = {"args": ["--ignore-certificate-errors"]}
if os.environ.get("CHROMIUM"): kw["executable_path"] = os.environ["CHROMIUM"]
if os.environ.get("HTTPS_PROXY"): kw["proxy"] = {"server": os.environ["HTTPS_PROXY"], "bypass": "127.0.0.1,localhost"}

with sync_playwright() as pw:
    b = pw.chromium.launch(**kw)
    pg = b.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_function("document.querySelector('#chips .chip')", timeout=90000); pg.wait_for_timeout(1500)
    chips = pg.eval_on_selector_all("#chips .chip", "c=>c.map(x=>[x.dataset.v,x.innerText])")
    out = []
    for v, label in chips[:6] + [["5000", "typed"], ["50", "typed"]]:
        pg.fill("#amt", v); pg.wait_for_timeout(600); pg.click("#btnSim")
        pg.wait_for_function("document.querySelector('#simres .okbox, #simres .errbox, #simres .warnbox')", timeout=60000)
        r = pg.inner_text("#simres"); plan = pg.inner_text("#plan").split("\n")[0]
        out.append({"amount": v, "chip": label.replace("\n", " "), "plan": plan,
                    "dryrun": "PASS" if r.startswith("Dry-run passed") else r[:120]})
    b.close()
fulls = [o for o in out if o["chip"].endswith("full")]
print(json.dumps(out, indent=1)); print("page errors:", errs)
print("full sizes passing:", sum(o["dryrun"] == "PASS" for o in fulls), "/", len(fulls))
sys.exit(0 if fulls and all(o["dryrun"] == "PASS" for o in fulls) and not errs else 1)
