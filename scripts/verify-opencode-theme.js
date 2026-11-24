'use strict';

/* Visual + functional verification of the transparent OpenCode theme inside
 * ASCII Life Terminal. Launches the app with CDP, types `opencode` into the
 * real PTY, waits for the TUI, screenshots it, and reports buffer diagnostics. */

const path = require('path');
const { spawn } = require('child_process');
const electronPath = require('electron');
const { chromium } = require('playwright-core');

const APP_DIR = path.resolve(__dirname, '..');
const PORT = 9334;
const SHOT = path.join(APP_DIR, 'verify-opencode-transparent.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForCDP() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return true;
    } catch (_) { /* noop */ }
    await sleep(250);
  }
  throw new Error('CDP not ready');
}

(async () => {
  const packagedExe = process.env.APP_EXE ? path.resolve(process.env.APP_EXE) : null;
  const args = packagedExe
    ? [`--remote-debugging-port=${PORT}`, '--remote-allow-origins=*']
    : [APP_DIR, `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*'];

  const child = spawn(packagedExe || electronPath, args, {
    cwd: APP_DIR,
    env: Object.assign({}, process.env, { ELECTRON_ENABLE_LOGGING: '1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdout.on('data', () => {});

  let browser;
  try {
    await waitForCDP();
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    let page = null;
    for (const ctx of browser.contexts()) {
      for (const p of ctx.pages()) if (p.url().includes('index.html')) { page = p; break; }
      if (page) break;
    }
    if (!page) throw new Error('renderer page not found');

    await page.waitForFunction(() => !!(window.__asciiTerm && window.__asciiTerm.activeId), null, { timeout: 20000 });
    console.log('Terminal ready.');

    // Make sure koi are the active scene before launching OpenCode.
    await page.evaluate(() => window.__asciiTerm.setScene('koi'));

    // Launch OpenCode inside the real PTY.
    await page.evaluate(() => window.__asciiTerm.send('opencode\r'));
    console.log('Launched opencode; waiting for TUI...');
    await sleep(12000);

    const state = await page.evaluate(() => {
      const l = window.__asciiTerm.life;
      const text = window.__asciiTerm.buffer();
      return {
        scene: l ? l.o.scene : null,
        lifeRunning: l ? l.running : false,
        fps: l ? Math.round(l.stats.fps) : 0,
        cells: l ? l.stats.cells : 0,
        buffer: text.split('\n').filter((s) => s.trim()).slice(0, 40)
      };
    });

    console.log('\n=== OpenCode-in-terminal state ===');
    console.log('scene         :', state.scene);
    console.log('life running  :', state.lifeRunning, 'fps:', state.fps, 'cells:', state.cells);
    console.log('--- terminal buffer (non-empty lines) ---');
    state.buffer.forEach((line) => console.log('  ' + line.replace(/\s+$/, '')));

    const joined = state.buffer.join('\n');
    const hasThemeError = /theme.*(error|not found|invalid)|invalid.*theme/i.test(joined);
    const hasOpenCodeUI = /opencode|agent|model|build|plan|session|permission|Tab|Ctrl/i.test(joined);

    await page.screenshot({ path: SHOT });
    console.log('\nScreenshot:', SHOT);
    console.log('Theme error detected :', hasThemeError);
    console.log('OpenCode UI detected :', hasOpenCodeUI);

    if (hasThemeError) {
      console.log('\nRESULT: FAIL (theme error in OpenCode output)');
      process.exitCode = 1;
    } else if (!hasOpenCodeUI) {
      console.log('\nRESULT: INCONCLUSIVE (OpenCode UI not clearly detected)');
      process.exitCode = 2;
    } else {
      console.log('\nRESULT: PASS (OpenCode running, no theme errors)');
    }
    if (stderr.trim()) console.log('\nElectron stderr (tail):\n' + stderr.trim().split('\n').slice(-10).join('\n'));
  } catch (err) {
    console.error('VERIFY ERROR:', err && err.stack ? err.stack : err);
    if (stderr.trim()) console.error('stderr:', stderr.slice(-2000));
    process.exitCode = 1;
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
    try { child.kill(); } catch (_) {}
    setTimeout(() => process.exit(process.exitCode || 0), 400);
  }
})();
