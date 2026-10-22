"""End-to-end check of MUSD Peg Desk against the live Mezo chain (Playwright + Chromium).

Nothing is signed and no key is used. Steps:
  1. testnet, no wallet: peg, KPIs, queue, size chips; dry-runs (eth_call) from a real MUSD holder;
     pre-sign checks (hints, minNetDebt, max-fee guard, calldata); Contracts & calldata drawer
  2. depeg scenarios: $0.985 and $0.970 presets are labelled SIMULATION and use the live fee/queue math
  3. Borrower Defense via ?wallet= (front of the queue) and via the address form (a loan exposed in a depeg)
  4. mock EIP-1193 wallet: the max-fee guard blocks a send; then Redeem builds the tx and the exact
     eth_sendTransaction payload is replayed as eth_call against the live chain
  5. mainnet read-only view
  6. phone width (390 px): no horizontal scroll

Usage:  pip install playwright && playwright install chromium
        python3 tools/verify.py [URL] [SCREENSHOT_DIR]
        (default URL: file://<repo>/index.html, default SCREENSHOT_DIR: img/)
Env:    CHROMIUM=/path/to/chromium (optional), HTTPS_PROXY (optional)
Exit code 0 = every check passed.
"""
import os, sys, json
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = sys.argv[1] if len(sys.argv) > 1 else "file://" + os.path.join(ROOT, "index.html")
SHOTS = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "img")
os.makedirs(SHOTS, exist_ok=True)
SEP = "&" if "?" in URL else "?"
READY = ("document.querySelector('#queue tbody tr td') && !document.querySelector('#plan').innerText.includes('Loading')"
         " && document.querySelector('#checks').innerText.includes('Calldata')")
RESULT = "document.querySelector('#simres .okbox, #simres .errbox, #simres .warnbox')"
DEFENSE = "document.querySelector('#xray').innerText.includes('What moves you back') || document.querySelector('#xray').innerText.includes('Below 110%')"

MOCK = """
(() => {
  const RPC='https://rpc.test.mezo.org'; window.__sent=[];
  async function rpc(method, params){ const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}); const j=await r.json(); if(j.error){const e=new Error(j.error.message); e.code=j.error.code; e.data=j.error.data; throw e;} return j.result; }
  window.ethereum = { isMock:true, on(){}, removeListener(){},
    async request({method, params}) {
      const acct = window.__mockAccount;
      if (method==='eth_requestAccounts'||method==='eth_accounts') return [acct];
      if (method==='eth_chainId') return '0x7b7b';
      if (method==='wallet_switchEthereumChain') return null;
      if (method==='eth_sendTransaction') {
        const tx=params[0]; window.__sent.push(tx);
        await rpc('eth_call',[{from:tx.from,to:tx.to,data:tx.data,gas:tx.gas},'latest']);  // the exact payload executes
        window.__sentCallOk = true;
        const e=new Error('mock wallet: user rejected (no key in test)'); e.code=4001; throw e;
      }
      return rpc(method, params||[]);
    } };
})();
"""

def launch(pw):
    kw = {"args": ["--ignore-certificate-errors"]}
    if os.environ.get("CHROMIUM"): kw["executable_path"] = os.environ["CHROMIUM"]
    if os.environ.get("HTTPS_PROXY"): kw["proxy"] = {"server": os.environ["HTTPS_PROXY"], "bypass": "127.0.0.1,localhost"}
    return pw.chromium.launch(**kw)

def watch(pg, logs):
    pg.on("console", lambda m: logs.append(m.type + ": " + m.text))
    pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))

res, logs = {}, []
with sync_playwright() as pw:
    b = launch(pw)
    # 1) testnet desktop, no wallet
    pg = b.new_page(viewport={"width": 1280, "height": 900}, color_scheme="dark"); watch(pg, logs)
    pg.goto(URL); pg.wait_for_function(READY, timeout=120000); pg.wait_for_timeout(2500)
    res["status"] = pg.inner_text("#status"); res["signal"] = pg.inner_text("#signal")
    res["kpis"] = pg.inner_text("#kpis").replace("\n", " | ")
    res["chips"] = pg.inner_text("#chips").replace("\n", " ")
    res["queue_rows"] = pg.eval_on_selector_all("#queue tbody tr", "r=>r.length")
    holder = pg.evaluate("""async () => { const n = window.__pegdesk.net;
      const r = await fetch(`${n.api}/tokens/${n.MUSD}/holders`).then(x => x.json());
      const h = r.items.find(x => !x.address.is_contract && BigInt(x.value) >= 10n**22n); return h ? h.address.hash : null; }""")
    for amt in ["2500", "300"]:
        pg.fill("#amt", amt); pg.wait_for_timeout(2500)
        res["plan_" + amt] = pg.inner_text("#plan").replace("\n", " ")
        pg.click("#btnSim"); pg.wait_for_function(RESULT, timeout=60000)
        res["dryrun_" + amt] = pg.inner_text("#simres")
    pg.click("#chips .chip[data-full='1']"); pg.wait_for_timeout(2000)       # first "full" size
    pg.click("#btnSim"); pg.wait_for_function(RESULT, timeout=60000); pg.wait_for_timeout(500)
    res["dryrun_full_chip"] = pg.inner_text("#simres")
    res["presign_checks"] = pg.inner_text("#checks").replace("\n", " ")
    pg.screenshot(path=os.path.join(SHOTS, "hero.png"))
    pg.locator("#redeem").screenshot(path=os.path.join(SHOTS, "redeem-presign.png"))
    pg.evaluate("document.querySelector('#contracts').open = true"); pg.wait_for_timeout(300)
    res["contracts"] = pg.inner_text("#cbody")
    res["contracts_listed"] = pg.eval_on_selector_all("#cbody .crow b", "x=>x.map(e=>e.innerText)")
    pg.locator("#contracts").screenshot(path=os.path.join(SHOTS, "contracts.png"))
    pg.wait_for_function("!document.querySelector('#history tbody').innerText.includes('Loading')", timeout=60000)
    res["history"] = pg.inner_text("#hsum")
    # 2) depeg scenarios
    for s in ["0.985", "0.970"]:
        pg.click(f"#scen button[data-s='{s}']"); pg.wait_for_timeout(800)
        res["scenario_" + s] = pg.inner_text("#simcard").replace("\n", " ")
        res["scenario_signal_" + s] = pg.inner_text("#signal")
    pg.evaluate("window.scrollTo(0,0)"); pg.screenshot(path=os.path.join(SHOTS, "depeg-sim.png"))
    pg.click("#scen button[data-s='live']"); pg.wait_for_timeout(500)
    res["live_again_simcard_hidden"] = pg.evaluate("document.querySelector('#simcard').classList.contains('hide')")
    # 3) Borrower Defense: example "exposed in a depeg" via the form
    ex = pg.eval_on_selector_all("#xray [data-a]", "a=>a.map(x=>[x.innerText,x.dataset.a])")
    res["defense_examples"] = ex
    exposed = next((a for t, a in ex if "exposed" in t), ex[0][1] if ex else None)
    pg.fill("#defAddr", exposed); pg.click("#defform button"); pg.wait_for_function(DEFENSE, timeout=60000); pg.wait_for_timeout(1000)
    res["defense_exposed"] = pg.inner_text("#xray").replace("\n", " | ")
    pg.locator("#xraycard").screenshot(path=os.path.join(SHOTS, "defense.png"))
    pg.screenshot(path=os.path.join(SHOTS, "testnet-desktop.png"), full_page=True)
    first_loan = pg.evaluate("window.__pegdesk.S.troves.find(t => t.eligible).owner")
    pg.close()
    pg = b.new_page(viewport={"width": 1280, "height": 900}, color_scheme="dark"); watch(pg, logs)
    pg.goto(URL + SEP + "wallet=" + first_loan); pg.wait_for_function(READY, timeout=120000)
    pg.wait_for_function(DEFENSE, timeout=60000); pg.wait_for_timeout(1000)
    res["defense_front_via_param"] = pg.inner_text("#xray").replace("\n", " | ")
    pg.close()
    # 4) mock wallet: max-fee guard, then Connect + Redeem
    pg = b.new_page(viewport={"width": 1280, "height": 900}); watch(pg, logs)
    pg.add_init_script("window.__mockAccount='%s';" % holder + MOCK)
    pg.goto(URL); pg.wait_for_function(READY, timeout=120000)
    pg.click("#btnConnect"); pg.wait_for_function(DEFENSE + " || document.querySelector('#xray').innerText.includes('No open MUSD loan')", timeout=60000)
    pg.click("#chips .chip[data-full='1']"); pg.wait_for_timeout(1500)
    pg.fill("#maxfee", "0.50"); pg.wait_for_timeout(300)
    res["guard_check_low_cap"] = [l for l in pg.inner_text("#checks").split("\n") if "redemptionRate" in l]
    pg.click("#btnSend"); pg.wait_for_function(RESULT, timeout=90000)
    res["guard_send_result"] = pg.inner_text("#simres")
    res["guard_blocked_no_tx"] = pg.evaluate("window.__sent.length === 0")
    pg.fill("#maxfee", "1.00"); pg.wait_for_timeout(300)
    pg.click("#btnSend"); pg.wait_for_function("window.__sent.length > 0 && " + RESULT, timeout=90000); pg.wait_for_timeout(500)
    res["send_result"] = pg.inner_text("#simres")
    res["sent_tx"] = pg.evaluate("window.__sent.map(t=>({to:t.to,selector:t.data.slice(0,10)}))")
    res["sent_tx_eth_call_ok"] = pg.evaluate("!!window.__sentCallOk")
    pg.close()
    # 5) mainnet read-only
    pg = b.new_page(viewport={"width": 1280, "height": 900}, color_scheme="light"); watch(pg, logs)
    pg.goto(URL + SEP + "net=mainnet"); pg.wait_for_function(READY, timeout=120000); pg.wait_for_timeout(3000)
    res["mainnet_status"] = pg.inner_text("#status"); res["mainnet_signal"] = pg.inner_text("#signal")
    pg.wait_for_function("!document.querySelector('#history tbody').innerText.includes('Loading')", timeout=60000)
    res["mainnet_history"] = pg.inner_text("#hsum")
    pg.screenshot(path=os.path.join(SHOTS, "mainnet.png"))
    pg.close()
    # 6) phone width
    pg = b.new_page(viewport={"width": 390, "height": 844}, color_scheme="dark"); watch(pg, logs)
    pg.goto(URL + SEP + "scenario=0.97&wallet=" + first_loan); pg.wait_for_function(READY, timeout=120000); pg.wait_for_timeout(3000)
    pg.evaluate("document.querySelector('#contracts').open = true"); pg.wait_for_timeout(300)
    res["mobile_overflow_px"] = pg.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    pg.evaluate("window.scrollTo(0,0)"); pg.screenshot(path=os.path.join(SHOTS, "mobile.png"))
    pg.close()
    b.close()

res["console_errors"] = [l for l in logs if l.startswith(("error", "pageerror"))][:5]
need = ["MUSD token", "TroveManager", "SortedTroves", "HintHelpers", "BorrowerOperations", "PriceFeed", "MUSD/BTC pool"]
checks = {
    "full size dry-run passes": res["dryrun_full_chip"].startswith("Dry-run passed"),
    "pre-sign checks show hints, minNetDebt and fee guard": all(k in res["presign_checks"] for k in ["First redemption hint", "minNetDebt", "Max fee guard", "eth_call simulation"]),
    "drawer lists every contract": all(n in res["contracts_listed"] for n in need),
    "scenarios labelled SIMULATION": all("SIMULATION" in res["scenario_signal_" + s] for s in ["0.985", "0.970"]),
    "live is the default again": res["live_again_simcard_hidden"],
    "Borrower Defense renders": "musd redeemed before you" in res["defense_exposed"].lower() and "what moves you back" in res["defense_exposed"].lower(),
    "max-fee guard blocks the send": res["guard_blocked_no_tx"] and "max-fee guard" in res["guard_send_result"],
    "signed payload executes (eth_call replay)": res["sent_tx_eth_call_ok"],
    "no horizontal scroll at 390 px": res["mobile_overflow_px"] <= 0,
    "no console errors": not res["console_errors"],
}
res["CHECKS"] = checks
res["PASS"] = all(checks.values())
print(json.dumps(res, indent=1))
sys.exit(0 if res["PASS"] else 1)
