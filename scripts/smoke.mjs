// Smoke test: serve the production build with `vite preview`, load the page
// in Chromium, move the G slider and check that the displayed Y changes; then
// open the AD-AS tab, move M and check the short-/long-run numbers.
// Writes docs/screenshot-islm.png and docs/screenshot-adas.png.
// Run `npm run build` first.
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

  // ---- AD-AS ----
  await page.getByRole('tab', { name: 'AD-AS' }).click()
  await page.waitForFunction(() => location.search.includes('model=adas'))
  const gCarried = (await page.getByTestId('input-G').textContent())?.trim()
  console.log(`AD-AS tab: url ${new URL(page.url()).search}, G carried over: ${gCarried}`)
  if (gCarried !== '150') throw new Error(`G not carried over to AD-AS (got ${gCarried})`)
  await page.getByRole('button', { name: '초기화' }).click()
  await page.waitForFunction(() => location.search === '?model=adas')

  const read = async (id) => (await page.getByTestId(id).textContent())?.trim()
  const adBefore = { Y1: await read('out-Y1'), P1: await read('out-P1'), PLR: await read('out-PLR') }
  console.log(`AD-AS before: ${JSON.stringify(adBefore)}`)
  if (adBefore.Y1 !== '1,100' || adBefore.P1 !== '2.000' || adBefore.PLR !== '2.000') {
    throw new Error(`unexpected AD-AS defaults ${JSON.stringify(adBefore)}`)
  }
  const mSlider = page.locator('input[type=range][name=M]')
  await mSlider.focus()
  for (let n = 0; n < 20; n++) await page.keyboard.press('ArrowRight')
  const m = await read('input-M')
  const adAfter = { Y1: await read('out-Y1'), P1: await read('out-P1'), PLR: await read('out-PLR'), iLR: await read('out-iLR') }
  console.log(`AD-AS after M ${m}: ${JSON.stringify(adAfter)}`)
  if (m !== '1,200') throw new Error(`expected M 1,200, got ${m}`)
  if (adAfter.Y1 === adBefore.Y1 || adAfter.P1 === adBefore.P1 || adAfter.PLR === adBefore.PLR) {
    throw new Error('AD-AS short-/long-run numbers did not change after moving M')
  }
  if (adAfter.PLR !== '2.400' || adAfter.iLR !== '6.00%') throw new Error(`neutrality not shown: ${JSON.stringify(adAfter)}`)
  if (!page.url().includes('model=adas') || !page.url().includes('M=1200')) throw new Error(`URL not updated: ${page.url()}`)
  const adText = await page.getByTestId('explanation').textContent()
  if (!adText?.includes('화폐 중립성')) throw new Error('AD-AS explanation does not mention money neutrality')
  const dots = await page.locator('[data-testid=trajectory] circle').count()
  console.log(`adjustment path dots: ${dots}`)
  if (dots !== 41) throw new Error(`expected 41 path dots, got ${dots}`)

  // scrubber highlights a period on the time paths
  const scrub = page.locator('input[type=range][name=period]')
  await scrub.fill('3')
  const p3 = await read('path-P')
  console.log(`period 3 price: ${p3}`)
  if (!p3?.startsWith('3기:')) throw new Error(`scrubber did not move to period 3 (${p3})`)

  // rate peg: honest warning about the missing nominal anchor
  await page.getByText('금리 목표', { exact: true }).click()
  const gSlider = page.locator('input[type=range][name=G]')
  await gSlider.focus()
  for (let n = 0; n < 4; n++) await page.keyboard.press('ArrowRight')
  const warnText = await page.locator('.warnings').textContent()
  if (!warnText?.includes('닻')) throw new Error('rate-peg drift warning not shown')
  console.log('rate peg warning shown')
  if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`)

  // screenshot: M increase with the adjustment path, period 1 selected
  await page.goto(`${URL_}?model=adas&M=1200`)
  await page.locator('[data-testid=trajectory]').waitFor()
  await page.mouse.move(0, 0)
  const adOut = path.join(root, 'docs/screenshot-adas.png')
  await page.screenshot({ path: adOut, fullPage: true })
  console.log(`screenshot: ${path.relative(root, adOut)}`)

  // Phone width: panels must stack without horizontal scroll.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  phone.on('pageerror', (e) => errors.push(String(e)))
  for (const q of ['', '?model=adas&M=1200', '?model=adas&regime=rate&G=130']) {
    await phone.goto(URL_ + q)
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    console.log(`phone horizontal overflow ${q || '(IS-LM)'}: ${overflow}px`)
    if (overflow > 0) throw new Error(`horizontal scroll at phone width for ${q || 'IS-LM'}`)
  }
  if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`)
  console.log('SMOKE OK')
} catch (e) {
  failed = true
  console.error('SMOKE FAILED:', e.message)
} finally {
  await browser?.close()
  server.kill()
}
process.exit(failed ? 1 : 0)
