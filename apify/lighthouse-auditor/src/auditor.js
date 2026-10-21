/**
 * One concurrency slot = one long-lived Lighthouse child process + a fresh Chrome per audit.
 * The slot enforces a hard per-URL timeout and always cleans up Chrome, so one bad URL
 * can never take the whole run down.
 */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import * as chromeLauncher from 'chrome-launcher';
import { treeRssMb } from './memory.js';

const CHILD_PATH = fileURLToPath(new URL('./lh-child.js', import.meta.url));

export const CHROME_FLAGS = [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--mute-audio',
];

export function resolveChromePath() {
    const candidates = [
        process.env.CHROME_PATH,
        process.env.APIFY_CHROME_EXECUTABLE_PATH,
        process.env.PLAYWRIGHT_BROWSERS_PATH ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : null,
    ].filter(Boolean);
    return candidates[0] || undefined; // undefined -> chrome-launcher auto-detects
}

// Errors that won't go away on a retry. AUDIT_TIMEOUT is here on purpose: a page that hung
// for the full timeout almost always hangs again, and a second try doubles the wasted compute.
const NON_RETRYABLE = new Set([
    'AUDIT_TIMEOUT',
    'DNS_FAILURE',
    'ERRORED_DOCUMENT_REQUEST',
    'INSECURE_DOCUMENT_REQUEST',
    'CHROME_INTERSTITIAL_ERROR',
    'NOT_HTML',
    'INVALID_URL',
    'FAILED_DOCUMENT_REQUEST_NON_RETRYABLE',
]);

export function isRetryable(code) {
    return !NON_RETRYABLE.has(code);
}

export class AuditSlot {
    constructor(index, { chromePath, measureMemory = false }) {
        this.index = index;
        this.chromePath = chromePath;
        this.measureMemory = measureMemory;
        this.child = null;
        this.childReady = null;
        this.chrome = null;
        this.seq = 0;
        this.closed = false;
    }

    async ensureChild() {
        if (this.child && this.child.connected) return this.childReady;
        this.child = fork(CHILD_PATH, [], {
            stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
            execArgv: ['--max-old-space-size=1536'],
        });
        this.stderrTail = '';
        this.child.stderr.on('data', (d) => {
            this.stderrTail = (this.stderrTail + d.toString()).slice(-2000);
        });
        const child = this.child;
        this.childReady = new Promise((resolve, reject) => {
            const onMsg = (m) => {
                if (m?.type === 'ready') {
                    child.off('message', onMsg);
                    resolve();
                }
            };
            child.on('message', onMsg);
            child.once('exit', (code) => reject(new Error(`Lighthouse worker exited during startup (code ${code}): ${this.stderrTail}`)));
        });
        return this.childReady;
    }

    killChild() {
        if (this.child) {
            try { this.child.kill('SIGKILL'); } catch { /* already gone */ }
        }
        this.child = null;
        this.childReady = null;
    }

    async killChrome() {
        const chrome = this.chrome;
        this.chrome = null;
        if (!chrome) return;
        try {
            await Promise.race([chrome.kill(), new Promise((r) => setTimeout(r, 5000))]);
        } catch { /* ignore */ }
        try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* group already gone */ }
    }

    /**
     * Run one audit. Never throws: returns { ok, data?, error?, htmlPath?, durationMs, peakRssMb }.
     */
    async audit({ url, settings, timeoutMs, saveHtml }) {
        const started = Date.now();
        let peakRssMb = null;
        let sampler = null;
        const id = ++this.seq;
        const htmlPath = saveHtml ? path.join(os.tmpdir(), `lh-report-${process.pid}-${this.index}-${id}.html`) : null;
        try {
            await this.ensureChild();
            this.chrome = await chromeLauncher.launch({
                chromePath: this.chromePath,
                chromeFlags: CHROME_FLAGS,
                logLevel: 'silent',
                handleSIGINT: false,
                maxConnectionRetries: 100,
            });
            if (this.measureMemory) {
                const sample = () => {
                    const v = treeRssMb([this.child?.pid, this.chrome?.pid]);
                    if (v !== null && (peakRssMb === null || v > peakRssMb)) peakRssMb = v;
                };
                sample();
                sampler = setInterval(sample, 250);
            }
            const child = this.child;
            const result = await new Promise((resolve) => {
                const timer = setTimeout(() => {
                    cleanup();
                    resolve({ ok: false, error: { code: 'AUDIT_TIMEOUT', message: `Audit exceeded ${Math.round(timeoutMs / 1000)} s and was stopped` }, killChild: true });
                }, timeoutMs);
                const onMsg = (m) => {
                    if (m?.type === 'result' && m.id === id) {
                        cleanup();
                        resolve(m);
                    }
                };
                const onExit = (code, signal) => {
                    cleanup();
                    resolve({ ok: false, error: { code: 'WORKER_CRASHED', message: `Lighthouse worker exited (code ${code}, signal ${signal}). ${this.stderrTail.slice(-500)}` }, killChild: true });
                };
                function cleanup() {
                    clearTimeout(timer);
                    child.off('message', onMsg);
                    child.off('exit', onExit);
                }
                child.on('message', onMsg);
                child.once('exit', onExit);
                child.send({ type: 'audit', id, url, port: this.chrome.port, settings, htmlPath });
            });
            if (result.killChild) this.killChild();
            return { ...result, durationMs: Date.now() - started, peakRssMb };
        } catch (err) {
            this.killChild();
            return {
                ok: false,
                error: { code: 'CHROME_LAUNCH_FAILED', message: String(err?.message || err).slice(0, 1000) },
                durationMs: Date.now() - started,
                peakRssMb,
            };
        } finally {
            if (sampler) clearInterval(sampler);
            await this.killChrome();
        }
    }

    async close() {
        this.closed = true;
        this.killChild();
        await this.killChrome();
    }
}

/** Lighthouse settings for one audit. */
// Audits skipped in fast mode. "unused-css-rules" needs the CSSUsage gatherer, which was
// 40-45% of total audit time on heavy pages in local profiling (github.com: 22.6 s of 51 s
// on one core). Opportunities carry no weight in the performance score, so scores are unaffected.
export const FAST_MODE_SKIPPED_AUDITS = ['unused-css-rules'];

export function buildSettings({ device, throttling, categories, timeoutMs, fastMode = true }) {
    const presets = {
        mobileSlow4G: { rttMs: 150, throughputKbps: 1638.4, requestLatencyMs: 562.5, downloadThroughputKbps: 1474.56, uploadThroughputKbps: 675 },
        mobileRegular3G: { rttMs: 300, throughputKbps: 700, requestLatencyMs: 1125, downloadThroughputKbps: 630, uploadThroughputKbps: 630 },
        desktopDense4G: { rttMs: 40, throughputKbps: 10240, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 },
    };
    const isMobile = device === 'mobile';
    const network = throttling === 'default'
        ? presets[isMobile ? 'mobileSlow4G' : 'desktopDense4G']
        : presets[throttling] || presets.mobileSlow4G;
    const settings = {
        formFactor: device,
        screenEmulation: isMobile
            ? { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false }
            : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
        emulatedUserAgent: isMobile
            ? 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
            : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        onlyCategories: categories,
        // Lighthouse's own load wait must end well before our hard kill.
        maxWaitForLoad: Math.max(15000, Math.min(45000, Math.round(timeoutMs * 0.5))),
        maxWaitForFcp: Math.max(10000, Math.min(30000, Math.round(timeoutMs * 0.35))),
        // The full-page screenshot is large and nobody reads it in a dataset.
        disableFullPageScreenshot: true,
        skipAudits: fastMode ? FAST_MODE_SKIPPED_AUDITS : null,
    };
    if (throttling === 'none') {
        settings.throttlingMethod = 'provided';
        settings.throttling = { rttMs: 0, throughputKbps: 0, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0, cpuSlowdownMultiplier: 1 };
    } else {
        settings.throttlingMethod = 'simulate';
        settings.throttling = { ...network, cpuSlowdownMultiplier: isMobile ? 4 : 1 };
    }
    return settings;
}
