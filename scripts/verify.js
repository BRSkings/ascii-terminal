'use strict';

/* Automated smoke test for ASCII Life Terminal.
 * Launches Electron with a CDP port, drives the renderer with playwright-core,
 * verifies the PTY is a live shell, the ASCII Life engine runs, scene switching
 * works, tabs work, and saves a screenshot for visual inspection. */

const path = require('path');
const { spawn } = require('child_process');
const electronPath = require('electron');
const { chromium } = require('playwright-core');

const APP_DIR = path.resolve(__dirname, '..');
const PORT = 9333;
const SHOT = path.join(APP_DIR, 'verify-screenshot.png');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForCDP() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch (_) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Electron CDP endpoint did not become ready');
}

(async () => {
  const results = [];
  const ok = (name, detail) => results.push({ name, pass: true, detail });
  const fail = (name, detail) => results.push({ name, pass: false, detail });

  const packagedExe = process.env.APP_EXE ? path.resolve(process.env.APP_EXE) : null;
  const launchArgs = packagedExe
    ? [`--remote-debugging-port=${PORT}`, '--remote-allow-origins=*']
    : [APP_DIR, `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*'];

  const child = spawn(packagedExe || electronPath, launchArgs, {
    cwd: APP_DIR,
    env: Object.assign({}, process.env, { ELECTRON_ENABLE_LOGGING: '1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdout.on('data', () => { /* consume */ });

  let browser;
  try {
    const cdp = await waitForCDP();
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);

    const contexts = browser.contexts();
    let page = null;
    for (const ctx of contexts) {
      for (const p of ctx.pages()) {
        if (p.url().includes('index.html')) { page = p; break; }
      }
      if (page) break;
    }
    if (!page) throw new Error('Could not find the renderer page via CDP');

    await page.waitForFunction(() => !!(window.__asciiTerm && window.__asciiTerm.activeId), null, { timeout: 15000 });
    ok('CDP connection + renderer boot', cdp['Browser'] || 'connected');

    // 1. Terminal exists and is attached to a live PTY
    const termState = await page.evaluate(() => ({
      tabs: window.__asciiTerm.terms.size,
      id: window.__asciiTerm.activeId,
      cols: window.__asciiTerm.terms.get(window.__asciiTerm.activeId).term.cols,
      rows: window.__asciiTerm.terms.get(window.__asciiTerm.activeId).term.rows
    }));
    if (termState.tabs >= 1 && termState.cols > 20 && termState.rows > 5) {
      ok('Terminal created and fitted', JSON.stringify(termState));
    } else {
      fail('Terminal created and fitted', JSON.stringify(termState));
    }

    // 2. Real shell: send a command and read it back from the xterm buffer
    await page.evaluate(() => window.__asciiTerm.send("Write-Output 'HELLO_ASCII_TERM'\r"));
    await sleep(2000);
    const buffer = await page.evaluate(() => window.__asciiTerm.buffer());
    if (buffer.includes('HELLO_ASCII_TERM')) {
      ok('Live PowerShell PTY executes commands', 'marker found in terminal buffer');
    } else {
      fail('Live PowerShell PTY executes commands', 'marker missing; buffer tail: ' + buffer.slice(-600));
    }

    // 2b. OpenCode itself runs inside the terminal
    await page.evaluate(() => window.__asciiTerm.send("opencode --version\r"));
    await sleep(2500);
    const ocBuffer = await page.evaluate(() => window.__asciiTerm.buffer());
    if (/opencode v\d/i.test(ocBuffer)) {
      ok('OpenCode runs inside the terminal', (ocBuffer.match(/opencode v\S+/i) || [])[0]);
    } else {
      fail('OpenCode runs inside the terminal', 'buffer tail: ' + ocBuffer.slice(-600));
    }

    // 3. ASCII Life engine is running
    const lifeState = await page.evaluate(() => {
      const l = window.__asciiTerm.life;
      return l ? { running: l.running, fps: Math.round(l.stats.fps), scene: l.o.scene, cells: l.stats.cells, w: l.canvas.width, h: l.canvas.height } : null;
    });
    if (lifeState && lifeState.running && lifeState.fps > 0 && lifeState.w > 0 && lifeState.cells > 0) {
      ok('ASCII Life engine animating', JSON.stringify(lifeState));
    } else {
      fail('ASCII Life engine animating', JSON.stringify(lifeState));
    }

    // 4. Scene switching
    await page.evaluate(() => window.__asciiTerm.setScene('frog'));
    await sleep(1200);
    const sceneState = await page.evaluate(() => ({
      scene: window.__asciiTerm.life.o.scene,
      activeBtn: document.querySelector('.scene-btn.active')?.dataset.scene
    }));
    if (sceneState.scene === 'frog' && sceneState.activeBtn === 'frog') {
      ok('Scene switcher (frog)', JSON.stringify(sceneState));
    } else {
      fail('Scene switcher (frog)', JSON.stringify(sceneState));
    }

    // 5. New tab
    const before = await page.evaluate(() => window.__asciiTerm.terms.size);
    await page.evaluate(() => window.__asciiTerm.newTab());
    await sleep(1800);
    const after = await page.evaluate(() => window.__asciiTerm.terms.size);
    if (after === before + 1) {
      ok('New tab creates a second PTY', `${before} -> ${after}`);
    } else {
      fail('New tab creates a second PTY', `${before} -> ${after}`);
    }

    // 6. Switch back to koi for the screenshot, let it settle
    await page.evaluate(() => window.__asciiTerm.setScene('koi'));
    await sleep(1500);
    await page.screenshot({ path: SHOT });
    ok('Screenshot captured', SHOT);

    // Report
    console.log('\n=== ASCII Life Terminal verification ===');
    for (const r of results) {
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  ::  ' + r.detail : ''}`);
    }
    const failures = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failures.length}/${results.length} checks passed.`);
    if (stderr.trim()) console.log('\nElectron stderr (tail):\n' + stderr.trim().split('\n').slice(-15).join('\n'));

    process.exitCode = failures.length ? 1 : 0;
  } catch (err) {
    console.error('VERIFY ERROR:', err && err.stack ? err.stack : err);
    if (stderr.trim()) console.error('Electron stderr (tail):\n' + stderr.trim().split('\n').slice(-20).join('\n'));
    process.exitCode = 1;
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) { /* noop */ }
    }
    try { child.kill(); } catch (_) { /* noop */ }
    setTimeout(() => process.exit(process.exitCode || 0), 400);
  }
})();
