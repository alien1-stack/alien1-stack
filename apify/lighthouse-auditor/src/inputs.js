/**
 * Input normalisation: URL lists, remote URL lists (requestsFromUrl), sitemaps.
 */
import { log } from 'apify';

export const HARD_MAX_URLS = 500;
export const ALL_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo', 'agentic-browsing'];
const FETCH_TIMEOUT_MS = 20000;
const MAX_REMOTE_BYTES = 10 * 1024 * 1024;

const clampInt = (v, min, max, dflt) => {
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(max, Math.max(min, n));
};

/** Returns a normalised http(s) URL string, or null if the value isn't a usable URL. */
export function normalizeUrl(raw) {
    if (typeof raw !== 'string') return null;
    let s = raw.trim();
    if (!s || s.startsWith('#')) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
    try {
        const u = new URL(s);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        if (!u.hostname || !u.hostname.includes('.') && u.hostname !== 'localhost') return null;
        u.hash = '';
        return u.href;
    } catch {
        return null;
    }
}

async function fetchText(url) {
    const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; BulkLighthouseAuditor/0.1; +https://apify.com)' },
        redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_REMOTE_BYTES) throw new Error(`File too large (${len} bytes)`);
    const text = await res.text();
    return text.slice(0, MAX_REMOTE_BYTES);
}

const URL_REGEX = /https?:\/\/[^\s"'<>,;]+/gi;

function decodeXml(s) {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** Reads a sitemap or sitemap index (one level of nesting, plain XML only). */
export async function readSitemap(sitemapUrl, limit) {
    const out = [];
    const queue = [sitemapUrl];
    const seen = new Set();
    let fetched = 0;
    while (queue.length && out.length < limit && fetched < 50) {
        const current = queue.shift();
        if (seen.has(current)) continue;
        seen.add(current);
        fetched++;
        let xml;
        try {
            xml = await fetchText(current);
        } catch (err) {
            log.warning(`Could not read sitemap ${current}: ${err.message}`);
            continue;
        }
        const isIndex = /<sitemapindex[\s>]/i.test(xml);
        const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeXml(m[1]));
        if (isIndex) {
            queue.push(...locs);
        } else {
            for (const loc of locs) {
                out.push(loc);
                if (out.length >= limit) break;
            }
        }
    }
    return out;
}

/**
 * @returns {{urls: string[], invalid: string[], options: object}}
 */
export async function parseInput(input = {}) {
    const maxUrls = clampInt(input.maxUrls, 1, HARD_MAX_URLS, HARD_MAX_URLS);
    const rawUrls = [];

    // startUrls: Apify requestListSources format ({url} / {requestsFromUrl}) or plain strings.
    for (const item of input.startUrls || []) {
        if (typeof item === 'string') rawUrls.push(item);
        else if (item?.url) rawUrls.push(item.url);
        else if (item?.requestsFromUrl) {
            try {
                const text = await fetchText(item.requestsFromUrl);
                rawUrls.push(...(text.match(URL_REGEX) || []));
            } catch (err) {
                log.warning(`Could not read URL list ${item.requestsFromUrl}: ${err.message}`);
            }
        }
    }
    // API convenience: "urls": ["a.com", "b.com"]
    for (const u of input.urls || []) rawUrls.push(u);

    for (const sm of input.sitemapUrls || []) {
        const smUrl = normalizeUrl(typeof sm === 'string' ? sm : sm?.url);
        if (!smUrl) continue;
        const found = await readSitemap(smUrl, maxUrls);
        log.info(`Sitemap ${smUrl}: ${found.length} URLs`);
        rawUrls.push(...found);
    }

    const urls = [];
    const invalid = [];
    const seen = new Set();
    for (const raw of rawUrls) {
        const u = normalizeUrl(raw);
        if (!u) {
            if (typeof raw === 'string' && raw.trim()) invalid.push(raw.trim().slice(0, 500));
            continue;
        }
        if (seen.has(u)) continue;
        seen.add(u);
        urls.push(u);
    }
    const truncated = Math.max(0, urls.length - maxUrls);
    urls.length = Math.min(urls.length, maxUrls);

    const device = ['mobile', 'desktop', 'both'].includes(input.device) ? input.device : 'mobile';
    let categories = Array.isArray(input.categories) ? input.categories.filter((c) => ALL_CATEGORIES.includes(c)) : [];
    if (categories.length === 0) categories = ['performance', 'accessibility', 'best-practices', 'seo'];
    const throttling = ['default', 'mobileSlow4G', 'mobileRegular3G', 'desktopDense4G', 'none'].includes(input.throttling)
        ? input.throttling : 'default';

    return {
        urls,
        invalid,
        truncated,
        options: {
            devices: device === 'both' ? ['mobile', 'desktop'] : [device],
            categories,
            throttling,
            concurrency: clampInt(input.concurrency, 0, 4, 0),
            timeoutSecs: clampInt(input.timeoutSecs, 30, 300, 90),
            maxRetries: clampInt(input.maxRetries, 0, 3, 1),
            fastMode: input.fastMode !== false,
            saveHtmlReports: Boolean(input.saveHtmlReports),
            compareWithPreviousRun: Boolean(input.compareWithPreviousRun),
            historyStoreName: typeof input.historyStoreName === 'string' && /^[a-zA-Z0-9-]{1,63}$/.test(input.historyStoreName)
                ? input.historyStoreName : 'lighthouse-auditor-history',
            pushSummaryToDataset: Boolean(input.pushSummaryToDataset),
            measureMemory: Boolean(input.measureMemory),
        },
    };
}
