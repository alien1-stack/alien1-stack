/**
 * Linux-only: memory of a process and all its descendants, read from /proc.
 * Uses PSS (proportional set size) when available, so memory shared between Chrome's
 * processes is not counted several times; falls back to RSS.
 * Used to measure what one audit really needs (Node child + Chrome and its renderers).
 */
import fs from 'node:fs';

function readProcTable() {
    const table = new Map(); // pid -> { ppid, rssKb }
    let entries;
    try {
        entries = fs.readdirSync('/proc');
    } catch {
        return table;
    }
    for (const name of entries) {
        if (!/^\d+$/.test(name)) continue;
        try {
            const status = fs.readFileSync(`/proc/${name}/status`, 'utf8');
            const ppid = Number(/PPid:\s+(\d+)/.exec(status)?.[1] ?? 0);
            const rssKb = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
            table.set(Number(name), { ppid, rssKb });
        } catch {
            // process exited between readdir and read
        }
    }
    return table;
}

function pssKb(pid) {
    try {
        const rollup = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
        const m = /^Pss:\s+(\d+)/m.exec(rollup);
        return m ? Number(m[1]) : null;
    } catch {
        return null;
    }
}

/** Sum of PSS (or RSS) in MB for the given root pids and all their descendants. */
export function treeRssMb(rootPids) {
    const table = readProcTable();
    if (table.size === 0) return null;
    const children = new Map();
    for (const [pid, { ppid }] of table) {
        if (!children.has(ppid)) children.set(ppid, []);
        children.get(ppid).push(pid);
    }
    let totalKb = 0;
    const seen = new Set();
    const stack = rootPids.filter((p) => p && table.has(p));
    while (stack.length) {
        const pid = stack.pop();
        if (seen.has(pid)) continue;
        seen.add(pid);
        totalKb += pssKb(pid) ?? table.get(pid)?.rssKb ?? 0;
        for (const c of children.get(pid) || []) stack.push(c);
    }
    return Math.round(totalKb / 1024);
}
