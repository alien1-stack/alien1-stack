/**
 * Long-lived child process that runs Lighthouse audits one at a time.
 *
 * Lighthouse is not safe to run concurrently inside one Node process, so the
 * parent keeps one child per concurrency slot. The parent owns Chrome and the
 * hard timeout: if an audit hangs, it kills this process and Chrome together.
 */
import fs from 'node:fs/promises';
import lighthouse from 'lighthouse';
import { extractCompact } from './extract.js';

process.on('message', async (msg) => {
    if (!msg || msg.type !== 'audit') return;
    const { id, url, port, settings, htmlPath } = msg;
    try {
        const flags = { port, logLevel: 'error', output: htmlPath ? 'html' : 'json' };
        const config = { extends: 'lighthouse:default', settings };
        const runnerResult = await lighthouse(url, flags, config);
        if (!runnerResult || !runnerResult.lhr) throw new Error('Lighthouse returned no result');
        const data = extractCompact(runnerResult.lhr);
        let savedHtml = null;
        if (htmlPath && !runnerResult.lhr.runtimeError) {
            await fs.writeFile(htmlPath, runnerResult.report);
            savedHtml = htmlPath;
        }
        process.send({ type: 'result', id, ok: true, data, htmlPath: savedHtml });
    } catch (err) {
        process.send({
            type: 'result',
            id,
            ok: false,
            error: {
                code: err?.code || err?.lhrRuntimeError?.code || 'LIGHTHOUSE_ERROR',
                message: String(err?.friendlyMessage || err?.message || err).slice(0, 1000),
            },
        });
    }
});

process.send({ type: 'ready' });
