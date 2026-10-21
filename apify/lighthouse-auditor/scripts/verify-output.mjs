#!/usr/bin/env node
/**
 * Checks every dataset item against the documented output contract and writes a flat CSV
 * using the "overview" view from .actor/dataset_schema.json (what buyers get from CSV export).
 *
 * Usage: node scripts/verify-output.mjs <dataset.json> [out.csv]
 */
import fs from 'node:fs';

const [datasetPath, csvPath] = process.argv.slice(2);
const items = JSON.parse(fs.readFileSync(datasetPath, 'utf8')).filter((i) => i.type !== 'summary');
const schema = JSON.parse(fs.readFileSync(new URL('../.actor/dataset_schema.json', import.meta.url), 'utf8'));

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const score = (v) => num(v) && v >= 0 && v <= 100 && Number.isInteger(v);
const ms = (v) => num(v) && v >= 0 && v < 600000;
const rating = (v) => ['good', 'needs-improvement', 'poor'].includes(v);
const str = (v) => typeof v === 'string' && v.length > 0;

const SUCCESS_RULES = {
    url: str, device: (v) => ['mobile', 'desktop'].includes(v), status: (v) => v === 'success', errorCode: (v) => v === null, error: (v) => v === null,
    attempts: (v) => Number.isInteger(v) && v >= 1, auditedAt: (v) => !Number.isNaN(Date.parse(v)), auditDurationSecs: (v) => num(v) && v > 0,
    finalUrl: str, httpStatus: (v) => Number.isInteger(v) && v >= 200 && v < 400,
    performanceScore: score, accessibilityScore: score, bestPracticesScore: score, seoScore: score,
    lcpMs: ms, cls: (v) => num(v) && v >= 0 && v < 10, tbtMs: ms, fcpMs: ms, ttfbMs: ms, speedIndexMs: ms,
    lcpRating: rating, clsRating: rating, tbtRating: rating, fcpRating: rating, ttfbRating: rating, labCoreWebVitals: rating,
    totalByteWeightKb: (v) => num(v) && v >= 0, requestCount: (v) => Number.isInteger(v) && v > 0,
    opportunities: (v) => Array.isArray(v) && v.length <= 5 && v.every((o) => str(o.id) && str(o.title) && num(o.estSavingsMs)),
    accessibilityIssues: Array.isArray, seoIssues: Array.isArray, bestPracticesIssues: Array.isArray,
    lighthouseVersion: str, benchmarkIndex: (v) => num(v) && v > 0,
};
const FAILED_RULES = {
    url: str, status: (v) => v === 'failed', errorCode: str, error: str, auditedAt: (v) => !Number.isNaN(Date.parse(v)),
};

const problems = [];
for (const it of items) {
    const rules = it.status === 'success' ? SUCCESS_RULES : FAILED_RULES;
    for (const [field, check] of Object.entries(rules)) {
        if (!check(it[field])) problems.push(`${it.url} [${it.device}] ${field} = ${JSON.stringify(it[field])}`);
    }
}
const ok = items.filter((i) => i.status === 'success').length;
console.log(`${items.length} items (${ok} success, ${items.length - ok} failed), ${Object.keys(SUCCESS_RULES).length} fields checked per success item`);
console.log(problems.length ? `PROBLEMS (${problems.length}):\n${problems.join('\n')}` : 'All fields valid.');

if (csvPath) {
    const fields = schema.views.overview.transformation.fields;
    const esc = (v) => {
        if (v === null || v === undefined) return '';
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [fields.join(','), ...items.map((i) => fields.map((f) => esc(i[f])).join(','))];
    fs.writeFileSync(csvPath, `${lines.join('\n')}\n`);
    console.log(`CSV written: ${csvPath}`);
}
process.exitCode = problems.length ? 1 : 0;
