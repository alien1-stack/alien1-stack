# Pricing math: Bulk Lighthouse & Core Web Vitals Auditor

This is an internal note, not for the Store page. Measured 21 Oct 2026 on a local machine; nothing
was run on Apify yet.

## Rules this has to satisfy

- **Payout formula:** `profit = 0.8 × revenue − platform usage cost`. If an Actor's monthly profit is negative, it counts as $0.
  - Source: docs.apify.com/platform/actors/publishing/monetize/pay-per-event, read 21 Oct 2026.
- **Under pay-per-event (PPE), the developer pays the platform usage.**
  - Users on Apify's free plan don't count: their revenue and costs are both left out of profit.
- **Compute unit (CU) = 1 GB of memory for 1 hour.**
  - Unit cost by discount tier: FREE/BRONZE $0.20, SILVER $0.16, GOLD $0.13.
  - "If you don't implement tiered discounts, the unit prices for the FREE tier apply". So we use **$0.20/CU**, and $0.30/CU as a stress test.
  - Source: docs.apify.com/platform/actors/publishing/monetize/pricing-and-costs.
- **CPU follows memory:** 4096 MB = 1 CPU core (docs.apify.com/platform/actors/running/usage-and-resources).
  - Lighthouse is CPU-bound, so **cost per audit is about 4 GB × core-seconds per audit**, whatever the memory setting. Adding memory only adds parallel cores.
- **Team rule (apify_gaps.md):** the price must be at least 2× the measured compute cost.

## Measurements (local, `scripts/bench.mjs`)

**Test set:** 10 public sites × mobile + desktop = 20 audits per run.
- Sites: example.com, en.wikipedia.org, gov.uk, python.org, developer.mozilla.org, w3.org, nodejs.org, bbc.com, github.com, apache.org.
- Lighthouse 13.5.0, `default` throttling, all 4 categories.
- Raw data is in `../test_output/*/dataset.json` and `bench.json`.

| Run | Setup | Wall s per audit | CPU s per audit | Mean / median / p90 / max per audit (s) | Peak memory |
|---|---|---|---|---|---|
| `run_1core_c1_fullmode` | 1 core (taskset), concurrency 1, fast mode off | **22.2** | 21.2 | 22.0 / 12.9 / 40.4 / 66.8 | 1,685 MB whole run (PSS) |
| `run_1core_c1_fastmode` | 1 core, concurrency 1, fast mode on | **20.9** | 19.3 | 20.8 / 13.2 / 40.9 / 53.1 | 1,868 MB |
| `run_2core_c2_fastmode` | 2 cores, concurrency 2 | **9.8** (2 in parallel) | 17.4 | 18.9 / 12.9 / 36.2 / 45.6 | 2,634 MB |
| `docker_4gb_1cpu` | Apify base image, Google Chrome 155, `--memory=4g --cpus=1` | n/a | n/a | 11.5 / 11.9 / 12.7 / 12.7 (3 light sites only) | 820 MB |
| `docker_4gb_1cpu_10sites` | same container, all 10 sites, auto concurrency (→1) | **19.8** (incl. container start + summary) | n/a | 19.6 / 13.2 / 47.0 / 50.3 | 1,741 MB |

The container run is the closest thing to a real Apify run at the default 4 GB, and it agrees with the host runs: about 20 s per audit on this mix.

**Split by page weight** (1 core, fast mode):
- Light pages (7 sites): **12.2 s** per audit.
- Heavy pages (bbc, github, w3): **40.7 s** per audit.

**Memory per audit** (Node worker + Chrome, PSS): median 750-930 MB, max 1.8 GB (github.com).
- So 4 GB is safe for 1 audit at a time, and 8 GB for 2.
- The Actor caps concurrency at about 1.9 GB per parallel audit.

**Fast mode:**
- On github.com (1 core), skipping `unused-css-rules` cut one audit from 51.4 s to 30.6 s.
- On the 20-audit mix it saved about 6% (network noise is large).

**Caveat:** this machine's Lighthouse `benchmarkIndex` was about 1,000-1,600. Apify's CPUs may be slower, so all costs below get a **+30% hardware margin**.

## Cost per audit

Formula: `CU per audit = 4 GB × seconds per core per audit / 3600`.

| Scenario | Core-seconds | CU per audit | $ per 1k at $0.20/CU | $ per 1k at $0.30/CU |
|---|---|---|---|---|
| Light pages, as measured | 12.2 | 0.0136 | $2.71 | $4.07 |
| Mixed set, as measured | 20.9 | 0.0232 | **$4.64** | $6.97 |
| **Mixed set + 30% hardware margin (planning case)** | 27.2 | 0.0302 | **$6.04** | $9.07 |
| Heavy pages + 30% margin (worst realistic) | 52.9 | 0.0588 | $11.76 | $17.64 |

**Other costs (per 1,000 audits):**
- Dataset writes: $0.005.
- State and history key-value writes: about $0.05-0.10.
- HTML reports (optional, about 0.5-1 MB each): a few cents of storage and transfer.
- **Failed audits are not charged but still use compute.** We assume 3% of URLs fail after about 30 s on average, which adds about 5%.
  - Timeouts are not retried, to cap that waste.
- **Total planning cost: about $6.5 per 1,000 audits.**

**Per-run overhead:** container start, Chrome warm-up and the summary take about 5-10 s at 4 GB, which is about 0.008 CU or $0.0017.
- This is partly covered by Apify's synthetic `apify-actor-start` event: $0.00005 per GB, so $0.0002 at 4 GB.
- It is fully covered once a run has 1 or more paid audits.

## Price decision

`page-audited` event, charged only for a successful audit.

| Price per 1k | Net (×0.8) | Profit/1k (planning cost $6.5) | Net ÷ cost | Heavy-only sites ($12.4 incl. extras) |
|---|---|---|---|---|
| $10 | $8.00 | $1.50 | 1.2× | **loss** |
| $12 | $9.60 | $3.10 | 1.5× | **loss** |
| **$15** | **$12.00** | **$5.50** | **1.8× planning / 2.6× measured** | about break-even |
| $20 | $16.00 | $9.50 | 2.5× | profit |

**Recommendation: launch at $0.015 per `page-audited` ($15 per 1,000), with the default `apify-actor-start` event ($0.00005).**
- It sits at the top of the $10-15 target band and is the only price in the band that clears the 2× rule against measured cost.
- It also survives the +30% hardware margin with a profit.
- For comparison, the PageSpeed-API-based leader charges $100 per 1,000. Free usage-billed competitors make the user pay compute, which comes to roughly $5-7 per 1,000 by our measurements.

**Revisit after the first ~2,000 paid audits:**
1. Read the real platform cost per run from the Apify console (run detail → usage).
2. If the actual cost is $4.5 per 1,000 or less, drop to **$12 per 1,000** to compete.
3. If it is more than $7.5 per 1,000, raise the price to $20, or make fast mode stricter by also skipping image-element gathering. That would change best-practices coverage, so it needs README changes.

## Guard rails already in the code and config

- **`defaultRunOptions.memoryMbytes = 4096`, `minMemoryMbytes = 2048`, `maxMemoryMbytes = 8192`.** At 16-32 GB, a 1-URL run would cost more than it earns (32 GB × ~23 s ≈ 0.2 CU ≈ $0.04 against $0.012 net), so memory is capped at 8 GB.
- **Auto concurrency** = one audit per core (memory ÷ 4 GB), capped by memory (about 1.9 GB per audit). This keeps cost per audit flat at any memory size.
  - A user who forces `concurrency: 1` at 8 GB doubles our cost per audit to about $9.3 per 1,000 measured, which is still under the $12 net.
- **No retry on timeouts or permanent errors** (DNS, 4xx/5xx, certificate). Only crashes and no-paint errors get 1 retry.
- **Spending limit respected:** an audit only starts if `calculateMaxEventChargeCountWithinLimit` minus in-flight audits is greater than 0.
  - We tested that the run stops when the limit is 0.
  - Locally the SDK prices every event at $1 for limit maths (charging.js `calculateEventPrice`), so the exact cut-off can only be fully checked on the platform.
- **Charging is atomic with the result:** `Actor.pushData(item, 'page-audited')`. A user is never charged for a row they don't get, and a run that migrates does not re-audit or re-charge finished URLs (`AUDITOR_STATE`).
