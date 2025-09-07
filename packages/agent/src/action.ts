import { Page, Frame } from 'playwright'
import * as path from 'path'
import * as fs from 'fs'

// Normalize container to a Page (Frame → Page)
function asPage(container: Page | Frame): Page {
  // Page has .frames(); Frame doesn’t
  return (container as any).frames ? (container as Page) : (container as Frame).page()
}

// Resolve a Frame by index or by iframe selector
async function getFrame(container: Page | Frame, iframe: number | string): Promise<Frame> {
  const page = asPage(container)

  if (typeof iframe === 'number') {
    const f = page.frames()[iframe]
    if (!f) throw new Error(`frame index not found: ${iframe}`)
    return f
  }

  // iframe is a selector for the <iframe> element (css=..., text=..., etc.)
  const handle = await page.waitForSelector(iframe, { timeout: 15000 })
  const frame = await handle.contentFrame()
  if (!frame) throw new Error(`no contentFrame for selector: ${iframe}`)
  return frame
}

export async function selectDropdown(p: Page, selector: string, valueOrLabel: string) {
  const sel = resolveSelector(selector)
  const el = await p.waitForSelector(sel, { timeout: 15000 })
  // Try by value first; if nothing selected, try by label
  const byValue = await el.selectOption({ value: valueOrLabel })
  if (!byValue || byValue.length === 0) {
    await el.selectOption({ label: valueOrLabel })
  }
  return `selected '${valueOrLabel}' in ${selector}`
}

export async function setCheckbox(p: Page, selector: string, checked = true) {
  const sel = resolveSelector(selector)
  const el = await p.waitForSelector(sel, { timeout: 15000 })
  const isChecked = await el.isChecked().catch(() => false)
  if (checked && !isChecked) await el.check()
  if (!checked && isChecked) await el.uncheck()
  return `checkbox ${selector} -> ${checked ? 'checked' : 'unchecked'}`
}

// ----- Frames -----
export async function frameClick(p: Page, iframe: number | string, selector: string) {
  const fr = await getFrame(p, iframe)
  const sel = resolveSelector(selector)
  await fr.click(sel, { timeout: 15000 })
  return `frame[${String(iframe)}] clicked ${selector}`
}

export async function frameType(p: Page, iframe: number | string, selector: string, text: string) {
  const fr = await getFrame(p, iframe)
  const sel = resolveSelector(selector)
  await fr.fill(sel, text, { timeout: 15000 })
  return `frame[${String(iframe)}] typed '${text}' into ${selector}`
}

export async function frameGetText(p: Page, iframe: number | string, selector: string) {
  const fr = await getFrame(p, iframe)
  const sel = resolveSelector(selector)
  const el = await fr.waitForSelector(sel, { timeout: 15000 })
  const txt = (await el.textContent())?.trim() || ''
  return { selector, text: txt, frame: String(iframe) }
}


function resolveSelector(sel: string): string {
  if (sel.startsWith('role=')) {
    return sel // or use page.getByRole in callers
  }
  if (sel.startsWith('text=')) {
    return sel
  }
  if (sel.startsWith('css=')) {
    return sel.slice(4)
  }
  return sel
}

/** Wait until network is quiet for `idleMs` (no requests) or timeout */
export async function waitNetworkIdle(p: Page, idleMs = 800, timeoutMs = 15000) {
  let inFlight = 0
  let idleResolve!: () => void
  let idleTimer: NodeJS.Timeout | null = null
  const done = new Promise<void>((res) => (idleResolve = res))

  const bump = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (inFlight === 0) idleResolve()
    }, idleMs)
  }

  const onReq = () => { inFlight++; }
  const onDone = () => { inFlight = Math.max(0, inFlight - 1); bump() }

  p.on('request', onReq)
  p.on('requestfinished', onDone)
  p.on('requestfailed', onDone)

  // kick the first timer
  bump()

  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; idleResolve() }, timeoutMs)
  await done
  clearTimeout(timeout)
  p.off('request', onReq)
  p.off('requestfinished', onDone)
  p.off('requestfailed', onDone)

  if (timedOut) return `waitNetworkIdle timed out after ${timeoutMs}ms`
  return `network idle (${idleMs}ms window)`
}

/** Download first link/resource matching selector (or page download) into ./.downloads */
export async function download(p: Page, selector?: string) {
  const dir = path.resolve(process.cwd(), '.downloads')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  // Many pages require a user gesture; we’ll wait for Playwright’s 'download' event
  const [dl] = await Promise.all([
    p.waitForEvent('download', { timeout: 30000 }),
    selector ? p.click(resolveSelector(selector)) : Promise.resolve(null),
  ])

  const suggested = dl.suggestedFilename()
  const filePath = path.join(dir, suggested)
  await dl.saveAs(filePath)
  return `downloaded -> ${filePath}`
}





