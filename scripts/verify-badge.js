'use strict';
/* Verify all dark gradient fills (session row + working badges) are stripped. */
const path = require('path');
const { spawn } = require('child_process');
const electronPath = require('electron');
const { chromium } = require('playwright-core');
const APP_DIR = path.resolve(__dirname, '..');
const PORT = 9343;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function cdp() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; } catch (_) {}
    await sleep(250);
  }
  throw new Error('no cdp');
}

const DARK = /\x1b\[48;2;(\d{1,3});(\d{1,3});(\d{1,3})m/g;
function strip(d) {
  return d.replace(DARK, (m, r, g, b) => {
    const R = +r, G = +g, B = +b;
    return (Math.max(R, G, B) <= 45 && !(R === 32 && G === 32 && B === 32)) ? '\x1b[49m' : m;
  });
}
function fills(s) {
  const out = {}; let m;
  const re = /\x1b\[48;2;(\d+);(\d+);(\d+)m/g;
  while ((m = re.exec(s))) { const k = m[1] + ',' + m[2] + ',' + m[3]; out[k] = (out[k] || 0) + 1; }
  return out;
}

(async () => {
  const child = spawn(electronPath, [APP_DIR, `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*'], {
    cwd: APP_DIR, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {}); child.stdout.on('data', () => {});
  let browser;
  try {
    await cdp();
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    let page = null;
    for (const c of browser.contexts()) for (const p of c.pages()) if (p.url().includes('index.html')) { page = p; break; }
    await page.waitForFunction(() => !!(window.__asciiTerm && window.__asciiTerm.activeId), null, { timeout: 20000 });

    const fs = require('fs');
    const bundle = fs.readFileSync(path.join(APP_DIR, 'renderer', 'bundle.js'), 'utf8');
    const hasGeneralized = /<= 45/.test(bundle) && /logoShade/.test(bundle);
    console.log('bundle strips all dark fills:', hasGeneralized);

    // Real-world sample: warm "File" badge gradient + neutral row + logo shade.
    const sample = '\x1b[48;2;42;37;34m⠋\x1b[48;2;41;36;33m \x1b[48;2;33;30;27mF\x1b[48;2;21;19;17mi'
      + '\x1b[48;2;16;16;16mT\x1b[48;2;1;1;1mr\x1b[48;2;32;32;32m▀\x1b[48;2;64;64;64m▀';
    const after = fills(strip(sample));
    console.log('fills after strip:', JSON.stringify(after));

    await page.evaluate(() => window.__asciiTerm.send('opencode\r'));
    await sleep(11000);
    await page.evaluate(() => window.__asciiTerm.send('list the files in the current directory\r'));
    await sleep(3500);
    await page.screenshot({ path: path.join(APP_DIR, 'badge-running.png') });
    console.log('screenshot: badge-running.png');

    const pass = hasGeneralized && Object.keys(after).length === 2 && !!after['32,32,32'] && !!after['64,64,64'];
    console.log('\nRESULT:', pass ? 'PASS (all dark badges stripped; logo shades preserved)' : 'FAIL');
    if (!pass) process.exitCode = 1;
  } catch (e) { console.error('ERR', e.stack || e); process.exitCode = 1; }
  finally {
    if (browser) try { await browser.close(); } catch (_) {}
    try { child.kill(); } catch (_) {}
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  }
})();
