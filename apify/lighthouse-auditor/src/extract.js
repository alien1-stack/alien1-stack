/**
 * Turns a full Lighthouse result (LHR, ~0.5-2 MB) into a compact, flat-ish record
 * that is safe to push to an Apify dataset and easy to export as CSV.
 */

// Lab thresholds. LCP/CLS/FCP/TTFB follow web.dev's Core Web Vitals guidance.
// TBT is a lab proxy for INP (INP needs real user interaction and can't be measured
// in a single navigation), using Lighthouse's own mobile scoring thresholds.
export const THRESHOLDS = {
    lcpMs: [2500, 4000],
    cls: [0.1, 0.25],
    tbtMs: [200, 600],
    fcpMs: [1800, 3000],
    ttfbMs: [800, 1800],
};

export function rate(value, [good, poor]) {
    if (value === null || value === undefined || Number.isNaN(value)) return null;
    if (value <= good) return 'good';
    if (value <= poor) return 'needs-improvement';
    return 'poor';
}

const round = (v, digits = 0) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    const f = 10 ** digits;
    return Math.round(v * f) / f;
};

const score100 = (cat) => (cat && typeof cat.score === 'number' ? Math.round(cat.score * 100) : null);

const numeric = (audits, id) => {
    const a = audits[id];
    return a && typeof a.numericValue === 'number' ? a.numericValue : null;
};

/** Top-N performance opportunities, ranked by estimated time savings. */
export function extractOpportunities(lhr, limit = 5) {
    const perf = lhr.categories?.performance;
    if (!perf) return [];
    const audits = lhr.audits || {};
    const out = [];
    for (const ref of perf.auditRefs || []) {
        if (ref.group !== 'insights' && ref.group !== 'diagnostics') continue;
        const a = audits[ref.id];
        if (!a || typeof a.score !== 'number' || a.score >= 0.9) continue;
        if (a.scoreDisplayMode === 'informative' || a.scoreDisplayMode === 'notApplicable') continue;
        const ms = a.metricSavings || {};
        const details = a.details || {};
        // Load-time savings (FCP/LCP) and main-thread savings (TBT) are reported separately.
        const loadMs = Math.max(ms.LCP || 0, ms.FCP || 0, details.overallSavingsMs || 0);
        const tbtMs = ms.TBT || 0;
        const bytes = details.overallSavingsBytes || 0;
        const cls = ms.CLS || 0;
        if (loadMs <= 0 && tbtMs <= 0 && bytes <= 0 && cls <= 0) continue;
        out.push({
            id: ref.id,
            title: a.title,
            displayValue: a.displayValue ? String(a.displayValue).replace(/ /g, ' ') : null,
            estSavingsMs: round(loadMs),
            estTbtSavingsMs: round(tbtMs),
            estSavingsKb: bytes ? round(bytes / 1024, 1) : null,
            estClsSavings: cls ? round(cls, 3) : null,
            score: a.score,
        });
    }
    out.sort((x, y) => (y.estSavingsMs + y.estTbtSavingsMs) - (x.estSavingsMs + x.estTbtSavingsMs)
        || (y.estSavingsKb || 0) - (x.estSavingsKb || 0));
    return out.slice(0, limit);
}

/** Failing weighted audits of a pass/fail category (accessibility, seo, best-practices). */
export function extractFailedAudits(lhr, categoryId, limit = 15) {
    const cat = lhr.categories?.[categoryId];
    if (!cat) return null;
    const audits = lhr.audits || {};
    return (cat.auditRefs || [])
        .filter((ref) => ref.weight > 0)
        .map((ref) => ({ ref, a: audits[ref.id] }))
        .filter(({ a }) => a && typeof a.score === 'number' && a.score < 1)
        .sort((x, y) => y.ref.weight - x.ref.weight)
        .slice(0, limit)
        .map(({ ref, a }) => ({ id: ref.id, title: a.title }));
}

function mainDocumentStatus(lhr) {
    const items = lhr.audits?.['network-requests']?.details?.items;
    if (!Array.isArray(items)) return { httpStatus: null, requestCount: null };
    const target = lhr.mainDocumentUrl || lhr.finalDisplayedUrl;
    const doc = items.find((i) => i.url === target) || items.find((i) => i.resourceType === 'Document');
    return { httpStatus: doc?.statusCode ?? null, requestCount: items.length };
}

/**
 * @param {object} lhr Lighthouse result
 * @returns {object} compact result (no URL/device/status fields; the caller adds them)
 */
export function extractCompact(lhr) {
    const audits = lhr.audits || {};
    const cats = lhr.categories || {};
    const lcpMs = round(numeric(audits, 'largest-contentful-paint'));
    const cls = round(numeric(audits, 'cumulative-layout-shift'), 4);
    const tbtMs = round(numeric(audits, 'total-blocking-time'));
    const fcpMs = round(numeric(audits, 'first-contentful-paint'));
    const speedIndexMs = round(numeric(audits, 'speed-index'));
    const ttfbMs = round(numeric(audits, 'server-response-time'));
    const ttiMs = round(numeric(audits, 'interactive'));

    const lcpRating = rate(lcpMs, THRESHOLDS.lcpMs);
    const clsRating = rate(cls, THRESHOLDS.cls);
    const tbtRating = rate(tbtMs, THRESHOLDS.tbtMs);
    let labCoreWebVitals = null;
    if (lcpRating && clsRating && tbtRating) {
        const r = [lcpRating, clsRating, tbtRating];
        labCoreWebVitals = r.includes('poor') ? 'poor' : r.includes('needs-improvement') ? 'needs-improvement' : 'good';
    }

    const opportunities = extractOpportunities(lhr, 5);
    const { httpStatus, requestCount } = mainDocumentStatus(lhr);
    const totalBytes = numeric(audits, 'total-byte-weight');
    const domSize = numeric(audits, 'dom-size-insight') ?? numeric(audits, 'dom-size');

    return {
        finalUrl: lhr.finalDisplayedUrl || lhr.mainDocumentUrl || null,
        httpStatus,

        performanceScore: score100(cats.performance),
        accessibilityScore: score100(cats.accessibility),
        bestPracticesScore: score100(cats['best-practices']),
        seoScore: score100(cats.seo),
        agenticBrowsingScore: score100(cats['agentic-browsing']),

        lcpMs,
        cls,
        tbtMs,
        fcpMs,
        ttfbMs,
        speedIndexMs,
        ttiMs,
        lcpRating,
        clsRating,
        tbtRating,
        fcpRating: rate(fcpMs, THRESHOLDS.fcpMs),
        ttfbRating: rate(ttfbMs, THRESHOLDS.ttfbMs),
        labCoreWebVitals,

        totalByteWeightKb: totalBytes === null ? null : round(totalBytes / 1024, 1),
        requestCount,
        domSize: domSize === null ? null : Math.round(domSize),
        mainThreadWorkMs: round(numeric(audits, 'mainthread-work-breakdown')),
        jsExecutionMs: round(numeric(audits, 'bootup-time')),

        topOpportunities: opportunities.map((o) => `${o.title}${o.displayValue ? ` (${o.displayValue})` : ''}`).join(' | ') || null,
        opportunities,
        accessibilityIssues: extractFailedAudits(lhr, 'accessibility'),
        seoIssues: extractFailedAudits(lhr, 'seo'),
        bestPracticesIssues: extractFailedAudits(lhr, 'best-practices'),

        lighthouseVersion: lhr.lighthouseVersion,
        benchmarkIndex: round(lhr.environment?.benchmarkIndex),
        throttlingMethod: lhr.configSettings?.throttlingMethod ?? null,
        runWarnings: (lhr.runWarnings || []).map((w) => String(w).slice(0, 300)),
        runtimeError: lhr.runtimeError ? { code: lhr.runtimeError.code, message: lhr.runtimeError.message } : null,
    };
}
