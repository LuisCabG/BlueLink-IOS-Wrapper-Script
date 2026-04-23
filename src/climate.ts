import { Config } from 'config'
import { Bluelink, Status, ClimateRequest } from './lib/bluelink-regions/base'
import { CLIMATE_CABIN_IMAGE } from './climate-cabin-image'
import { sleep } from 'lib/util'

const CLIMATE_STATE_KEY = 'egmp_bluelink_climate_state'
const CLIMATE_CMD_TS_KEY = 'egmp_climate_last_cmd_ts'
const CLIMATE_COOLDOWN_MS = 5 * 60 * 1000
let climateScreenOpen = false

interface SavedClimateState {
  heat: { driver: number; passenger: number; rearLeft: number; rearRight: number }
  cool: { driver: number; passenger: number; rearLeft: number; rearRight: number }
  opts: { frontDefrost: boolean; rearDefrost: boolean; steering: number }
  mode: string
  temp: number
}

function getTempBounds(tempType: string) {
  return {
    min: tempType === 'C' ? 17 : 62,
    max: tempType === 'C' ? 27 : 82,
    step: tempType === 'C' ? 0.5 : 1,
  }
}

function sanitizeClimateTemp(value: number | undefined, tempType: string, fallback: number): number {
  const { min, max, step } = getTempBounds(tempType)
  const base = Number.isFinite(value) ? (value as number) : fallback
  const clamped = Math.min(max, Math.max(min, base))
  const snapped = Math.round(clamped / step) * step
  return Math.round(snapped * 10) / 10
}

function summarizeClimateError(error: unknown): string {
  const raw =
    error instanceof Error && error.message
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Command failed. Please try again.'

  const errorDescMatch = raw.match(/"errorDesc"\s*:\s*"([^"]+)"/i)
  if (errorDescMatch?.[1]) return errorDescMatch[1]

  const responseCodeMatch = raw.match(/"responseCode"\s*:\s*([0-9]+)/i)
  if (responseCodeMatch?.[1]) return `Climate command failed (${responseCodeMatch[1]}).`

  if (raw.includes('Failed to convert temp')) return 'Unsupported target temperature.'
  if (raw.includes('poll for command completion')) return 'Climate command timed out. Please try again.'

  return raw.length > 180 ? 'Climate command failed. Please try again.' : raw
}

function saveClimateUIState(s: SavedClimateState): void {
  try {
    Keychain.set(CLIMATE_STATE_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

function loadClimateUIState(): SavedClimateState | null {
  try {
    if (!Keychain.contains(CLIMATE_STATE_KEY)) return null
    return JSON.parse(Keychain.get(CLIMATE_STATE_KEY)) as SavedClimateState
  } catch {
    return null
  }
}

function parseQS(url: string): Record<string, string> {
  const qsStart = url.indexOf('?')
  if (qsStart < 0) return {}
  const params: Record<string, string> = {}
  url
    .substring(qsStart + 1)
    .split('&')
    .forEach((pair) => {
      const eqIdx = pair.indexOf('=')
      if (eqIdx > 0) {
        const k = decodeURIComponent(pair.substring(0, eqIdx))
        const v = decodeURIComponent(pair.substring(eqIdx + 1))
        params[k] = v
      }
    })
  return params
}

function buildPayload(type: string, p: Record<string, string>): ClimateRequest {
  const tempType = p['tempType'] === 'F' ? 'F' : 'C'
  const fallbackTemp = tempType === 'C' ? 21 : 70
  const temp = sanitizeClimateTemp(parseFloat(p['temp'] ?? String(fallbackTemp)), tempType, fallbackTemp)
  const driverSeat = parseInt(p['driver'] ?? '0')
  const passengerSeat = parseInt(p['passenger'] ?? '0')
  const rearLeft = parseInt(p['rearLeft'] ?? '0')
  const rearRight = parseInt(p['rearRight'] ?? '0')
  const steering = p['steering'] === 'true' ? 1 : parseInt(p['steering'] ?? '0')
  const anySeat = driverSeat !== 0 || passengerSeat !== 0 || rearLeft !== 0 || rearRight !== 0

  if (type === 'stop') {
    return { enable: false, frontDefrost: false, rearDefrost: false, steering: 0, temp: 0, durationMinutes: 0 }
  }

  return {
    enable: true,
    temp,
    frontDefrost: p['frontDefrost'] === 'true',
    rearDefrost: p['rearDefrost'] === 'true',
    steering: isNaN(steering) ? 0 : steering,
    durationMinutes: 15,
    ...(anySeat && {
      seatClimateOption: { driver: driverSeat, passenger: passengerSeat, rearLeft, rearRight },
    }),
  }
}

function scheduleNotifications(type: string, temp: string, tempType: string, carName: string) {
  const isWarm = type === 'warm'
  const n = new Notification()
  n.title = isWarm ? 'Pre-heat Started 🔥' : 'Pre-cool Started ❄️'
  n.body = `Targeting ${temp}°${tempType}`
  void n.schedule()
  const done = new Notification()
  done.title = 'Climate Session Complete'
  done.body = `Your ${carName} should be at ${temp}°${tempType}`
  done.deliveryDate = new Date(Date.now() + 10 * 60 * 1000)
  void done.schedule()
}

async function handleClimateAction(
  webView: WebView,
  bl: Bluelink,
  cfg: Config,
  type: string,
  params: Record<string, string>,
  onComplete?: (status: Status) => void,
) {
  const loadingMsg = type === 'stop' ? 'Stopping climate...' : 'Updating climate...'
  await webView.evaluateJavaScript(`setLoading(true, ${JSON.stringify(loadingMsg)})`)

  const payload = buildPayload(type, params)
  let angle = 0

  bl.processRequest('climate', payload, async (isComplete: boolean, didSucceed: boolean, data: any) => {
    if (isComplete) {
      if (didSucceed) {
        const msg = type === 'stop' ? 'Climate stopped! ✓' : 'Climate updated! ✓'
        await webView.evaluateJavaScript(`setClimateRunning(${type === 'stop' ? 'false' : 'true'})`)
        await webView.evaluateJavaScript(`setResult(true, ${JSON.stringify(msg)})`)
        if (onComplete) onComplete(data as Status)
        if (type !== 'stop') {
          const cached = bl.getCachedStatus()
          const carName = cached?.car.nickName || cached?.car.modelName || 'your car'
          scheduleNotifications(type, params['temp'] ?? '21', cfg.tempType, carName)
        }
      } else {
        const err = summarizeClimateError(data)
        await webView.evaluateJavaScript(`setResult(false, ${JSON.stringify(err)})`)
      }
    } else {
      angle = (angle + 30) % 360
      await webView.evaluateJavaScript(`setSpinner(${angle})`)
    }
  })
}

function buildClimateHTML(
  cfg: Config,
  currentClimateStatus: string,
  isClimateOn: boolean,
  outdoorTemp: number | null,
  saved: SavedClimateState | null,
): string {
  const defaultTemp = sanitizeClimateTemp(saved?.temp, cfg.tempType, cfg.climateTempWarm)
  const { min: tempMin, max: tempMax, step: tempStep } = getTempBounds(cfg.tempType)
  const initialMode = saved?.mode ?? (outdoorTemp !== null ? (defaultTemp > outdoorTemp ? 'warm' : 'cool') : 'warm')
  const outdoorDisplay = outdoorTemp !== null ? `Outdoor: ${outdoorTemp}°${cfg.tempType}` : ''
  const savedJSON = JSON.stringify(saved)

  const frontDefrostSVG = `<svg viewBox="0 0 28 22" width="18" height="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8">
    <path d="M3 11.5C4.2 7 7.8 4 14 4s9.8 3 11 7.5"/>
    <path d="M8.5 18c-1-2.5-.8-4.8.7-7"/>
    <path d="M14 18c-1-2.5-.8-4.8.7-7"/>
    <path d="M19.5 18c-1-2.5-.8-4.8.7-7"/>
    <path d="M8.7 6.8l1.5 2.1"/>
    <path d="M14.2 6l1.5 2.1"/>
    <path d="M19.7 6.8l1.5 2.1"/>
  </svg>`

  const rearDefrostSVG = `<svg viewBox="0 0 28 22" width="18" height="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8">
    <rect x="3.5" y="5" width="21" height="11.5" rx="2.5"/>
    <path d="M8.5 18c-1-2.4-.8-4.7.7-6.8"/>
    <path d="M14 18c-1-2.4-.8-4.7.7-6.8"/>
    <path d="M19.5 18c-1-2.4-.8-4.7.7-6.8"/>
  </svg>`
  const heatSVG = `<svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6">
    <path d="M6 4c1.2 1.2 1.2 2.5 0 3.8S4.8 10.3 6 11.5"/>
    <path d="M10 3c1.4 1.3 1.4 2.8 0 4.2S8.6 9.8 10 11.2"/>
    <path d="M14 4c1.2 1.2 1.2 2.5 0 3.8s-1.2 2.5 0 3.7"/>
  </svg>`
  const coolSVG = `<svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
    <path d="M10 2v16"/>
    <path d="M4 5l12 10"/>
    <path d="M16 5L4 15"/>
    <path d="M3 10h14"/>
  </svg>`
  const powerSVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
    <path d="M12 2v10"/>
    <path d="M6.2 5.8a8 8 0 1 0 11.6 0"/>
  </svg>`

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
:root {
  --bg: #000000;
  --bg-2: #050505;
  --panel: rgba(12, 12, 13, 0.96);
  --panel-strong: rgba(18, 18, 20, 0.98);
  --border: rgba(255,255,255,0.06);
  --border-soft: rgba(255,255,255,0.05);
  --text: #f8fafc;
  --muted: rgba(255,255,255,0.58);
  --muted-2: rgba(255,255,255,0.38);
  --warm: #ff8a3d;
  --warm-soft: rgba(255,138,61,0.14);
  --cool: #57b8ff;
  --cool-soft: rgba(87,184,255,0.14);
  --success: #47d37d;
  --shadow: 0 10px 24px rgba(0,0,0,0.22);
}
body {
  background: #000;
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
  padding: 8px 10px 10px;
  min-height: 100vh;
  overflow: hidden;
}
.app-shell {
  position: relative;
  max-width: 430px;
  margin: 0 auto;
  height: calc(100vh - 18px);
  display: flex;
  flex-direction: column;
}
.hero {
  display: none;
}
.section-card {
  position: relative;
  padding: 6px 8px;
  margin-bottom: 2px;
  border-radius: 16px;
  background: var(--panel);
  border: 1px solid var(--border-soft);
  box-shadow: none;
}
#car-wrap-section {
  padding: 0;
  margin-bottom: 0;
  background: transparent;
  border: none;
}

/* Temperature */
.temp-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 2px;
}
.temp-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.temp-status {
  font-size: 12px;
  font-weight: 650;
  color: var(--text);
  line-height: 1.2;
  letter-spacing: -0.01em;
}
.temp-outdoor {
  font-size: 10px;
  color: var(--muted);
  line-height: 1.2;
}
.temp-row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  border-radius: 14px;
  padding: 0;
  background: transparent;
  border: none;
}
.temp-main {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.temp-btn {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: transparent;
  border: 1px solid rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.72);
  font-size: 17px;
  font-weight: 400;
  cursor: pointer;
}
.temp-btn:active { transform: scale(0.98); background: rgba(255,255,255,0.1); }
.temp-val {
  text-align: center;
  min-width: 94px;
  font-size: 31px;
  font-weight: 760;
  line-height: 1;
  letter-spacing: -0.06em;
  text-shadow: none;
}
.mode-badge {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  min-height: 16px;
  margin: 0;
  padding: 0;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 650;
  color: var(--text);
  letter-spacing: 0.01em;
  background: transparent;
  border: none;
  color: var(--muted);
}
.temp-actions {
  display: flex;
  justify-content: center;
  margin-top: 0;
}

.car-shell {
  position: relative;
  border-radius: 0;
  padding: 0;
  background: transparent;
  border: none;
}
.car-wrap {
  position: relative;
  height: min(650px, calc(100vh - 122px));
  min-height: 500px;
  aspect-ratio: 219 / 500;
  margin: 0 auto;
}
.car-cabin {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: center / contain no-repeat url("${CLIMATE_CABIN_IMAGE}");
  filter: drop-shadow(0 24px 28px rgba(0,0,0,0.5));
  pointer-events: none;
}

.seat {
  position: absolute;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-shadow: none;
  transition: background 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}
.seat-surface {
  position: relative;
  width: 100%;
  height: 100%;
}
.seat-actions {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: 8px;
}
.seat-actions.single {
  gap: 0;
}
.half {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  padding: 0;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.15s ease;
  -webkit-tap-highlight-color: transparent;
  background: rgba(4,4,5,0.7);
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: none;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.half:active { transform: scale(0.98); }
.half-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,0.66);
  line-height: 1;
}
.half-val  { font-size: 7px; font-weight: 800; color: rgba(255,255,255,0.24); line-height: 1; }
.half svg { width: 12px; height: 12px; }
.half.heat-active .half-val { color: #ffd3b4; }
.half.heat-active .half-icon { color: #ffd3b4; }
.half.cool-active .half-val { color: #d0f0ff; }
.half.cool-active .half-icon { color: #d0f0ff; }

#s-driver    { top: 31.2%; left: 15.8%; width: 31%; height: 27.5%; }
#s-passenger { top: 31.2%; right: 15.8%; width: 31%; height: 27.5%; }
#s-rearLeft  { top: 55.5%; left: 16.6%; width: 29.5%; height: 21.5%; }
#s-rearRight { top: 55.5%; right: 16.6%; width: 29.5%; height: 21.5%; }

.heat-1 { background: rgba(120,53,15,0.42) !important; border-color: rgba(255,138,61,0.24) !important; }
.heat-2 { background: rgba(194,65,12,0.54) !important; border-color: rgba(255,138,61,0.34) !important; }
.heat-3 { background: rgba(251,146,60,0.68) !important; border-color: rgba(255,138,61,0.48) !important; }
.cool-1 { background: rgba(12,74,110,0.42) !important; border-color: rgba(87,184,255,0.22) !important; }
.cool-2 { background: rgba(29,78,216,0.52) !important; border-color: rgba(87,184,255,0.3) !important; }
.cool-3 { background: rgba(56,189,248,0.62) !important; border-color: rgba(87,184,255,0.4) !important; }

/* Pulse confirmation */
@keyframes pulse {
  0%   { opacity: 1; }
  40%  { opacity: 0.45; }
  100% { opacity: 1; }
}
.half.confirming { animation: pulse 0.22s ease; }

.car-ctrl {
  position: absolute;
  width: 36px; height: 36px;
  border-radius: 999px;
  background: rgba(4,4,5,0.76);
  border: 1px solid rgba(255,255,255,0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  gap: 2px;
  z-index: 10;
  -webkit-tap-highlight-color: transparent;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.18s ease;
}
.car-ctrl:active { transform: scale(0.97); }
.car-ctrl svg { color: rgba(255,255,255,0.34); transition: color 0.2s; }
.ctrl-level { font-size: 8px; font-weight: 800; color: rgba(255,255,255,0.24); line-height: 1; transition: color 0.2s; }

.car-ctrl.defrost-active { border-color: rgba(71,211,125,0.45); box-shadow: none; }
.car-ctrl.defrost-active svg { color: var(--success); }
.car-ctrl.defrost-active .ctrl-level { color: var(--success); }

.car-ctrl.steer-active { border-color: rgba(255,138,61,0.4); box-shadow: none; }
.car-ctrl.steer-active svg { color: var(--warm); }
.car-ctrl.steer-active .ctrl-level { color: var(--warm); }

#ctrl-frontDefrost { top: 19%; left: 58%; transform: translateX(-50%); }
#ctrl-steering     { top: 26.2%; left: 33%; transform: translateX(-50%); }
#ctrl-rearDefrost  { bottom: 11%; left: 50%; transform: translateX(-50%); }

/* Status toast */
#status {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  opacity: 0;
  transition: opacity 0.22s ease, transform 0.22s ease;
  background: rgba(15,23,42,0.9);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 999px;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  z-index: 100;
  color: #ebebf5cc;
  box-shadow: 0 18px 30px rgba(0,0,0,0.32);
}
#status.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
#status.ok { color: #30D158; }

/* Error modal */
#err-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 200;
  align-items: center;
  justify-content: center;
}
#err-overlay.visible { display: flex; }
#err-card {
  background: #1c1c1e;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 20px;
  padding: 24px 22px 16px;
  max-width: 300px;
  width: calc(100% - 48px);
  box-shadow: 0 24px 48px rgba(0,0,0,0.5);
  text-align: center;
  animation: pop-in 0.22s cubic-bezier(0.34,1.56,0.64,1);
}
@keyframes pop-in {
  from { opacity: 0; transform: scale(0.88); }
  to   { opacity: 1; transform: scale(1); }
}
#err-title {
  font-size: 17px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 8px;
  letter-spacing: -0.01em;
}
#err-msg {
  font-size: 14px;
  color: rgba(255,255,255,0.65);
  line-height: 1.45;
  margin-bottom: 20px;
}
#err-ok {
  width: 100%;
  padding: 12px;
  border-radius: 12px;
  border: none;
  background: #FF453A;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  letter-spacing: -0.01em;
}
#err-ok:active { opacity: 0.8; }

/* Actions */
.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.act-btn {
  min-height: 42px;
  padding: 10px 14px;
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 14px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  cursor: pointer;
  letter-spacing: -0.01em;
}
.act-btn:active { opacity: 0.82; transform: scale(0.99); }
.act-btn:disabled { opacity: 0.35; pointer-events: none; }
.btn-climate {
  width: 38px;
  min-width: 38px;
  height: 38px;
  min-height: 38px;
  padding: 0;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #101012;
}
.btn-climate.running {
  border-color: rgba(71,211,125,0.35);
  color: #d8ffe7;
}

@media (max-width: 360px) {
  body { padding-left: 8px; padding-right: 8px; }
  .section-card { padding: 7px; }
  .temp-val { font-size: 31px; min-width: 88px; }
  .temp-status { font-size: 11px; }
  .car-wrap { min-height: 470px; height: min(590px, calc(100vh - 118px)); }
  .half { width: 28px; height: 28px; }
}
</style>
</head>
<body>
<div class="app-shell">
<div class="section-card">
  <div class="temp-row">
    <div class="temp-header">
      <div class="temp-meta">
        <div class="temp-status" id="car-status">${currentClimateStatus}</div>
        <div class="temp-outdoor"${outdoorDisplay ? '' : ' style="display:none"'} id="outdoor-temp">${outdoorDisplay}</div>
      </div>
      <button
        class="act-btn btn-climate${isClimateOn ? ' running' : ''}"
        id="btn-climate"
        onclick="toggleClimate()"
        aria-label="${isClimateOn ? 'Stop Climate' : 'Start Climate'}"
      >${powerSVG}</button>
    </div>
    <div class="temp-main">
      <button class="temp-btn" ontouchstart="" onclick="adjTemp(-1)">−</button>
      <div class="temp-val" id="temp-disp">${defaultTemp}°${cfg.tempType}</div>
      <button class="temp-btn" ontouchstart="" onclick="adjTemp(1)">+</button>
    </div>
  </div>
  <div class="mode-badge" id="mode-badge"></div>
</div>

<div class="section-card" id="car-wrap-section">
<div class="car-shell">
<div class="car-wrap">
  <div class="car-cabin" aria-hidden="true"></div>

  <div class="car-ctrl" id="ctrl-frontDefrost" onclick="toggleCtrl('frontDefrost')">
    ${frontDefrostSVG}
    <span class="ctrl-level" id="cl-frontDefrost">·</span>
  </div>

  <div class="car-ctrl" id="ctrl-steering" onclick="toggleCtrl('steering')">
    ${heatSVG}
    <span class="ctrl-level" id="cl-steering">·</span>
  </div>

  <div class="car-ctrl" id="ctrl-rearDefrost" onclick="toggleCtrl('rearDefrost')">
    ${rearDefrostSVG}
    <span class="ctrl-level" id="cl-rearDefrost">·</span>
  </div>

  <!-- Front seats: heat + cool halves -->
  <div class="seat" id="s-driver">
    <div class="seat-surface">
      <div class="seat-actions">
        <div class="half" id="sh-driver" onclick="cycleHeat('driver')">
          <span class="half-icon">${heatSVG}</span><span class="half-val" id="hv-driver">·</span>
        </div>
        <div class="half" id="sc-driver" onclick="cycleCool('driver')">
          <span class="half-icon">${coolSVG}</span><span class="half-val" id="cv-driver">·</span>
        </div>
      </div>
    </div>
  </div>

  <div class="seat" id="s-passenger">
    <div class="seat-surface">
      <div class="seat-actions">
        <div class="half" id="sh-passenger" onclick="cycleHeat('passenger')">
          <span class="half-icon">${heatSVG}</span><span class="half-val" id="hv-passenger">·</span>
        </div>
        <div class="half" id="sc-passenger" onclick="cycleCool('passenger')">
          <span class="half-icon">${coolSVG}</span><span class="half-val" id="cv-passenger">·</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Rear seats: heat only -->
  <div class="seat" id="s-rearLeft">
    <div class="seat-surface">
      <div class="seat-actions single">
        <div class="half" id="sh-rearLeft" onclick="cycleHeat('rearLeft')">
          <span class="half-icon">${heatSVG}</span><span class="half-val" id="hv-rearLeft">·</span>
        </div>
      </div>
    </div>
  </div>

  <div class="seat" id="s-rearRight">
    <div class="seat-surface">
      <div class="seat-actions single">
        <div class="half" id="sh-rearRight" onclick="cycleHeat('rearRight')">
          <span class="half-icon">${heatSVG}</span><span class="half-val" id="hv-rearRight">·</span>
        </div>
      </div>
    </div>
  </div>
</div>
</div>

</div><!-- /car-wrap-section -->

<div id="status"></div>

<div id="err-overlay">
  <div id="err-card">
    <div id="err-title">Command Failed</div>
    <div id="err-msg"></div>
    <button id="err-ok" onclick="closeErrModal()">OK</button>
  </div>
</div>

</div>

<script>
const IS_CANADA = ${JSON.stringify(cfg.auth.region === 'canada')}

// Canada API codes: 8=High(3), 7=Mid(2), 6=Low(1)
const HEAT_CYCLE  = IS_CANADA ? [0, 8, 7, 6] : [0, 6, 7, 8]
const HEAT_LABELS = IS_CANADA
  ? {0:'·', 8:'3', 7:'2', 6:'1'}
  : {0:'·', 6:'3', 7:'2', 8:'1'}
const HEAT_CLS    = IS_CANADA
  ? {0:'', 8:'heat-3', 7:'heat-2', 6:'heat-1'}
  : {0:'', 6:'heat-3', 7:'heat-2', 8:'heat-1'}

// API codes: 3=High(3), 4=Mid(2), 5=Low(1)
const COOL_CYCLE  = [0, 3, 4, 5]
const COOL_LABELS = {0:'·', 3:'3', 4:'2', 5:'1'}
const COOL_CLS    = {0:'', 3:'cool-3', 4:'cool-2', 5:'cool-1'}

const SAVED = ${savedJSON}
const state = {
  temp: ${defaultTemp},
  tempMin: ${tempMin},
  tempMax: ${tempMax},
  tempStep: ${tempStep},
  tempType: '${cfg.tempType}',
  outdoorTemp: ${outdoorTemp ?? 'null'},
  mode: '${initialMode}',
  climateOn: ${isClimateOn ? 'true' : 'false'},
  heat: { driver:0, passenger:0, rearLeft:0, rearRight:0 },
  cool: { driver:0, passenger:0, rearLeft:0, rearRight:0 },
  opts: { frontDefrost:false, rearDefrost:false, steering:0 },
}

var sendTimer = null
var toastTimer = null
var cooldownTimer = null
var commandInFlight = false
var queuedSend = false

function showToast(msg, cls) {
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null }
  const s = document.getElementById('status')
  s.className = cls ? 'visible ' + cls : 'visible'
  s.textContent = msg
  if (cls === 'ok' || cls === 'err') {
    toastTimer = setTimeout(function() { s.className = ''; s.textContent = '' }, 3000)
  }
}

function setCooldown(secs) {
  commandInFlight = false
  queuedSend = false
  if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null }
  var remaining = secs
  function tick() {
    if (remaining <= 0) {
      clearInterval(cooldownTimer)
      cooldownTimer = null
      var s = document.getElementById('status')
      if (s) { s.className = ''; s.textContent = '' }
      flushSend()
      return
    }
    var m = Math.floor(remaining / 60), sec = remaining % 60
    var label = m > 0 ? m + 'm ' + (sec > 0 ? sec + 's' : '') : sec + 's'
    showToast('⏳ Next command in ' + label.trim(), '')
    remaining--
  }
  tick()
  cooldownTimer = setInterval(tick, 1000)
}

function flushSend() {
  if (sendTimer) {
    clearTimeout(sendTimer)
    sendTimer = null
  }
  if (commandInFlight) {
    queuedSend = true
    showToast('Applying latest changes…', '')
    return
  }
  queuedSend = false
  sendAction()
}

function scheduleSend(delay) {
  if (sendTimer) clearTimeout(sendTimer)
  showToast(delay <= 400 ? 'Updating…' : 'Sending…', '')
  sendTimer = setTimeout(flushSend, delay)
}

function stageOrSend(delay, stagedMsg) {
  persistState()
  if (!state.climateOn) {
    showToast(stagedMsg || 'Ready to start climate', '')
    return
  }
  scheduleSend(delay)
}

function autoMode() {
  if (state.outdoorTemp === null) return
  const m = state.temp > state.outdoorTemp ? 'warm' : 'cool'
  setMode(m)
}

function setMode(m) {
  state.mode = m
  const badge = document.getElementById('mode-badge')
  if (badge) badge.textContent = m === 'warm' ? 'Auto Heat' : 'Auto Cool'
}

function updateClimateStatusLine() {
  const status = document.getElementById('car-status')
  if (!status) return
  status.textContent = state.climateOn ? 'Currently on' : 'Currently off'
}

function setClimateRunning(isRunning) {
  state.climateOn = !!isRunning
  const btn = document.getElementById('btn-climate')
  if (!btn) return
  btn.className = 'act-btn btn-climate' + (state.climateOn ? ' running' : '')
  btn.setAttribute('aria-label', state.climateOn ? 'Stop Climate' : 'Start Climate')
  updateClimateStatusLine()
}
;(function initMode() {
  setMode(state.mode)
  setClimateRunning(state.climateOn)
})()

function persistState() {
  const { heat, cool, opts, mode, temp } = state
  const p = new URLSearchParams({
    dH: String(heat.driver),   pH:  String(heat.passenger),
    rlH: String(heat.rearLeft), rrH: String(heat.rearRight),
    dC: String(cool.driver),   pC:  String(cool.passenger),
    rlC: String(cool.rearLeft), rrC: String(cool.rearRight),
    fd: String(opts.frontDefrost), rd: String(opts.rearDefrost),
    st: String(opts.steering), mode, temp: String(temp),
  })
  location.href = 'bluelink://climate-state?' + p.toString()
}

// Restore saved seat + defrost state on load
;(function restoreSaved() {
  if (!SAVED) return
  var seats = ['driver','passenger','rearLeft','rearRight']
  seats.forEach(function(id) {
    var h = (SAVED.heat && SAVED.heat[id]) || 0
    var c = (SAVED.cool && SAVED.cool[id]) || 0
    if (h > 0) {
      state.heat[id] = h
      var hEl = document.getElementById('sh-' + id)
      if (hEl) { hEl.className = 'half heat-active ' + (HEAT_CLS[h] || ''); document.getElementById('hv-' + id).textContent = HEAT_LABELS[h] || '·' }
    }
    if (c > 0) {
      state.cool[id] = c
      var cEl = document.getElementById('sc-' + id)
      if (cEl) { cEl.className = 'half cool-active ' + (COOL_CLS[c] || ''); document.getElementById('cv-' + id).textContent = COOL_LABELS[c] || '·' }
    }
    updateSeatCard(id)
  })
  if (SAVED.opts) {
    ;['frontDefrost','rearDefrost'].forEach(function(id) {
      if (!SAVED.opts[id]) return
      state.opts[id] = true
      var el = document.getElementById('ctrl-' + id)
      var lv = document.getElementById('cl-' + id)
      if (el) el.className = 'car-ctrl defrost-active'
      if (lv) lv.textContent = '1'
    })
    var steering = typeof SAVED.opts.steering === 'number' ? SAVED.opts.steering : (SAVED.opts.steering ? 1 : 0)
    state.opts.steering = steering
    updateSteeringControl()
  }
})()

function adjTemp(dir) {
  const next = Math.round((state.temp + dir * state.tempStep) * 10) / 10
  if (next < state.tempMin || next > state.tempMax) return
  state.temp = next
  document.getElementById('temp-disp').textContent = next + '°' + state.tempType
  autoMode()
  stageOrSend(700, 'Temperature saved')
}

function confirmPulse(el) {
  el.classList.remove('confirming')
  void el.offsetWidth
  el.classList.add('confirming')
  el.addEventListener('animationend', () => el.classList.remove('confirming'), { once: true })
}

function updateSeatCard(id) {
  const h = state.heat[id], c = state.cool[id]
  const card = document.getElementById('s-' + id)
  if (h > 0) {
    card.style.borderColor = 'rgba(255,138,61,0.18)'
    card.style.background = 'rgba(255,138,61,0.08)'
    card.style.boxShadow = 'inset 0 0 0 1px rgba(255,138,61,0.12), 0 0 18px rgba(255,138,61,0.1)'
  } else if (c > 0) {
    card.style.borderColor = 'rgba(87,184,255,0.18)'
    card.style.background = 'rgba(87,184,255,0.08)'
    card.style.boxShadow = 'inset 0 0 0 1px rgba(87,184,255,0.12), 0 0 18px rgba(87,184,255,0.1)'
  } else {
    card.style.borderColor = 'transparent'
    card.style.background = 'transparent'
    card.style.boxShadow = 'none'
  }
}

function cycleHeat(id) {
  const next = HEAT_CYCLE[(HEAT_CYCLE.indexOf(state.heat[id]) + 1) % HEAT_CYCLE.length]
  state.heat[id] = next
  if (next > 0) state.cool[id] = 0
  const hEl = document.getElementById('sh-' + id)
  hEl.className = 'half heat-active ' + (HEAT_CLS[next] || '')
  document.getElementById('hv-' + id).textContent = HEAT_LABELS[next]
  const cEl = document.getElementById('sc-' + id)
  if (cEl && state.cool[id] === 0) { cEl.className = 'half'; document.getElementById('cv-' + id).textContent = '·' }
  confirmPulse(hEl)
  updateSeatCard(id)
  stageOrSend(200, 'Seat heat saved')
}

function cycleCool(id) {
  const next = COOL_CYCLE[(COOL_CYCLE.indexOf(state.cool[id]) + 1) % COOL_CYCLE.length]
  state.cool[id] = next
  if (next > 0) state.heat[id] = 0
  const cEl = document.getElementById('sc-' + id)
  cEl.className = 'half cool-active ' + (COOL_CLS[next] || '')
  document.getElementById('cv-' + id).textContent = COOL_LABELS[next]
  const hEl = document.getElementById('sh-' + id)
  if (state.heat[id] === 0) { hEl.className = 'half'; document.getElementById('hv-' + id).textContent = '·' }
  confirmPulse(cEl)
  updateSeatCard(id)
  stageOrSend(200, 'Seat cooling saved')
}

function updateSteeringControl() {
  const level = state.opts.steering || 0
  const el = document.getElementById('ctrl-steering')
  const lv = document.getElementById('cl-steering')
  el.className = 'car-ctrl' + (level > 0 ? ' steer-active' : '')
  lv.textContent = level > 0 ? String(level) : '·'
}

function toggleCtrl(id) {
  if (id === 'steering') {
    state.opts.steering = state.opts.steering > 0 ? 0 : 1
    updateSteeringControl()
  } else {
    state.opts[id] = !state.opts[id]
    const on = state.opts[id]
    const el = document.getElementById('ctrl-' + id)
    const lv = document.getElementById('cl-' + id)
    el.className = 'car-ctrl' + (on ? ' defrost-active' : '')
    lv.textContent = on ? '1' : '·'
  }
  stageOrSend(200, 'Climate setting saved')
}

function seatVal(id) { return state.heat[id] || state.cool[id] || 0 }

function sendAction() {
  commandInFlight = true
  const { opts, temp, mode } = state
  const p = new URLSearchParams({
    type: mode,
    temp: String(temp),
    driver: String(seatVal('driver')),
    passenger: String(seatVal('passenger')),
    rearLeft: String(seatVal('rearLeft')),
    rearRight: String(seatVal('rearRight')),
    frontDefrost: String(opts.frontDefrost),
    rearDefrost: String(opts.rearDefrost),
    steering: String(opts.steering),
    tempType: state.tempType,
    _t: String(Date.now()),
  })
  location.href = 'bluelink://climate?' + p.toString()
}

function toggleClimate() {
  if (state.climateOn) {
    sendStop()
  } else {
    if (sendTimer) {
      clearTimeout(sendTimer)
      sendTimer = null
    }
    queuedSend = false
    sendAction()
  }
}

function sendStop() {
  if (sendTimer) {
    clearTimeout(sendTimer)
    sendTimer = null
  }
  queuedSend = false
  commandInFlight = true
  location.href = 'bluelink://climate?type=stop'
}

function setLoading(on, msg) {
  if (on) showToast(msg || 'Sending…', '')
  else {
    commandInFlight = false
    const s = document.getElementById('status')
    s.className = ''
    s.textContent = ''
    if (queuedSend) setTimeout(flushSend, 100)
  }
}
function showErrModal(msg) {
  var overlay = document.getElementById('err-overlay')
  var msgEl = document.getElementById('err-msg')
  if (overlay) overlay.className = 'visible'
  if (msgEl) msgEl.textContent = msg
}
function closeErrModal() {
  var overlay = document.getElementById('err-overlay')
  if (overlay) overlay.className = ''
}
function setResult(ok, msg) {
  commandInFlight = false
  if (ok) {
    showToast(msg, 'ok')
  } else {
    var s = document.getElementById('status')
    if (s) { s.className = ''; s.textContent = '' }
    showErrModal(msg)
  }
  if (queuedSend) setTimeout(flushSend, 100)
}
function setSpinner(_angle) { showToast('↻  Waiting for car…', '') }
</script>
</body>
</html>`
}

const OUTDOOR_TEMP_CACHE_KEY = 'egmp_outdoor_temp_cache'
const OUTDOOR_TEMP_TTL = 30 * 60 * 1000

async function getOutdoorTemp(tempType: string): Promise<number | null> {
  try {
    if (Keychain.contains(OUTDOOR_TEMP_CACHE_KEY)) {
      const cached = JSON.parse(Keychain.get(OUTDOOR_TEMP_CACHE_KEY)) as { temp: number; ts: number; unit: string }
      if (cached.unit === tempType && Date.now() - cached.ts < OUTDOOR_TEMP_TTL) return cached.temp
    }
  } catch {
    /* ignore */
  }
  try {
    const loc = await Location.current()
    const req = new Request(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m&temperature_unit=celsius`,
    )
    const json = (await req.loadJSON()) as { current?: { temperature_2m?: number } }
    const c = json?.current?.temperature_2m
    if (c == null) return null
    const temp = tempType === 'F' ? Math.round(c * 1.8 + 32) : Math.round(c * 2) / 2
    Keychain.set(OUTDOOR_TEMP_CACHE_KEY, JSON.stringify({ temp, ts: Date.now(), unit: tempType }))
    return temp
  } catch {
    return null
  }
}

export async function loadClimateControlScreen(config: Config, bl: Bluelink, onComplete?: (status: Status) => void) {
  if (climateScreenOpen) return
  climateScreenOpen = true
  const cachedStatus = bl.getCachedStatus()
  const isOn = cachedStatus?.status.climate ?? false
  const temp = cachedStatus?.status.climateTemp
  const currentStatus = isOn
    ? temp !== undefined
      ? `Currently on — ${temp}°${config.tempType}`
      : 'Currently on'
    : 'Currently off'

  const outdoorTemp = await getOutdoorTemp(config.tempType)
  const saved = loadClimateUIState()

  const webView = new WebView()
  const html = buildClimateHTML(config, currentStatus, isOn, outdoorTemp, saved)
  await webView.loadHTML(html)

  webView.shouldAllowRequest = (req: { url: string }) => {
    if (!req.url.startsWith('bluelink://climate')) return true

    if (req.url.startsWith('bluelink://climate-state')) {
      const p = parseQS(req.url)
      saveClimateUIState({
        heat: {
          driver: parseInt(p['dH'] ?? '0'),
          passenger: parseInt(p['pH'] ?? '0'),
          rearLeft: parseInt(p['rlH'] ?? '0'),
          rearRight: parseInt(p['rrH'] ?? '0'),
        },
        cool: {
          driver: parseInt(p['dC'] ?? '0'),
          passenger: parseInt(p['pC'] ?? '0'),
          rearLeft: parseInt(p['rlC'] ?? '0'),
          rearRight: parseInt(p['rrC'] ?? '0'),
        },
        opts: {
          frontDefrost: p['fd'] === 'true',
          rearDefrost: p['rd'] === 'true',
          steering: p['st'] === 'true' ? 1 : parseInt(p['st'] ?? '0') || 0,
        },
        mode: p['mode'] ?? 'warm',
        temp: parseFloat(p['temp'] ?? String(config.climateTempWarm)),
      })
      return false
    }

    const params = parseQS(req.url)
    const type = params['type']
    if (!type) return false

    // Enforce cooldown between climate commands (except stop — always allowed)
    if (type !== 'stop') {
      const lastTs = Keychain.contains(CLIMATE_CMD_TS_KEY) ? parseInt(Keychain.get(CLIMATE_CMD_TS_KEY)) : 0
      const remaining = CLIMATE_COOLDOWN_MS - (Date.now() - lastTs)
      if (remaining > 0) {
        const secs = Math.ceil(remaining / 1000)
        webView.evaluateJavaScript(`setCooldown(${secs})`).catch(() => {})
        return false
      }
      Keychain.set(CLIMATE_CMD_TS_KEY, String(Date.now()))
    }

    handleClimateAction(webView, bl, config, type, params, onComplete)

    return false
  }

  await webView.present(false)
  climateScreenOpen = false

  await sleep(100)
}
