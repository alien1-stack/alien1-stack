/**
 * Run-level summary: averages/medians per device, worst pages, most common issues.
 */
const AVG_FIELDS = ['performanceScore', 'accessibilityScore', 'bestPracticesScore', 'seoScore',
    'lcpMs', 'cls', 'tbtMs', 'fcpMs', 'ttfbMs', 'speedIndexMs', 'totalByteWeightKb'];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r = (v, d = 1) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

function countIssues(items, field, keyFn) {
    const counts = new Map();
    for (const it of items) {
        for (const x of it[field] || []) {
            const key = keyFn(x);
            const prev = counts.get(key) || { id: x.id, title: x.title, pages: 0 };
            prev.pages++;
            counts.set(key, prev);
        }
    }
    return [...counts.values()].sort((a, b) => b.pages - a.pages).slice(0, 10);
}

export function buildSummary(items, { startedAt, finishedAt, chargedAudits, peakMemoryMb, options }) {
    const ok = items.filter((i) => i.status === 'success');
    const failed = items.filter((i) => i.status !== 'success');
    const byDevice = {};
    for (const device of [...new Set(items.map((i) => i.device))]) {
        const set = ok.filter((i) => i.device === device);
        const averages = {};
        const medians = {};
        for (const f of AVG_FIELDS) {
            const xs = set.map((i) => i[f]).filter((v) => typeof v === 'number');
            averages[f] = r(mean(xs), f === 'cls' ? 3 : 1);
            medians[f] = r(median(xs), f === 'cls' ? 3 : 1);
        }
        const cwv = { good: 0, 'needs-improvement': 0, poor: 0 };
        for (const i of set) if (i.labCoreWebVitals) cwv[i.labCoreWebVitals]++;
        byDevice[device] = {
            audited: set.length,
            averages,
            medians,
            labCoreWebVitals: cwv,
            worstPages: set
                .filter((i) => typeof i.performanceScore === 'number')
                .sort((a, b) => a.performanceScore - b.performanceScore)
                .slice(0, 10)
                .map((i) => ({ url: i.url, performanceScore: i.performanceScore, lcpMs: i.lcpMs, cls: i.cls, tbtMs: i.tbtMs, topOpportunity: i.opportunities?.[0]?.title ?? null })),
            mostCommonOpportunities: countIssues(set, 'opportunities', (x) => x.id),
            mostCommonAccessibilityIssues: countIssues(set, 'accessibilityIssues', (x) => x.id),
            mostCommonSeoIssues: countIssues(set, 'seoIssues', (x) => x.id),
        };
    }
    const durations = ok.map((i) => i.auditDurationSecs).filter((v) => typeof v === 'number');
    return {
        type: 'summary',
        startedAt,
        finishedAt,
        totalAudits: items.length,
        successful: ok.length,
        failed: failed.length,
        chargedAudits,
        settings: {
            devices: options.devices,
            categories: options.categories,
            throttling: options.throttling,
            fastMode: options.fastMode,
            concurrency: options.effectiveConcurrency,
        },
        avgAuditDurationSecs: r(mean(durations)),
        peakMemoryMb: peakMemoryMb ?? null,
        byDevice,
        failures: failed.slice(0, 50).map((i) => ({ url: i.url, device: i.device, errorCode: i.errorCode, error: i.error })),
    };
}
