// Smoke test: serve the production build with `vite preview`, load the page
// in Chromium, move the G slider and check that the displayed Y changes.
// Also writes docs/screenshot-islm.png. Run `npm run build` first.
//
// Uses an installed `playwright` package (local or global); it does not
// download browsers.
import { spawn, execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

function loadPlaywright() {
  try {
    return require('playwright')
  } catch {
    const globalRoot = execSync('npm root -g').toString().trim()
    return require(path.join(globalRoot, 'playwright'))
  }
}

const PORT = Number(process.env.SMOKE_PORT || 4179)
const URL_ = `http://127.0.0.1:${PORT}/`

async function waitForServer(url, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`server did not start at ${url}`)
}

const server = spawn(
  process.execPath,
  [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] },
)

let failed = false
const { chromium } = loadPlaywright()
let browser
try {
  await waitForServer(URL_)
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL_)

  const y = page.getByTestId('out-Y')
  const before = (await y.textContent())?.trim()
  console.log(`Y before: ${before}`)
  if (before !== '1,100') throw new Error(`expected default Y 1,100, got ${before}`)

  const slider = page.locator('input[type=range][name=G]')
  await slider.focus()
  for (let n = 0; n < 10; n++) await page.keyboard.press('ArrowRight')
  const g = (await page.getByTestId('input-G').textContent())?.trim()
  const after = (await y.textContent())?.trim()
  console.log(`G after: ${g}, Y after: ${after}`)
  if (!after || after === before) throw new Error('Y did not change after moving the G slider')
  if (g !== '150' || after !== '1,200') throw new Error(`expected G 150 → Y 1,200, got G ${g}, Y ${after}`)
  if (!page.url().includes('G=150')) throw new Error(`URL not updated: ${page.url()}`)
  const text = await page.getByTestId('explanation').textContent()
  if (!text?.includes('구축효과')) throw new Error('explanation does not mention crowding out')
  if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`)

  await page.mouse.move(0, 0)
  await slider.blur()
  mkdirSync(path.join(root, 'docs'), { recursive: true })
  const out = path.join(root, 'docs/screenshot-islm.png')
  await page.screenshot({ path: out, fullPage: true })
  console.log(`screenshot: ${path.relative(root, out)}`)

  // Phone width: panels must stack without horizontal scroll.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  await phone.goto(URL_)
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  console.log(`phone horizontal overflow: ${overflow}px`)
  if (overflow > 0) throw new Error('horizontal scroll at phone width')
  console.log('SMOKE OK')
} catch (e) {
  failed = true
  console.error('SMOKE FAILED:', e.message)
} finally {
  await browser?.close()
  server.kill()
}
process.exit(failed ? 1 : 0)
