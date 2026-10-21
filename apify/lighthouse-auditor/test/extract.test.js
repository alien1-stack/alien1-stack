import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { extractCompact, extractOpportunities, rate } from '../src/extract.js';
import { normalizeUrl } from '../src/inputs.js';
import { buildSettings, isRetryable } from '../src/auditor.js';
import { buildSummary } from '../src/summary.js';

const lhr = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/lhr-python-org.json.gz', import.meta.url))));

test('extractCompact returns scores, metrics and ratings from a real LHR', () => {
    const r = extractCompact(lhr);
    assert.equal(r.performanceScore, 81);
    assert.equal(r.accessibilityScore, 75);
    assert.equal(r.bestPracticesScore, 100);
    assert.equal(r.seoScore, 92);
    assert.equal(r.lcpMs, 3190);
    assert.equal(r.tbtMs, 387);
    assert.equal(r.ttfbMs, 34);
    assert.equal(r.lcpRating, 'needs-improvement');
    assert.equal(r.tbtRating, 'needs-improvement');
    assert.equal(r.labCoreWebVitals, 'needs-improvement');
    assert.equal(r.httpStatus, 200);
    assert.equal(r.finalUrl, 'https://www.python.org/');
    assert.ok(r.requestCount > 0);
    assert.ok(r.accessibilityIssues.some((i) => i.id === 'color-contrast'));
    assert.equal(r.runtimeError, null);
    // Every value must be JSON-serialisable and the record small
    assert.ok(JSON.stringify(r).length < 20000);
});

test('opportunities are failing audits sorted by estimated savings, max 5', () => {
    const ops = extractOpportunities(lhr, 5);
    assert.ok(ops.length > 0 && ops.length <= 5);
    for (let i = 1; i < ops.length; i++) {
        assert.ok(ops[i - 1].estSavingsMs + ops[i - 1].estTbtSavingsMs >= ops[i].estSavingsMs + ops[i].estTbtSavingsMs);
    }
    for (const o of ops) assert.ok(o.score < 0.9);
});

test('rating thresholds', () => {
    assert.equal(rate(2500, [2500, 4000]), 'good');
    assert.equal(rate(2501, [2500, 4000]), 'needs-improvement');
    assert.equal(rate(4001, [2500, 4000]), 'poor');
    assert.equal(rate(null, [1, 2]), null);
});

test('normalizeUrl', () => {
    assert.equal(normalizeUrl('example.com'), 'https://example.com/');
    assert.equal(normalizeUrl(' https://a.b/c#frag '), 'https://a.b/c');
    assert.equal(normalizeUrl('ftp://x.com'), null);
    assert.equal(normalizeUrl('not a url'), null);
    assert.equal(normalizeUrl('javascript:alert(1)'), null);
    assert.equal(normalizeUrl(''), null);
});

test('buildSettings maps device and throttling', () => {
    const m = buildSettings({ device: 'mobile', throttling: 'default', categories: ['performance'], timeoutMs: 90000 });
    assert.equal(m.formFactor, 'mobile');
    assert.equal(m.throttling.cpuSlowdownMultiplier, 4);
    assert.equal(m.throttling.rttMs, 150);
    assert.deepEqual(m.skipAudits, ['unused-css-rules']);
    const d = buildSettings({ device: 'desktop', throttling: 'default', categories: ['performance'], timeoutMs: 90000, fastMode: false });
    assert.equal(d.throttling.cpuSlowdownMultiplier, 1);
    assert.equal(d.throttling.rttMs, 40);
    assert.equal(d.skipAudits, null);
    const n = buildSettings({ device: 'mobile', throttling: 'none', categories: ['seo'], timeoutMs: 30000 });
    assert.equal(n.throttlingMethod, 'provided');
    assert.ok(n.maxWaitForLoad < 30000);
});

test('retry policy', () => {
    assert.equal(isRetryable('NO_FCP'), true);
    assert.equal(isRetryable('WORKER_CRASHED'), true);
    assert.equal(isRetryable('DNS_FAILURE'), false);
    assert.equal(isRetryable('ERRORED_DOCUMENT_REQUEST'), false);
    assert.equal(isRetryable('AUDIT_TIMEOUT'), false);
});

test('summary aggregates per device', () => {
    const items = [
        { url: 'a', device: 'mobile', status: 'success', performanceScore: 50, lcpMs: 4000, cls: 0.2, opportunities: [{ id: 'x', title: 'X' }], labCoreWebVitals: 'poor', auditDurationSecs: 10 },
        { url: 'b', device: 'mobile', status: 'success', performanceScore: 90, lcpMs: 2000, cls: 0, opportunities: [{ id: 'x', title: 'X' }], labCoreWebVitals: 'good', auditDurationSecs: 20 },
        { url: 'c', device: 'mobile', status: 'failed', errorCode: 'DNS_FAILURE', error: 'dns' },
    ];
    const s = buildSummary(items, { startedAt: 't0', finishedAt: 't1', chargedAudits: 2, peakMemoryMb: null, options: { devices: ['mobile'], categories: [], throttling: 'default', fastMode: true, effectiveConcurrency: 1 } });
    assert.equal(s.successful, 2);
    assert.equal(s.failed, 1);
    assert.equal(s.byDevice.mobile.averages.performanceScore, 70);
    assert.equal(s.byDevice.mobile.worstPages[0].url, 'a');
    assert.equal(s.byDevice.mobile.mostCommonOpportunities[0].pages, 2);
    assert.equal(s.avgAuditDurationSecs, 15);
});
