import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import { Actor, log } from 'apify';
import { parseInput } from './inputs.js';
import { AuditSlot, buildSettings, isRetryable, resolveChromePath } from './auditor.js';
import { buildSummary } from './summary.js';
import { treeRssMb } from './memory.js';

const EVENT = 'page-audited';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const { urls, invalid, truncated, options } = await parseInput(input);
const startedAt = new Date().toISOString();

if (urls.length === 0 && invalid.length === 0) {
    await Actor.fail('No URLs to audit. Add at least one URL in "URLs to audit" (startUrls) or a sitemap in "Sitemap URLs".');
}
if (truncated > 0) log.warning(`Input had ${truncated} more unique URLs than maxUrls; only the first ${urls.length} will be audited.`);

// ---- concurrency: one CPU core per parallel audit keeps lab metrics stable ----
// Apify gives 1 CPU core per 4 GB. One audit (Chrome + Lighthouse) peaked at ~1.9 GB in our tests.
const memoryMb = Number(process.env.ACTOR_MEMORY_MBYTES || process.env.APIFY_MEMORY_MBYTES || 0);
const cores = memoryMb ? memoryMb / 4096 : os.cpus().length;
const maxByMemory = Math.max(1, Math.floor(((memoryMb || os.totalmem() / 1048576) - 300) / 1900));
const autoConcurrency = Math.max(1, Math.min(Math.floor(cores), maxByMemory));
const jobsTotal = urls.length * options.devices.length;
const requested = options.concurrency || autoConcurrency;
options.effectiveConcurrency = Math.max(1, Math.min(requested, maxByMemory, 8, jobsTotal || 1));
if (requested > maxByMemory) {
    log.warning(`Concurrency ${requested} needs more memory than this run has (${memoryMb || 'unknown'} MB, about 1.9 GB per parallel audit). Using ${options.effectiveConcurrency}.`);
}
if (memoryMb && memoryMb < 2048) {
    log.warning(`Run memory is ${memoryMb} MB. Chrome + Lighthouse need up to ~1.9 GB per audit; use at least 2048 MB.`);
}
if (options.effectiveConcurrency > Math.max(1, Math.floor(cores))) {
    log.warning(`Running ${options.effectiveConcurrency} audits in parallel on ~${cores.toFixed(1)} CPU core(s). Audits will compete for CPU, which inflates TBT/LCP. Use automatic concurrency for the most comparable results.`);
}

// ---- pricing / spending limit ----
const charging = Actor.getChargingManager();
const pricing = charging.getPricingInfo();
const isPpe = pricing.isPayPerEvent;
if (isPpe) log.info(`Pay-per-event pricing active. "${EVENT}" price: $${pricing.perEventPrices?.[EVENT] ?? '?'}; spending limit: $${pricing.maxTotalChargeUsd}`);

// ---- state that survives migrations ----
const state = await Actor.useState('AUDITOR_STATE', { done: {}, invalidPushed: false, stoppedByBudget: false });

const dataset = await Actor.openDataset();
const kvStore = await Actor.openKeyValueStore();
const historyStore = options.compareWithPreviousRun ? await Actor.openKeyValueStore(options.historyStoreName) : null;

if (!state.invalidPushed && invalid.length) {
    await dataset.pushData(invalid.map((raw) => ({
        url: raw, device: null, status: 'failed', errorCode: 'INVALID_URL', error: 'Not a valid http(s) URL', attempts: 0, auditedAt: startedAt,
    })));
    state.invalidPushed = true;
    log.warning(`${invalid.length} input values are not valid URLs; they were recorded as failed items and not charged.`);
}

const jobs = [];
for (const url of urls) for (const device of options.devices) jobs.push({ url, device, key: `${device}|${url}` });
const pending = jobs.filter((j) => !state.done[j.key]);
log.info(`Auditing ${pending.length} page(s) (${urls.length} URLs × ${options.devices.join('+')}) with concurrency ${options.effectiveConcurrency}, throttling "${options.throttling}", categories: ${options.categories.join(', ')}.`);

const chromePath = resolveChromePath();
const slots = Array.from({ length: options.effectiveConcurrency }, (_, i) => new AuditSlot(i, { chromePath, measureMemory: options.measureMemory }));
let stopping = false;
let inFlight = 0;
let completed = jobs.length - pending.length;
let peakMemoryMb = null;
let memorySampler = null;
if (options.measureMemory) {
    memorySampler = setInterval(() => {
        const v = treeRssMb([process.pid]);
        if (v !== null && (peakMemoryMb === null || v > peakMemoryMb)) peakMemoryMb = v;
    }, 500);
}

const shutdown = async () => {
    stopping = true;
    await Promise.all(slots.map((s) => s.close()));
};
Actor.on('aborting', shutdown);
Actor.on('migrating', shutdown);

const historyKey = (job) => `h-${crypto.createHash('sha1').update(job.key).digest('hex')}`;
const reportKey = (job) => `report-${job.device}-${crypto.createHash('sha1').update(job.url).digest('hex').slice(0, 16)}`;

function budgetAllowsAnotherAudit() {
    if (!isPpe) return true;
    const remaining = charging.calculateMaxEventChargeCountWithinLimit(EVENT);
    return remaining - inFlight > 0;
}

async function auditJob(slot, job) {
    const settings = buildSettings({ device: job.device, throttling: options.throttling, categories: options.categories, timeoutMs: options.timeoutSecs * 1000, fastMode: options.fastMode });
    let result;
    let attempts = 0;
    for (;;) {
        attempts++;
        result = await slot.audit({ url: job.url, settings, timeoutMs: options.timeoutSecs * 1000, saveHtml: options.saveHtmlReports });
        if (stopping) return null;
        // A Lighthouse result can still carry a page-level error (DNS failure, 404, no paint...).
        if (result.ok && result.data?.runtimeError) {
            result = { ...result, ok: false, error: result.data.runtimeError };
        }
        if (result.ok) break;
        if (attempts > options.maxRetries || !isRetryable(result.error?.code)) break;
        log.info(`Retrying ${job.url} (${job.device}) after ${result.error?.code}: ${result.error?.message?.slice(0, 160)}`);
        await new Promise((r) => setTimeout(r, 2000));
    }

    const base = {
        url: job.url,
        device: job.device,
        status: result.ok ? 'success' : 'failed',
        errorCode: result.ok ? null : result.error?.code ?? 'UNKNOWN',
        error: result.ok ? null : result.error?.message ?? 'Unknown error',
        attempts,
        auditedAt: new Date().toISOString(),
        auditDurationSecs: Math.round(result.durationMs / 100) / 10,
        throttling: options.throttling,
    };
    if (options.measureMemory) base.peakAuditMemoryMb = result.peakRssMb;

    let item;
    if (result.ok) {
        const { runtimeError, ...data } = result.data;
        item = { ...base, ...data };
        if (result.htmlPath) {
            try {
                const html = await fs.readFile(result.htmlPath, 'utf8');
                const key = reportKey(job);
                await kvStore.setValue(key, html, { contentType: 'text/html; charset=utf-8' });
                item.reportUrl = kvStore.getPublicUrl(key);
            } catch (err) {
                log.warning(`Could not save HTML report for ${job.url}: ${err.message}`);
            } finally {
                await fs.rm(result.htmlPath, { force: true });
            }
        }
        if (historyStore) {
            const hk = historyKey(job);
            const prev = await historyStore.getValue(hk);
            if (prev) {
                item.previousAuditedAt = prev.auditedAt;
                for (const f of ['performanceScore', 'accessibilityScore', 'bestPracticesScore', 'seoScore', 'lcpMs', 'cls', 'tbtMs', 'fcpMs', 'ttfbMs']) {
                    if (typeof item[f] === 'number' && typeof prev[f] === 'number') {
                        item[`${f}Delta`] = Math.round((item[f] - prev[f]) * 10000) / 10000;
                    }
                }
            }
            const snapshot = { auditedAt: item.auditedAt, url: job.url, device: job.device };
            for (const f of ['performanceScore', 'accessibilityScore', 'bestPracticesScore', 'seoScore', 'lcpMs', 'cls', 'tbtMs', 'fcpMs', 'ttfbMs']) snapshot[f] = item[f];
            await historyStore.setValue(hk, snapshot);
        }
    } else {
        const statusFromMessage = /Status code: (\d{3})/.exec(result.error?.message || '')?.[1];
        item = {
            ...base,
            finalUrl: result.data?.finalUrl ?? null,
            httpStatus: result.data?.httpStatus ?? (statusFromMessage ? Number(statusFromMessage) : null),
        };
    }
    return item;
}

let cursor = 0;
async function worker(slot) {
    while (!stopping) {
        if (cursor >= pending.length) return;
        if (!budgetAllowsAnotherAudit()) {
            if (!state.stoppedByBudget) log.warning('Spending limit reached: no more audits will be started. Raise "Max cost per run" to audit the rest.');
            state.stoppedByBudget = true;
            return;
        }
        const job = pending[cursor++];
        inFlight++;
        let item;
        try {
            item = await auditJob(slot, job);
        } catch (err) {
            // Defensive: auditJob should never throw, but one bad URL must never kill the run.
            item = { url: job.url, device: job.device, status: 'failed', errorCode: 'INTERNAL_ERROR', error: String(err?.message || err).slice(0, 1000), attempts: 1, auditedAt: new Date().toISOString() };
        } finally {
            inFlight--;
        }
        if (!item) return; // stopping
        if (item.status === 'success') {
            const res = await Actor.pushData(item, EVENT); // pushes and charges atomically
            if (isPpe && res?.chargedCount === 0) log.warning(`Spending limit reached; result for ${job.url} was not stored.`);
        } else {
            await dataset.pushData(item); // failed audits are never charged
        }
        state.done[job.key] = item.status;
        completed++;
        const msg = `${completed}/${jobs.length} audits done: ${job.url} (${job.device}) ${item.status === 'success' ? `perf ${item.performanceScore ?? '-'}, LCP ${item.lcpMs ?? '-'} ms, ${item.auditDurationSecs}s` : `FAILED ${item.errorCode}`}`;
        log.info(msg);
        await Actor.setStatusMessage(`${completed}/${jobs.length} audits done`);
    }
}

await Promise.all(slots.map((s) => worker(s)));
await Promise.all(slots.map((s) => s.close()));
if (memorySampler) clearInterval(memorySampler);

// ---- summary (built from the dataset, so it is correct after a migration) ----
const { items } = await dataset.getData({ clean: true, limit: 5000 });
const auditItems = items.filter((i) => i.type !== 'summary' && i.device);
const summary = buildSummary(auditItems, {
    startedAt,
    finishedAt: new Date().toISOString(),
    chargedAudits: isPpe ? charging.getChargedEventCount(EVENT) : null,
    peakMemoryMb,
    options,
});
summary.invalidInputs = invalid.length;
summary.skippedByMaxUrls = truncated;
summary.stoppedBySpendingLimit = state.stoppedByBudget;
await kvStore.setValue('SUMMARY', summary);
if (options.pushSummaryToDataset) await dataset.pushData(summary);

const okCount = auditItems.filter((i) => i.status === 'success').length;
await Actor.exit(`Done: ${okCount} audited, ${auditItems.length - okCount} failed. Summary saved to key-value store record SUMMARY.`);
