# Bulk Lighthouse & Core Web Vitals Auditor

Run Google Lighthouse on a list of pages (up to 500 URLs per run) and get one clean row per page:
the four Lighthouse scores, lab Core Web Vitals, the top 5 fixes with estimated savings, and the
failing accessibility and SEO checks. A run summary shows site-wide averages, the worst pages and
the problems that show up on the most pages.

You don't need a Google API key or any PageSpeed Insights quota. Lighthouse 13.5 runs on a headless
Chrome inside the Actor.

## Who it is for

- **SEO and web agencies:** audit a client's whole site from its sitemap, then send the CSV.
- **Developers:** check a release across many templates (home, category, product, blog) on mobile and desktop.
- **Site owners:** schedule a weekly run and watch the score changes with "Compare with previous run".

## What you get for each page

| Group | Fields |
|---|---|
| Scores (0-100) | `performanceScore`, `accessibilityScore`, `bestPracticesScore`, `seoScore` (and `agenticBrowsingScore` if you choose that category) |
| Lab metrics | `lcpMs`, `cls`, `tbtMs` (lab stand-in for INP), `fcpMs`, `ttfbMs`, `speedIndexMs`, `ttiMs` |
| Ratings | `lcpRating`, `clsRating`, `tbtRating`, `fcpRating`, `ttfbRating`, each `good` / `needs-improvement` / `poor`, and `labCoreWebVitals` (the worst of LCP, CLS and TBT) |
| Fixes | `opportunities`: the top 5 failing performance audits with `estSavingsMs`, `estTbtSavingsMs` and `estSavingsKb`. `topOpportunities` holds the same list as one text column for spreadsheets. |
| Issues | `accessibilityIssues`, `seoIssues`, `bestPracticesIssues`: the failing audits (id and title) |
| Page facts | `finalUrl` (after redirects), `httpStatus`, `totalByteWeightKb`, `requestCount`, `domSize`, `mainThreadWorkMs`, `jsExecutionMs` |
| Run facts | `status` (`success` / `failed`), `errorCode`, `error`, `attempts`, `auditDurationSecs`, `lighthouseVersion`, `benchmarkIndex`, `runWarnings`, `reportUrl` (when HTML reports are on) |
| History (optional) | `previousAuditedAt`, `performanceScoreDelta`, `lcpMsDelta`, `clsDelta`, `tbtMsDelta`, and the other `...Delta` fields |

Three dataset views are ready to use:
- **Overview:** flat columns, best for CSV or Excel.
- **Metrics and ratings**
- **Fixes and issues**

## Input example

```json
{
    "startUrls": [
        { "url": "https://www.example.com" },
        { "url": "https://www.example.com/pricing" }
    ],
    "sitemapUrls": ["https://www.example.com/sitemap.xml"],
    "maxUrls": 200,
    "device": "both",
    "categories": ["performance", "accessibility", "best-practices", "seo"],
    "throttling": "default",
    "timeoutSecs": 90,
    "maxRetries": 1,
    "compareWithPreviousRun": true,
    "saveHtmlReports": false
}
```

**Ways to give URLs:**
- Type them into the URL list.
- Upload or link a text or CSV file with one URL per line.
- Point to a sitemap or a sitemap index.
- Through the API, send `"urls": ["a.com", "b.com"]`.

URLs without `https://` get it added, and duplicates are removed.

**Main options:**

| Option | Default | What it does |
|---|---|---|
| `device` | `mobile` | `mobile`, `desktop` or `both`. `both` runs 2 audits per URL. |
| `throttling` | `default` | `default` matches PageSpeed Insights: slow 4G plus 4x CPU slowdown on mobile, broadband on desktop. You can also pick slow 4G, 3G, broadband or none. |
| `fastMode` | `true` | Skips the "Reduce unused CSS" audit, the slowest single step. Scores are unchanged. |
| `concurrency` | `0` (auto) | Runs one audit per CPU core. Apify gives 1 core per 4 GB of memory. |
| `timeoutSecs` | `90` | Hard limit per URL. A page that hangs is stopped and marked as failed. |
| `maxRetries` | `1` | Retries temporary failures only, such as a browser crash or a page that never painted. |
| `compareWithPreviousRun` | `false` | Saves the latest scores per URL and device in a named key-value store, so the next run can report the changes. |
| `saveHtmlReports` | `false` | Also saves the full Lighthouse HTML report for each page. |

## Output example

This is a real item from our test run. It is shortened: two lists are trimmed.

```json
{
  "url": "https://www.python.org/",
  "device": "mobile",
  "status": "success",
  "errorCode": null,
  "attempts": 1,
  "auditDurationSecs": 11.5,
  "finalUrl": "https://www.python.org/",
  "httpStatus": 200,
  "performanceScore": 66,
  "accessibilityScore": 75,
  "bestPracticesScore": 100,
  "seoScore": 92,
  "lcpMs": 3567,
  "cls": 0.0001,
  "tbtMs": 942,
  "fcpMs": 2507,
  "ttfbMs": 42,
  "speedIndexMs": 2708,
  "lcpRating": "needs-improvement",
  "clsRating": "good",
  "tbtRating": "poor",
  "labCoreWebVitals": "poor",
  "totalByteWeightKb": 463.8,
  "requestCount": 24,
  "topOpportunities": "Minimize main-thread work (3.8 s) | Reduce JavaScript execution time (1.5 s) | Reduce unused JavaScript (Est savings of 59 KiB) | Render-blocking requests (Est savings of 560 ms) | Minify CSS (Est savings of 24 KiB)",
  "opportunities": [
    { "id": "unused-javascript", "title": "Reduce unused JavaScript", "displayValue": "Est savings of 59 KiB", "estSavingsMs": 570, "estTbtSavingsMs": 0, "estSavingsKb": 59.2 },
    { "id": "render-blocking-insight", "title": "Render-blocking requests", "displayValue": "Est savings of 560 ms", "estSavingsMs": 550, "estTbtSavingsMs": 0, "estSavingsKb": null }
  ],
  "accessibilityIssues": [
    { "id": "aria-required-parent", "title": "`[role]`s are not contained by their required parent element" }
  ],
  "seoIssues": [{ "id": "link-text", "title": "Links do not have descriptive text" }],
  "lighthouseVersion": "13.5.0",
  "benchmarkIndex": 1388
}
```

A failed page still gets a row, and **failed pages are not charged**:

```json
{ "url": "https://www.example.com/old-page", "device": "mobile", "status": "failed", "errorCode": "ERRORED_DOCUMENT_REQUEST", "httpStatus": 404, "error": "Lighthouse was unable to reliably load the page you requested. ... (Status code: 404)", "attempts": 1 }
```

### Run summary

The key-value store record `SUMMARY` holds, for each device:
- averages and medians of every score and metric
- the count of pages that are good / needs-improvement / poor on lab Core Web Vitals
- the 10 worst pages by performance score
- the opportunities and accessibility and SEO issues found on the most pages (for example, "Render-blocking requests: 37 of 50 pages")
- a list of failures

Turn on "Add summary row to dataset" if you also want the summary as the last row of the dataset.

## Pricing

**Pay per event: $0.015 per page audited ($15 per 1,000 audits).** The price includes the
Apify platform usage (compute) of the run.

- Only successful audits are charged. Invalid URLs, DNS errors, 4xx/5xx pages, timeouts and crashes are recorded but not charged.
- With `device: both`, each URL counts as 2 audits (one mobile, one desktop).
- Apify also charges a tiny standard Actor start fee ($0.00005 per GB of run memory, for example $0.0002 at the default 4 GB).
- The Actor respects your "Max cost per run" limit. It does not start an audit it could not charge, and it reports in the summary that it stopped because of the limit.

**Examples:**
- 100 URLs on mobile: about $1.50
- 500 URLs on both devices (1,000 audits): about $15

## How long it takes

We measured this on our own machine, not on Apify. One audit used one CPU core. Speed on Apify
will differ.

| Page type | Time per audit (1 core) |
|---|---|
| Light pages (example.com, gov.uk, python.org, MDN, nodejs.org, apache.org, Wikipedia) | about 12 s |
| Heavy pages (bbc.com, github.com, w3.org) | 30-65 s |
| Mix of all 10 sites, mobile + desktop | 21 s average, 13 s median |

At the default 4 GB (1 core), expect about **3 to 5 audits per minute**. 8 GB gives 2 cores and
roughly doubles throughput. The price per audit is the same.

## Accuracy and limits (please read)

- **This is lab data, not real-user (field) data.** The numbers come from one simulated page load, like Lighthouse in Chrome DevTools or the "Diagnose performance issues" part of PageSpeed Insights. They are not your CrUX / Search Console Core Web Vitals.
- **INP can't be measured in a lab page load.** We report Total Blocking Time (TBT) as the usual lab stand-in.
- **Scores vary between runs**, as with any Lighthouse tool, and more on slower or busier machines. In our tests python.org's mobile performance score ranged from 66 to 91 over 7 runs, and Wikipedia's from 25 to 77 over 4 runs, with different CPU setups, and between two back-to-back runs on the same machine most pages moved by 0-13 points. If a decision depends on a few points, audit the page several times and compare medians.
- **Scores can differ from PageSpeed Insights.** PSI runs on Google's hardware. We report `benchmarkIndex`, Lighthouse's own CPU-speed estimate of the machine, so you can see how fast the audit machine was. For the most stable results, keep concurrency on auto (one audit per core).
- **Pages must be publicly reachable** from Apify's servers. There is no login, cookie or custom-header support in this version.
- **Some sites block cloud servers or show bot challenges.** These pages may fail or get audited as the challenge page. Check `finalUrl`, `httpStatus` and `runWarnings`.
- **Limit: 500 unique URLs per run.** Start several runs for bigger sites.
- **Fast mode** (on by default) skips the "Reduce unused CSS" audit. That audit does not affect any score. Turn fast mode off if you need it.

## FAQ

**Do I need a Google API key?**
No. Lighthouse runs inside the Actor. There is no PageSpeed Insights API quota to manage.

**Isn't the PageSpeed Insights API free?**
Yes. If you are comfortable getting an API key and writing a script that handles quotas, retries and CSV output, it is a good free option. This Actor is for people who want a URL list or sitemap in, and a clean table and summary out, without writing code.

**Can I monitor a site every week?**
Yes. Create an Apify schedule for a saved task with `compareWithPreviousRun: true`. Each row then shows the change since the last audit, such as `performanceScoreDelta: -12`. Use a different `historyStoreName` for each client to keep their histories apart.

**How do I get a CSV?**
Open the run's dataset, choose the **Overview** view, then click Export and choose CSV. Every column in that view is a flat value.

**Why did a page fail?**
Look at `errorCode`:
- `ERRORED_DOCUMENT_REQUEST`: the page returned 4xx or 5xx (`httpStatus` has the code).
- `DNS_FAILURE`: the domain does not resolve.
- `AUDIT_TIMEOUT`: the page took longer than `timeoutSecs`.
- `CHROME_INTERSTITIAL_ERROR`: a certificate or connection error page.
- `NO_FCP`: the page never painted.

Failed pages are not charged.

**What data does the Actor keep?**
Only what you see in your own run storage:
- the dataset
- the `SUMMARY` record
- optional HTML reports
- with "Compare with previous run", one small record of scores per URL in a named key-value store in your account

Nothing is sent anywhere else.

**Which Lighthouse version?**
13.5.0 (in `lighthouseVersion`). It runs on the Chrome version that ships in Apify's Node + Chrome base image.

## Feedback

Found a page that audits wrongly, or need a field that is missing? Open an issue on the Actor's
Issues tab and include the run ID.

This Actor uses [Lighthouse](https://github.com/GoogleChrome/lighthouse) (Apache-2.0). It is not affiliated with or endorsed by Google.
