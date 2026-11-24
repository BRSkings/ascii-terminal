'use strict';
/* Verify the frosted-glass layer is actually visible over OpenCode's session row. */
const path = require('path');
const { spawn } = require('child_process');
const electronPath = require('electron');
const { chromium } = require('playwright-core');
const APP_DIR = path.resolve(__dirname, '..');
const PORT = 9342;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function cdp() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; } catch (_) {}
    await sleep(250);
  }
  throw new Error('no cdp');
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
    await page.evaluate(() => window.__asciiTerm.send('opencode\r'));
    await sleep(12000);

    const state = await page.evaluate(() => {
      const g = document.getElementById('session-glass');
      const cs = getComputedStyle(g);
      const r = g.getBoundingClientRect();
      return {
        visible: g.classList.contains('visible'),
        opacity: cs.opacity,
        blur: cs.backdropFilter || cs.webkitBackdropFilter,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      };
    });
    console.log('GLASS STATE:', JSON.stringify(state));

    // Pause the animation so the only difference between the two captures
    // is the glass itself.
    await page.evaluate(() => { try { window.__asciiTerm.life.stop(); } catch (_) {} });
    await sleep(400);

    // Screenshot with glass, then hide it and screenshot again.
    await page.screenshot({ path: path.join(APP_DIR, 'glass-on.png') });
    await page.evaluate(() => document.getElementById('session-glass').style.display = 'none');
    await sleep(400);
    await page.screenshot({ path: path.join(APP_DIR, 'glass-off.png') });

    // Compare pixels in the session-row region using pure JS PNG-free approach:
    // read both PNGs via sharp if present, else use Python.
    const { execFileSync } = require('child_process');
    const cmp = execFileSync('python', ['-c', `
from PIL import Image
a=Image.open(r'${path.join(APP_DIR, 'glass-on.png')}').convert('RGB')
b=Image.open(r'${path.join(APP_DIR, 'glass-off.png')}').convert('RGB')
r=${JSON.stringify(state.rect)}
x0=int(r['x'])+5; y0=int(r['y'])+2; x1=int(r['x']+r['w'])-5; y1=int(r['y']+r['h'])-2
diff=0; n=0
for y in range(y0,y1,2):
  for x in range(x0,x1,2):
    pa=a.getpixel((x,y)); pb=b.getpixel((x,y))
    diff+=sum(abs(pa[i]-pb[i]) for i in range(3)); n+=1
print('avg_diff',round(diff/max(n,1),2),'samples',n)
`], { encoding: 'utf8' }).trim();
    console.log('PIXEL COMPARE (row region):', cmp);

    // Also compare a control region below the row (should be nearly identical)
    const ctrl = execFileSync('python', ['-c', `
from PIL import Image
a=Image.open(r'${path.join(APP_DIR, 'glass-on.png')}').convert('RGB')
b=Image.open(r'${path.join(APP_DIR, 'glass-off.png')}').convert('RGB')
diff=0;n=0
for y in range(120,200,3):
  for x in range(40,600,3):
    pa=a.getpixel((x,y)); pb=b.getpixel((x,y))
    diff+=sum(abs(pa[i]-pb[i]) for i in range(3)); n+=1
print('avg_diff',round(diff/max(n,1),2),'samples',n)
`], { encoding: 'utf8' }).trim();
    console.log('PIXEL COMPARE (control below):', ctrl);

    const rowDiff = parseFloat(cmp.match(/avg_diff ([\d.]+)/)[1]);
    // Note: toggling backdrop-filter can change compositing of the whole
    // terminal stack, so the control-region number is informational only.
    const pass = state.visible && state.opacity === '1' && /blur/.test(state.blur || '') && rowDiff > 3;
    console.log('\nRESULT:', pass ? 'PASS (glass visibly frosts the row)' : 'FAIL');
    if (!pass) process.exitCode = 1;
  } catch (e) { console.error('ERR', e.stack || e); process.exitCode = 1; }
  finally {
    if (browser) try { await browser.close(); } catch (_) {}
    try { child.kill(); } catch (_) {}
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  }
})();
