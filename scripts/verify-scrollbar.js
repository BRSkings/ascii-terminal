'use strict';
/* Verify the scrollbar is themed: no bright native track, xterm's slider
   fades in with a frosted color. */
const path = require('path');
const { spawn } = require('child_process');
const electronPath = require('electron');
const { chromium } = require('playwright-core');
const APP_DIR = path.resolve(__dirname, '..');
const PORT = 9344;
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

    await page.evaluate(() => window.__asciiTerm.send('1..120 | ForEach-Object { "line $_" }\r'));
    await sleep(3000);

    const before = await page.evaluate(() => {
      const v = document.querySelector('.xterm-viewport');
      const sb = document.querySelector('.xterm .scrollbar.vertical');
      const sl = sb && sb.querySelector('.slider');
      return {
        nativeDisplay: getComputedStyle(v, '::-webkit-scrollbar').display,
        nativeWidth: getComputedStyle(v, '::-webkit-scrollbar').width,
        customClass: sb && sb.className,
        sliderBg: sl && getComputedStyle(sl).backgroundColor,
        sliderRadius: sl && getComputedStyle(sl).borderRadius,
      };
    });
    console.log('BEFORE scroll:', JSON.stringify(before));

    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, -800);
    await sleep(250);
    const during = await page.evaluate(() => {
      const sb = document.querySelector('.xterm .scrollbar.vertical');
      return { cls: sb && sb.className, opacity: sb && getComputedStyle(sb).opacity };
    });
    console.log('DURING scroll:', JSON.stringify(during));
    await page.screenshot({ path: path.join(APP_DIR, 'scrollbar-check.png') });

    // No bright pixels along the right edge (the old white native track).
    const { execFileSync } = require('child_process');
    const res = execFileSync('python', ['-c', `
from PIL import Image
im=Image.open(r'${path.join(APP_DIR, 'scrollbar-check.png')}').convert('RGB')
w,h=im.size
bright=0;total=0
for y in range(50,h-6,2):
  for x in range(w-18,w):
    r,g,b=im.getpixel((x,y))
    total+=1
    if r>210 and g>210 and b>210: bright+=1
print('bright_pixels',bright,'of',total)
`], { encoding: 'utf8' }).trim();
    console.log('RIGHT EDGE:', res);

    const bright = parseInt(res.match(/bright_pixels (\d+)/)[1], 10);
    const themed = /148, 163, 184|236, 176, 129/.test(before.sliderBg || '');
    const pass = before.nativeDisplay === 'none' && themed && /visible/.test(during.cls || '') && during.opacity === '1' && bright === 0;
    console.log('\nRESULT:', pass ? 'PASS (native track hidden, themed slider fades in on scroll)' : 'FAIL');
    if (!pass) process.exitCode = 1;
  } catch (e) { console.error('ERR', e.stack || e); process.exitCode = 1; }
  finally {
    if (browser) try { await browser.close(); } catch (_) {}
    try { child.kill(); } catch (_) {}
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  }
})();
