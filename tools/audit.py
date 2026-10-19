#!/usr/bin/env python3
"""Site & docs gap audit. Usage: python3 -I audit.py https://example.com [extra_root ...]
Crawls same-site pages (depth 2, max 60 pages), checks every link it finds, and reports
reproducible gaps only: broken internal/external links, expired Discord invites,
placeholder text, stale copyright, missing OG tags. Output: markdown on stdout."""
import sys, re, json, time, html
import urllib.request, urllib.parse, urllib.error
from collections import OrderedDict

UA = "Mozilla/5.0 (compatible; day1onearth-audit/1.0)"
MAX_PAGES, DEPTH, TIMEOUT = 60, 2, 15
PLACEHOLDERS = [r"coming soon", r"\bTBD\b", r"lorem ipsum", r"\[TBD\]", r"company\.site", r"example\.com",
                r"your-?domain", r"insert .{0,20} here", r"placeholder", r"under construction"]

def get(url, head=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"}, method="HEAD" if head else "GET")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = "" if head else r.read(400_000).decode("utf-8", "ignore")
            return r.status, r.geturl(), body, r.headers.get("content-type", "")
    except urllib.error.HTTPError as e:
        return e.code, url, "", ""
    except Exception as e:
        return 0, url, "", str(e)

def status(url):
    s, final, _, _ = get(url, head=True)
    if s in (0, 403, 405, 429):  # some hosts reject HEAD
        s, final, _, _ = get(url)
    return s, final

def links_in(base, body):
    out = []
    for m in re.finditer(r'<a\b[^>]*?href=["\']([^"\'#]+)["\']', body, re.I):
        # skip anchors inside HTML comments
        start = m.start()
        if body.rfind("<!--", 0, start) > body.rfind("-->", 0, start):
            continue
        href = html.unescape(m.group(1).strip())
        if href.startswith(("mailto:", "tel:", "javascript:")):
            if href.startswith("mailto:"): out.append(("mailto", href))
            continue
        full = urllib.parse.urljoin(base, href)
        if not full.startswith(("http://", "https://")):
            continue
        out.append(("link", full))
    return out

def same_site(u, roots):
    h = urllib.parse.urlparse(u).netloc.lower()
    return any(h == r or h.endswith("." + r) for r in roots)

def main():
    start = sys.argv[1].rstrip("/")
    roots = [urllib.parse.urlparse(start).netloc.lower().removeprefix("www.")]
    for extra in sys.argv[2:]:
        roots.append(urllib.parse.urlparse(extra).netloc.lower().removeprefix("www."))
    seen, queue, pages = OrderedDict(), [(start, 0)] + [(e, 0) for e in sys.argv[2:]], {}
    findings = []
    while queue and len(pages) < MAX_PAGES:
        url, d = queue.pop(0)
        if url in seen: continue
        seen[url] = True
        s, final, body, ctype = get(url)
        pages[url] = (s, final, body)
        if s != 200 or "html" not in ctype: continue
        if d == 0:
            if not re.search(r'property=["\']og:title["\']', body, re.I):
                findings.append(("Missing link-preview tags", url, "no og:title meta tag; shared links show no card"))
            yr = re.findall(r'(?:©|&copy;|\(c\))\s*(20\d\d)', body)
            if yr and max(map(int, yr)) <= 2024:
                findings.append(("Stale copyright", url, f"footer shows © {max(yr)}"))
        text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", body, flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", " ", text); text = re.sub(r"\s+", " ", text)
        for p in PLACEHOLDERS:
            for m in re.finditer(p, text, re.I):
                ctx = text[max(0, m.start() - 60): m.end() + 60].strip()
                findings.append(("Placeholder text", url, f'"{ctx}"')); break
        for kind, l in links_in(final, body):
            if kind == "mailto":
                if re.search(r"company\.site|example\.com|yourdomain", l): findings.append(("Placeholder email", url, l))
                continue
            if l in seen: continue
            if same_site(l, roots) and d < DEPTH and not re.search(r"\.(png|jpg|svg|pdf|zip|css|js)$", l, re.I):
                queue.append((l, d + 1))
            else:
                seen[l] = True
                m = re.search(r"discord\.(?:gg|com/invite)/([A-Za-z0-9]+)", l)
                if m:
                    sc, _, b, _ = get(f"https://discord.com/api/v10/invites/{m.group(1)}")
                    if '"code": 50270' in b or "Invite is expired" in b or sc == 404:
                        findings.append(("Expired Discord invite", url, l))
                    continue
                sc, _ = status(l)
                if sc in (404, 410) or sc == 0:
                    findings.append(("Broken link" if same_site(l, roots) else "Broken external link", url, f"{l} → HTTP {sc or 'unreachable'}"))
            time.sleep(0.05)
    # dedupe
    uniq = list(OrderedDict(((k, p, v), None) for k, p, v in findings).keys())
    print(f"# Gap audit — {start}\n\nPages crawled: {len(pages)} · Links checked: {len(seen)} · Findings: {len(uniq)}\n")
    if not uniq: print("No reproducible gaps found at depth 2."); return
    for kind in sorted(set(k for k, _, _ in uniq)):
        print(f"\n## {kind}")
        for k, p, v in uniq:
            if k == kind: print(f"- on `{p}` → {v}")
    json.dump(uniq, open("last_findings.json", "w"), indent=1)

if __name__ == "__main__":
    main()
