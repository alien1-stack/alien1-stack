#!/usr/bin/env node
/**
 * Local benchmark: runs the Actor on an input file with a fresh local storage dir,
 * measures wall time and machine-wide CPU seconds (from /proc/stat), and copies the
 * dataset + SUMMARY into an output folder.
 *
 * Usage: node scripts/bench.mjs <input.json> <outDir> [cpuList for taskset, e.g. "0"]
 * Env: CHROME_PATH (defaults to /opt/pw-browsers/chromium if it exists)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [inputPath, outDir, cpuList] = process.argv.slice(2);
if (!inputPath || !outDir) {
    console.error('Usage: node scripts/bench.mjs <input.json> <outDir> [cpuList]');
    process.exit(1);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
// BENCH_STORAGE lets two runs share named stores (e.g. to test "compare with previous run").
const storage = process.env.BENCH_STORAGE || fs.mkdtempSync(path.join(os.tmpdir(), 'lh-bench-'));
for (const sub of ['datasets/default', 'key_value_stores/default']) fs.rmSync(path.join(storage, sub), { recursive: true, force: true });
fs.mkdirSync(path.join(storage, 'key_value_stores/default'), { recursive: true });
fs.copyFileSync(inputPath, path.join(storage, 'key_value_stores/default/INPUT.json'));

function cpuJiffies() {
    const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    const [user, nice, system, idle, iowait, irq, softirq, steal] = line;
    return { busy: user + nice + system + irq + softirq + steal, idle: idle + iowait };
}
const HZ = 100; // USER_HZ on Linux

const env = {
    ...process.env,
    CRAWLEE_STORAGE_DIR: storage,
    APIFY_LOCAL_STORAGE_DIR: storage,
    CHROME_PATH: process.env.CHROME_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : ''),
};
const cmd = cpuList ? 'taskset' : process.execPath;
const args = cpuList ? ['-c', cpuList, process.execPath, path.join(root, 'src/main.js')] : [path.join(root, 'src/main.js')];

const c0 = cpuJiffies();
const t0 = Date.now();
const child = spawn(cmd, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let logText = '';
child.stdout.on('data', (d) => { logText += d; process.stdout.write(d); });
child.stderr.on('data', (d) => { logText += d; process.stderr.write(d); });
const code = await new Promise((r) => child.on('exit', r));
const wallSecs = (Date.now() - t0) / 1000;
const c1 = cpuJiffies();
const cpuSecs = (c1.busy - c0.busy) / HZ;

fs.mkdirSync(outDir, { recursive: true });
const dsDir = path.join(storage, 'datasets/default');
const items = fs.existsSync(dsDir)
    ? fs.readdirSync(dsDir).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dsDir, f), 'utf8')))
    : [];
fs.writeFileSync(path.join(outDir, 'dataset.json'), JSON.stringify(items, null, 2));
const summaryPath = path.join(storage, 'key_value_stores/default/SUMMARY.json');
if (fs.existsSync(summaryPath)) fs.copyFileSync(summaryPath, path.join(outDir, 'SUMMARY.json'));
fs.writeFileSync(path.join(outDir, 'run.log'), logText.replace(/\x1b\[[0-9;]*m/g, ''));
const audits = items.filter((i) => i.device).length;
const ok = items.filter((i) => i.status === 'success').length;
const bench = {
    exitCode: code,
    cpuList: cpuList || 'all',
    machineCores: os.cpus().length,
    wallSecs,
    cpuSecs,
    audits,
    successful: ok,
    wallSecsPerAudit: audits ? wallSecs / audits : null,
    cpuSecsPerAudit: audits ? cpuSecs / audits : null,
    storage,
};
fs.writeFileSync(path.join(outDir, 'bench.json'), JSON.stringify(bench, null, 2));
console.log('\nBENCH', JSON.stringify(bench));
