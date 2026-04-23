import { Config } from 'config'
import { Bluelink, Status, ChargeLimit } from './lib/bluelink-regions/base'
import { quickOptions, destructiveConfirm } from 'lib/scriptable-utils'
import { loadConfigScreen, deleteConfig, setConfig } from 'config'
import { Version } from 'lib/version'
import { loadAboutScreen, doDowngrade } from 'about'
import { loadClimateControlScreen } from 'climate'
import { deleteWidgetCache } from 'widget'
import { getAppLogger } from './lib/util'
import { getWidgetLogger } from 'widget'
import { sleep } from 'lib/util'

const logger = getAppLogger()

function chargeLimitName(chargeLimit: ChargeLimit | undefined, config: Config): string {
  if (!chargeLimit) return ''
  const match = config.chargeLimits.find(
    (x) => x.acPercent === chargeLimit.acPercent && x.dcPercent === chargeLimit.dcPercent,
  )
  return match?.name ?? `${chargeLimit.acPercent}%`
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
        params[decodeURIComponent(pair.substring(0, eqIdx))] = decodeURIComponent(pair.substring(eqIdx + 1))
      }
    })
  return params
}

async function pushStateUpdate(
  webView: WebView,
  status: Status,
  distUnit: string,
  config: Config,
  locationText?: string,
) {
  const update = {
    name: status.car.nickName || status.car.modelName,
    vin: status.car.vin,
    soc: status.status.soc,
    range: status.status.range,
    isCharging: status.status.isCharging,
    isPluggedIn: status.status.isPluggedIn,
    locked: status.status.locked,
    odometer: status.status.odometer,
    twelveSoc: status.status.twelveSoc,
    chargeLimitText: chargeLimitName(status.status.chargeLimit, config),
    distUnit,
    locationText,
  }
  await webView.evaluateJavaScript(`updateState(${JSON.stringify(update)})`)
}

async function doApiAction(
  webView: WebView,
  bl: Bluelink,
  command: string,
  payload: any,
  loadingMsg: string,
  successMsg: string,
  failMsg: string,
  onSuccess?: (data: any) => Promise<void>,
) {
  await webView.evaluateJavaScript(`setLoading(${JSON.stringify(loadingMsg)})`)
  bl.processRequest(command, payload ?? undefined, async (isComplete: boolean, didSucceed: boolean, data: any) => {
    if (isComplete) {
      if (didSucceed) {
        await webView.evaluateJavaScript(`setResult(true, ${JSON.stringify(successMsg)})`)
        if (onSuccess) await onSuccess(data)
      } else {
        await webView.evaluateJavaScript(`setResult(false, ${JSON.stringify(failMsg)})`)
        logger.log(`${command} failed: ${JSON.stringify(data)}`)
      }
      sleep(3000).then(() => webView.evaluateJavaScript('clearStatus()').catch(() => {}))
    } else {
      await webView.evaluateJavaScript(`setLoading('↻  Waiting for car...')`)
    }
  })
}

function handleMainAction(
  webView: WebView,
  bl: Bluelink,
  config: Config,
  type: string,
  state: { isCharging: boolean; isPluggedIn: boolean; locked: boolean },
) {
  if (type === 'charge') {
    if (!state.isPluggedIn) return
    const starting = !state.isCharging
    doApiAction(
      webView,
      bl,
      starting ? 'startCharge' : 'stopCharge',
      undefined,
      starting ? 'Starting charging...' : 'Stopping charging...',
      starting ? 'Charging started! ✓' : 'Charging stopped! ✓',
      `Failed to ${starting ? 'start' : 'stop'} charging!`,
      async () => {
        const cached = bl.getCachedStatus()
        await pushStateUpdate(
          webView,
          { ...cached, status: { ...cached.status, isCharging: starting } } as Status,
          bl.getDistanceUnit(),
          config,
        )
      },
    )
  } else if (type === 'lock') {
    const locking = !state.locked
    doApiAction(
      webView,
      bl,
      locking ? 'lock' : 'unlock',
      undefined,
      locking ? 'Locking car...' : 'Unlocking car...',
      locking ? 'Car locked! ✓' : 'Car unlocked! ✓',
      `Failed to ${locking ? 'lock' : 'unlock'} car!`,
      async () => {
        const cached = bl.getCachedStatus()
        await pushStateUpdate(
          webView,
          { ...cached, status: { ...cached.status, locked: locking } } as Status,
          bl.getDistanceUnit(),
          config,
        )
      },
    )
  } else if (type === 'status') {
    doApiAction(
      webView,
      bl,
      'status',
      undefined,
      'Refreshing status...',
      'Status updated! ✓',
      'Failed to refresh status!',
      async (data) => pushStateUpdate(webView, data as Status, bl.getDistanceUnit(), config),
    )
  } else if (type === 'chargeLimit') {
    const chargeLimits = Object.values(config.chargeLimits).map((x) => x.name)
    quickOptions(chargeLimits.concat(['Cancel']), {
      title: 'Confirm charge limit to set',
      onOptionSelect: (opt) => {
        if (opt === 'Cancel') return
        const payload = Object.values(config.chargeLimits).find((x) => x.name === opt)
        if (!payload) return
        doApiAction(
          webView,
          bl,
          'chargeLimit',
          payload,
          'Setting charge limit...',
          `Charge limit ${payload.name} set! ✓`,
          'Failed to set charge limit!',
          async (data) => pushStateUpdate(webView, data as Status, bl.getDistanceUnit(), config),
        )
      },
    })
  }
}

function handleNav(webView: WebView, bl: Bluelink, config: Config, dest: string) {
  if (dest === 'about') {
    loadAboutScreen()
  } else if (dest === 'settings') {
    loadConfigScreen(bl)
  } else if (dest === 'climate') {
    loadClimateControlScreen(config, bl, async (data) => {
      await pushStateUpdate(webView, data, bl.getDistanceUnit(), config)
    })
  } else if (dest === 'location') {
    quickOptions(['On Google Maps', 'On Apple Maps', 'Cancel'], {
      title: 'Get Location of Car?',
      onOptionSelect: (opt) => {
        if (opt === 'Cancel') return
        doApiAction(
          webView,
          bl,
          'location',
          undefined,
          'Getting location...',
          'Got location! ✓',
          'Failed to get location!',
          async (data: Status) => {
            await pushStateUpdate(webView, data, bl.getDistanceUnit(), config)
            if (data.status.location) {
              const maps = new CallbackURL(opt === 'On Google Maps' ? 'comgooglemaps://' : 'http://maps.apple.com/')
              maps.addParameter('q', `${data.status.location.latitude},${data.status.location.longitude}`)
              maps.open()
            }
          },
        )
      },
    })
  } else if (dest === 'debugMenu') {
    quickOptions(['Share Debug Logs', 'Reset All Settings', 'Downgrade to Previous Version', 'Cancel'], {
      title: 'Choose Debug Option:',
      onOptionSelect: (opt) => {
        if (opt === 'Cancel') return
        switch (opt) {
          case 'Share Debug Logs': {
            const blRedactedLogs = bl.getLogger().readAndRedact()
            const widgetLogs = getWidgetLogger().read()
            const appLogs = getAppLogger().read()
            ShareSheet.present(['Bluelink API logs:', blRedactedLogs, 'Widget Logs', widgetLogs, 'App Logs', appLogs])
            break
          }
          case 'Reset All Settings': {
            destructiveConfirm('Confirm Setting Reset - ALL settings/data will be removed', {
              confirmButtonTitle: 'Delete all Settings/Data',
              onConfirm: () => {
                bl.deleteCache()
                deleteConfig()
                deleteWidgetCache()
                // @ts-ignore - undocumented api
                App.close()
              },
            })
            break
          }
          case 'Downgrade to Previous Version': {
            destructiveConfirm('Confirm downgrade to saved older app version?', {
              confirmButtonTitle: 'Yes, downgrade',
              onConfirm: () => {
                doDowngrade()
                // @ts-ignore - undocumented api
                App.close()
              },
            })
            break
          }
        }
      },
    })
  }
}

function buildMainHTML(config: Config, status: Status, carImageB64: string, distUnit: string): string {
  const { car, status: s } = status
  const name = car.nickName || car.modelName
  const isPluggedIn = s.isPluggedIn
  const isCharging = s.isCharging
  const locked = s.locked
  const chargeLimitText = chargeLimitName(s.chargeLimit, config)
  const initialState = {
    name,
    vin: car.vin,
    soc: s.soc,
    range: s.range,
    isCharging,
    isPluggedIn,
    locked,
    odometer: s.odometer,
    twelveSoc: s.twelveSoc,
    chargeLimitText,
    distUnit,
  }

  const chargeSVG = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`
  const climateSVG = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>`
  const lockSVG = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
  const unlockSVG = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`
  const chargeLimitSVG = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/><line x1="0" y1="21" x2="24" y2="21"/></svg>`
  const refreshSVG = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>`
  const twelveSVG = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>`
  const settingsSVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`
  const aboutSVG = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16" stroke-width="3"/></svg>`

  const socClass = isCharging ? 'charging' : s.soc < 20 ? 'low' : 'normal'

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
html, body { height: 100%; overflow: hidden; background: #000; color: #fff; font-family: -apple-system, sans-serif; }
body { display: flex; flex-direction: column; }

.page {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
  padding: max(20px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
}

/* ── Header ── */
.header { display: flex; align-items: flex-start; justify-content: space-between; flex-shrink: 0; gap: 12px; }
.header h1 { font-size: 26px; font-weight: 700; flex: 1; letter-spacing: -0.5px; }
.header-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.icon-btn {
  background: none; border: none; color: #8E8E93; padding: 6px; cursor: pointer;
  border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  transition: transform 0.15s, opacity 0.15s;
}
.icon-btn:active { transform: scale(0.85); opacity: 0.5; }

/* ── SOC block ── */
.soc-block { flex-shrink: 0; margin-top: 6px; }
.soc-row { display: flex; align-items: baseline; gap: 8px; }
.soc-num {
  font-size: 48px; font-weight: 700; letter-spacing: -2px;
  transition: color 0.4s;
}
.soc-num.charging { color: #30D158; }
.soc-num.normal   { color: #fff; }
.soc-num.low      { color: #FF453A; }
.soc-detail { font-size: 15px; color: #8E8E93; display: flex; align-items: center; gap: 5px; }
.charge-badge {
  font-size: 13px; font-weight: 600; padding: 2px 8px; border-radius: 20px;
  opacity: 0; transform: translateY(4px);
  transition: opacity 0.3s, transform 0.3s;
}
.charge-badge.visible { opacity: 1; transform: translateY(0); }
.charge-badge.charging { background: #0D2E1A; color: #30D158; }
.charge-badge.plugged   { background: #1A1A2E; color: #0A84FF; }

/* ── Battery bar ── */
.bar-track {
  height: 6px; background: #2C2C2E; border-radius: 3px;
  margin-top: 10px; overflow: hidden;
}
.bar-fill {
  height: 100%; border-radius: 3px;
  transition: width 0.6s cubic-bezier(0.4,0,0.2,1), background-color 0.4s;
}
.bar-fill.charging { background: #30D158; }
.bar-fill.normal   { background: #0A84FF; }
.bar-fill.low      { background: #FF453A; }

@keyframes bar-pulse {
  0%,100% { opacity: 1; } 50% { opacity: 0.55; }
}
.bar-fill.charging { animation: bar-pulse 2s ease-in-out infinite; }

/* ── Car image ── */
.car-img-wrap {
  flex: 1; min-height: 0;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; margin: 8px 0;
  transition: transform 0.2s, opacity 0.2s;
}
.car-img-wrap:active { transform: scale(0.97); opacity: 0.8; }
.car-img-wrap img { max-width: 100%; max-height: 100%; object-fit: contain; }

/* ── Icon bar ── */
.icon-bar {
  display: flex; align-items: center;
  background: #1C1C1E; border-radius: 18px;
  padding: 8px 0; flex-shrink: 0;
}
.icon-item {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 8px 2px; gap: 4px; cursor: pointer; min-width: 0;
  transition: transform 0.15s, opacity 0.15s;
  transform-origin: center bottom;
}
.icon-item:active { transform: scale(0.82); opacity: 0.6; }
.icon-item.faded { opacity: 0.28; pointer-events: none; }
.icon-badge {
  font-size: 9px; color: #8E8E93; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 52px;
  transition: color 0.2s;
}
.icon-item.active-state .icon-badge { color: #30D158; }

/* Spinning refresh */
@keyframes spin { to { transform: rotate(360deg); } }
.spinning { animation: spin 0.7s linear infinite; display: inline-flex; }

/* Charging pulse on lightning icon */
@keyframes zap-pulse {
  0%,100% { transform: scale(1);   opacity: 1; }
  50%      { transform: scale(1.2); opacity: 0.7; }
}
.zap-anim { animation: zap-pulse 1.4s ease-in-out infinite; display: inline-flex; }

/* Lock morph */
.lock-wrap { transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1); display: inline-flex; }
.lock-wrap.unlocking { transform: scale(1.25) rotate(-8deg); }

/* ── Status bar ── */
#status {
  overflow: hidden; max-height: 0; border-radius: 12px;
  font-size: 13px; font-weight: 500; text-align: center;
  transition: max-height 0.28s cubic-bezier(0.4,0,0.2,1),
              padding    0.28s cubic-bezier(0.4,0,0.2,1),
              margin     0.28s cubic-bezier(0.4,0,0.2,1);
  flex-shrink: 0;
}
#status.loading { max-height: 50px; padding: 10px 16px; margin-top: 8px; background: #2C2C2E; color: #FF9F0A; }
#status.ok      { max-height: 50px; padding: 10px 16px; margin-top: 8px; background: #0D2E1A; color: #30D158; }
#status.err     { max-height: 50px; padding: 10px 16px; margin-top: 8px; background: #2E0D0D; color: #FF453A; }

/* ── Footer ── */
.footer { display: flex; justify-content: space-between; padding: 0 2px; margin-top: 8px; flex-shrink: 0; }
.footer span { font-size: 11px; color: #636366; }

</style>
</head>
<body>
<div class="page">

  <div class="header">
    <h1 id="car-name">${name}</h1>
    <div class="header-actions">
      <button class="icon-btn" onclick="settingsTap()" aria-label="Settings">${settingsSVG}</button>
      <button class="icon-btn" onclick="nav('about')" aria-label="Information">${aboutSVG}</button>
    </div>
  </div>

  <div class="soc-block">
    <div class="soc-row">
      <span class="soc-num ${socClass}" id="soc">${s.soc}%</span>
      <span class="soc-detail">
        <span id="range">~ ${s.range} ${distUnit}</span>
        <span class="charge-badge${isCharging ? ' visible charging' : isPluggedIn ? ' visible plugged' : ''}" id="charge-badge">
          ${isCharging ? '⚡ Charging' : isPluggedIn ? '🔌 Plugged in' : ''}
        </span>
      </span>
    </div>
    <div class="bar-track">
      <div class="bar-fill ${socClass}" id="soc-bar" style="width:${s.soc}%"></div>
    </div>
    <div id="car-location" style="font-size:12px;color:#636366;margin-top:5px;min-height:16px"></div>
  </div>

  <div class="car-img-wrap" onclick="nav('location')">
    <img id="car-img" src="data:image/png;base64,${carImageB64}" />
  </div>

  <div class="icon-bar">
    <div class="icon-item${isPluggedIn ? '' : ' faded'}" id="icon-charge" onclick="act('charge')">
      <span id="charge-icon-wrap" class="${isCharging ? 'zap-anim' : ''}">${chargeSVG}</span>
      <span class="icon-badge" id="badge-charge">${isCharging ? 'Stop' : 'Charge'}</span>
    </div>
    <div class="icon-item" id="icon-climate" onclick="nav('climate')">
      ${climateSVG}
      <span class="icon-badge">Climate</span>
    </div>
    <div class="icon-item" id="icon-lock" onclick="act('lock')">
      <span class="lock-wrap" id="lock-wrap"><span id="lock-icon">${locked ? lockSVG : unlockSVG}</span></span>
      <span class="icon-badge" id="badge-lock">${locked ? 'Locked' : 'Unlocked'}</span>
    </div>
    <div class="icon-item" id="icon-climit" onclick="act('chargeLimit')">
      ${chargeLimitSVG}
      <span class="icon-badge" id="badge-climit">${chargeLimitText}</span>
    </div>
    <div class="icon-item" id="icon-refresh" onclick="act('status')">
      <span id="refresh-icon-wrap">${refreshSVG}</span>
      <span class="icon-badge">Refresh</span>
    </div>
    <div class="icon-item" id="icon-12v">
      ${twelveSVG}
      <span class="icon-badge" id="badge-12v">${s.twelveSoc}%</span>
    </div>
  </div>

  <div id="status"></div>

  <div class="footer">
    <span id="odometer">${s.odometer.toLocaleString()} ${distUnit}</span>
    <span id="vin">VIN ${car.vin}</span>
  </div>

</div>
<script>
const LOCK_SVG   = ${JSON.stringify(lockSVG)}
const UNLOCK_SVG = ${JSON.stringify(unlockSVG)}
let state = ${JSON.stringify(initialState)}
let _sTaps = 0, _sTimer = null

function act(type) {
  const p = new URLSearchParams({
    type,
    isCharging:  String(state.isCharging),
    isPluggedIn: String(state.isPluggedIn),
    locked:      String(state.locked),
    _t:          String(Date.now()),
  })
  location.href = 'bluelink://action?' + p.toString()
}

function nav(dest) {
  location.href = 'bluelink://nav?to=' + dest + '&_t=' + Date.now()
}

function settingsTap() {
  _sTaps++
  clearTimeout(_sTimer)
  if (_sTaps >= 3) { _sTaps = 0; nav('debugMenu'); return }
  _sTimer = setTimeout(function() {
    if (_sTaps > 0) nav('settings')
    _sTaps = 0
  }, 450)
}

function setLoading(msg) {
  var el = document.getElementById('status')
  el.className = 'loading'
  el.textContent = msg || 'Updating...'
  // spin the refresh icon
  var rw = document.getElementById('refresh-icon-wrap')
  if (rw) rw.className = 'spinning'
}
function setResult(ok, msg) {
  var el = document.getElementById('status')
  el.className = ok ? 'ok' : 'err'
  el.textContent = msg
  var rw = document.getElementById('refresh-icon-wrap')
  if (rw) rw.className = ''
}
function clearStatus() {
  document.getElementById('status').className = ''
}

function animateNumber(el, newVal, suffix) {
  var start = parseInt(el.textContent) || 0
  var end = parseInt(newVal)
  if (isNaN(end) || start === end) { el.textContent = newVal + (suffix||''); return }
  var steps = 20, i = 0
  var id = setInterval(function() {
    i++
    el.textContent = Math.round(start + (end - start) * (i / steps)) + (suffix||'')
    if (i >= steps) clearInterval(id)
  }, 16)
}

function updateState(s) {
  Object.assign(state, s)
  var unit = s.distUnit || state.distUnit || 'km'
  if (s.name      != null) document.getElementById('car-name').textContent = s.name
  if (s.vin       != null) document.getElementById('vin').textContent = 'VIN ' + s.vin
  if (s.locationText != null) { var locEl = document.getElementById('car-location'); if (locEl) locEl.textContent = s.locationText ? '📍 ' + s.locationText : '' }
  if (s.odometer  != null) document.getElementById('odometer').textContent = s.odometer.toLocaleString() + ' ' + unit
  if (s.twelveSoc != null) document.getElementById('badge-12v').textContent = s.twelveSoc + '%'
  if (s.chargeLimitText != null) document.getElementById('badge-climit').textContent = s.chargeLimitText

  var ip = s.isPluggedIn != null ? s.isPluggedIn : state.isPluggedIn
  var ic = s.isCharging  != null ? s.isCharging  : state.isCharging
  var lk = s.locked      != null ? s.locked      : state.locked

  if (s.soc != null) {
    var socEl = document.getElementById('soc')
    var cls = ic ? 'charging' : s.soc < 20 ? 'low' : 'normal'
    socEl.className = 'soc-num ' + cls
    animateNumber(socEl, s.soc, '%')
    var bar = document.getElementById('soc-bar')
    bar.style.width = s.soc + '%'
    bar.className = 'bar-fill ' + cls
  }

  if (s.range != null) {
    var rangeEl = document.getElementById('range')
    rangeEl.textContent = '~ ' + s.range + ' ' + unit
  }

  // Charge badge
  var badge = document.getElementById('charge-badge')
  if (ic) {
    badge.className = 'charge-badge visible charging'
    badge.textContent = '\u26A1 Charging'
  } else if (ip) {
    badge.className = 'charge-badge visible plugged'
    badge.textContent = '\uD83D\uDD0C Plugged in'
  } else {
    badge.className = 'charge-badge'
    badge.textContent = ''
  }

  // Charge icon animation
  var chargeWrap = document.getElementById('charge-icon-wrap')
  var chargeItem = document.getElementById('icon-charge')
  chargeItem.className = 'icon-item' + (ip ? '' : ' faded')
  chargeWrap.className = ic ? 'zap-anim' : ''
  document.getElementById('badge-charge').textContent = ic ? 'Stop' : 'Charge'

  // Lock icon with bounce animation
  var lockWrap = document.getElementById('lock-wrap')
  var prevLocked = state.locked
  document.getElementById('lock-icon').innerHTML = lk ? LOCK_SVG : UNLOCK_SVG
  document.getElementById('badge-lock').textContent = lk ? 'Locked' : 'Unlocked'
  if (prevLocked !== lk) {
    lockWrap.className = 'lock-wrap unlocking'
    setTimeout(function() { lockWrap.className = 'lock-wrap' }, 300)
  }
}
</script>
</body>
</html>`
}

const GEO_CACHE_KEY = 'egmp_geocode_cache'
const GEO_CACHE_TTL = 60 * 60 * 1000 // 1 hour

async function reverseGeocode(lat: string, lon: string): Promise<string | null> {
  const cacheKey = `${Math.round(parseFloat(lat) * 1000)},${Math.round(parseFloat(lon) * 1000)}`
  try {
    if (Keychain.contains(GEO_CACHE_KEY)) {
      const cache = JSON.parse(Keychain.get(GEO_CACHE_KEY)) as Record<string, { addr: string; ts: number }>
      const hit = cache[cacheKey]
      if (hit && Date.now() - hit.ts < GEO_CACHE_TTL) return hit.addr
    }
  } catch {
    /* ignore */
  }
  try {
    const req = new Request(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=14`)
    req.headers = { 'User-Agent': 'egmp-bluelink-scriptable' }
    const json = (await req.loadJSON()) as {
      address?: {
        house_number?: string
        road?: string
        suburb?: string
        neighbourhood?: string
        city?: string
        town?: string
        village?: string
        county?: string
      }
    }
    const a = json.address ?? {}
    const street = [a.house_number, a.road].filter(Boolean).join(' ')
    const place = a.city ?? a.town ?? a.village ?? a.county ?? ''
    const parts = [street || (a.suburb ?? a.neighbourhood), place].filter(Boolean)
    const addr = parts.join(', ')
    if (!addr) return null
    try {
      const existing = Keychain.contains(GEO_CACHE_KEY)
        ? (JSON.parse(Keychain.get(GEO_CACHE_KEY)) as Record<string, { addr: string; ts: number }>)
        : {}
      existing[cacheKey] = { addr, ts: Date.now() }
      Keychain.set(GEO_CACHE_KEY, JSON.stringify(existing))
    } catch {
      /* ignore */
    }
    return addr
  } catch {
    return null
  }
}

export async function createApp(config: Config, bl: Bluelink) {
  const cachedStatus = bl.getCachedStatus()
  const webView = new WebView()

  // Always refresh status on open in background
  bl.refreshAuth()
    .then(async () => {
      bl.getStatus(false, true).then(async (status) => {
        await pushStateUpdate(webView, status, bl.getDistanceUnit(), config)
      })
    })
    .catch(() => {})

  const carImage = await bl.getCarImage(config.carColor)
  const carImageB64 = Data.fromPNG(carImage).toBase64String()

  if (config.promptForUpdate) {
    const version = new Version('andyfase', 'egmp-bluelink-scriptable')
    version.promptForUpdate().then((updateRequired: boolean) => {
      if (updateRequired) {
        quickOptions(['See Details', 'Cancel', 'Never Ask Again'], {
          title: 'Update Available',
          onOptionSelect: (opt) => {
            if (opt === 'See Details') {
              loadAboutScreen()
            } else if (opt === 'Never Ask Again') {
              config.promptForUpdate = false
              setConfig(config)
            }
          },
        })
      }
    })
  }

  // Fetch location + geocode in background, then push to UI once resolved
  bl.getStatus(true, false, true)
    .then(async (status) => {
      const loc = status.status.location
      if (!loc) return
      const addr = await reverseGeocode(loc.latitude, loc.longitude)
      if (addr) await webView.evaluateJavaScript(`updateState(${JSON.stringify({ locationText: addr })})`)
    })
    .catch(() => {})

  const html = buildMainHTML(config, cachedStatus, carImageB64, bl.getDistanceUnit())
  await webView.loadHTML(html)

  webView.shouldAllowRequest = (req: { url: string }) => {
    const url = req.url

    if (url.startsWith('bluelink://action')) {
      const params = parseQS(url)
      handleMainAction(webView, bl, config, params['type'] ?? '', {
        isCharging: params['isCharging'] === 'true',
        isPluggedIn: params['isPluggedIn'] === 'true',
        locked: params['locked'] === 'true',
      })
      return false
    }

    if (url.startsWith('bluelink://nav')) {
      const params = parseQS(url)
      // defer so presentation happens after the interceptor callback returns
      const dest = params['to'] ?? ''
      Timer.schedule(50, false, () => handleNav(webView, bl, config, dest))
      return false
    }

    return true
  }

  await webView.present(false)
  await sleep(100)
}
