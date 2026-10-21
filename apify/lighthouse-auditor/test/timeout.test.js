// Integration test: needs Chrome. Set CHROME_PATH (or PLAYWRIGHT_BROWSERS_PATH) to run it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AuditSlot, buildSettings, resolveChromePath } from '../src/auditor.js';

const chromePath = resolveChromePath();

test('hard per-URL timeout kills a hanging audit and the slot keeps working', { skip: !chromePath && 'no CHROME_PATH', timeout: 120000 }, async () => {
    const server = http.createServer((req, res) => {
        if (req.url === '/hang') return; // never respond
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><html lang="en"><head><title>t</title></head><body><h1>ok</h1></body></html>');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const slot = new AuditSlot(0, { chromePath });
    try {
        const settings = buildSettings({ device: 'desktop', throttling: 'default', categories: ['seo'], timeoutMs: 60000 });
        const hung = await slot.audit({ url: `${base}/hang`, settings, timeoutMs: 4000, saveHtml: false });
        assert.equal(hung.ok, false);
        assert.equal(hung.error.code, 'AUDIT_TIMEOUT');
        assert.ok(hung.durationMs < 15000);
        const ok = await slot.audit({ url: `${base}/ok`, settings, timeoutMs: 60000, saveHtml: false });
        assert.equal(ok.ok, true, JSON.stringify(ok.error));
        assert.equal(typeof ok.data.seoScore, 'number');
    } finally {
        await slot.close();
        server.close();
    }
});
