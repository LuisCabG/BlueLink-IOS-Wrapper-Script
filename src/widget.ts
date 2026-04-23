import {
  getTintedIconAsync,
  calculateBatteryIcon,
  getChargingIcon,
  dateStringOptions,
  getChargeCompletionString,
  getChargingPowerString,
  sleep,
} from './lib/util'
import { Bluelink, Status } from './lib/bluelink-regions/base'
import { Config } from 'config'
import { Logger } from './lib/logger'

// Widget Config
const DARK_MODE = true // Device.isUsingDarkAppearance(); // or set manually to (true or false)
const DARK_BG_COLOR = '000000'
const LIGHT_BG_COLOR = 'FFFFFF'

const KEYCHAIN_WIDGET_REFRESH_KEY = 'egmp-bluelink-widget'

// Definition of Day/Night Hours
const NIGHT_HOUR_START = 23
const NIGHT_HOUR_STOP = 7

let WIDGET_LOGGER: Logger | undefined = undefined
const WIDGET_LOG_FILE = `${Script.name().replaceAll(' ', '')}-widget.log`

function formatRemainingTime(mins: number): string {
  if (mins <= 0) return 'Done'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m left`
  if (m === 0) return `${h}h left`
  return `${h}h ${m}m left`
}

const GEO_CACHE_KEY = 'egmp_geocode_cache'
const GEO_CACHE_TTL = 60 * 60 * 1000

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

function newWidget(): ListWidget {
  const w = new ListWidget()
  w.url = `scriptable:///run?scriptName=${encodeURIComponent(Script.name())}`
  return w
}

interface WidgetRefreshCache {
  lastRemoteRefresh: number
  lastCommand: 'API' | 'REMOTE'
}

const DEFAULT_WIDGET_CACHE = {
  lastRemoteRefresh: 0,
  lastCommand: 'API',
} as WidgetRefreshCache

interface WidgetRefresh {
  nextRefresh: Date
  status: Status
}

export function getWidgetLogger(): Logger {
  if (!WIDGET_LOGGER) WIDGET_LOGGER = new Logger(WIDGET_LOG_FILE, 100)
  return WIDGET_LOGGER
}

function getCacheKey(write = false): string {
  const newCacheKey = `egmp-scriptable-widget-${Script.name().replaceAll(' ', '')}`
  if (write || Keychain.contains(newCacheKey)) return newCacheKey
  return KEYCHAIN_WIDGET_REFRESH_KEY
}

export function deleteWidgetCache() {
  Keychain.remove(getCacheKey(true))
}

async function waitForCommandSent(
  bl: Bluelink,
  sleepTime = 200,
  startTime = Date.now(),
  counter = 1,
): Promise<boolean> {
  const lastCommand = bl.getLastCommandSent()
  if (lastCommand && lastCommand > startTime) return true
  if (counter > 10) return false
  await sleep(sleepTime)
  return await waitForCommandSent(bl, sleepTime, startTime, counter + 1)
}

async function refreshDataForWidgetWithTimeout(bl: Bluelink, config: Config, timeout = 4000): Promise<WidgetRefresh> {
  const logger = getWidgetLogger()
  const timer = Timer.schedule(timeout, false, () => {
    if (config.debugLogging) logger.log(`Timeout refreshing data for widget - failing back to cached data`)
    return {
      status: bl.getCachedStatus(),
      nextRefresh: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes by default if call timeouts
    }
  })

  const result = await refreshDataForWidget(bl, config)
  timer.invalidate()
  return result
}

async function refreshDataForWidget(bl: Bluelink, config: Config): Promise<WidgetRefresh> {
  const logger = getWidgetLogger()

  const MIN_API_REFRESH_TIME = 300000 // 5 minutes

  // Day Intervals - day lasts for 16 days - in milliseconds
  const DEFAULT_STATUS_CHECK_INTERVAL_DAY = 3600 * config.widgetConfig.standardPollPeriod * 1000
  const DEFAULT_REMOTE_REFRESH_INTERVAL_DAY = 3600 * config.widgetConfig.remotePollPeriod * 1000
  const DEFAULT_CHARGING_REMOTE_REFRESH_INTERVAL_DAY = 3600 * config.widgetConfig.chargingRemotePollPeriod * 1000

  // Night Intervals - night lasts for 8 hours - in milliseconds
  const DEFAULT_STATUS_CHECK_INTERVAL_NIGHT = 3600 * config.widgetConfig.nightStandardPollPeriod * 1000
  const DEFAULT_REMOTE_REFRESH_INTERVAL_NIGHT = 3600 * config.widgetConfig.nightRemotePollPeriod * 1000
  const DEFAULT_CHARGING_REMOTE_REFRESH_INTERVAL_NIGHT = 3600 * config.widgetConfig.nightChargingRemotePollPeriod * 1000

  let cache: WidgetRefreshCache | undefined = undefined
  const currentTimestamp = Date.now()
  const currentHour = new Date().getHours()

  // Set status periods based on day/night
  let DEFAULT_STATUS_CHECK_INTERVAL = DEFAULT_STATUS_CHECK_INTERVAL_NIGHT
  let DEFAULT_CHARGING_REMOTE_REFRESH_INTERVAL = DEFAULT_CHARGING_REMOTE_REFRESH_INTERVAL_NIGHT
  let DEFAULT_REMOTE_REFRESH_INTERVAL = DEFAULT_REMOTE_REFRESH_INTERVAL_NIGHT
  if (currentHour < NIGHT_HOUR_START && currentHour > NIGHT_HOUR_STOP) {
    DEFAULT_STATUS_CHECK_INTERVAL = DEFAULT_STATUS_CHECK_INTERVAL_DAY
    DEFAULT_CHARGING_REMOTE_REFRESH_INTERVAL = DEFAULT_CHARGING_REMOTE_REFRESH_INTERVAL_DAY
    DEFAULT_REMOTE_REFRESH_INTERVAL = DEFAULT_REMOTE_REFRESH_INTERVAL_DAY
  }

  if (Keychain.contains(getCacheKey())) {
    cache = {
      ...DEFAULT_WIDGET_CACHE,
      ...JSON.parse(Keychain.get(getCacheKey())),
    }
  }
  if (!cache) {
    cache = DEFAULT_WIDGET_CACHE
  }
  let status = bl.getCachedStatus()

  // Get last remote check from cached API and convert
  // then compare to cache.lastRemoteRefresh and use whatever value is greater
  // we have both as we may have requested a remote refresh and that request is still pending

  let lastRemoteCheck = status.status.lastRemoteStatusCheck
  lastRemoteCheck = lastRemoteCheck > cache.lastRemoteRefresh ? lastRemoteCheck : cache.lastRemoteRefresh

  // LOGIC for refresh within widget
  // 1.Force refresh if user opted in via config AND last remote check is older than:
  //   - DEFAULT_REMOTE_REFRESH_INTERVAL if NOT charging
  //   - DEFAULT_CHARGING_REMOTE_REFRESH_INTERVAL if charging
  // 2. Normal refresh if not #1
  // The time intervals vary based on day/night - with day being more frequent

  const chargeCompletionTime = status.status.isCharging
    ? status.status.lastRemoteStatusCheck + status.status.remainingChargeTimeMins * 60 * 1000
    : 0

  const chargingComplete = status.status.isCharging && chargeCompletionTime < currentTimestamp
  if (status.status.isCharging && config.debugLogging)
    logger.log(
      `Now:${currentTimestamp}, Charge Completion Time: ${chargeCompletionTime}, chargingComplete: ${chargingComplete}`,
    )

  const chargingAndOverRemoteRefreshInterval =
    status.status.isCharging && lastRemoteCheck + DEFAULT_CHARGING_REMOTE_REFRESH_INTERVAL < currentTimestamp

  const notChargingAndOverRemoteRefreshInterval =
    !status.status.isCharging && lastRemoteCheck + DEFAULT_REMOTE_REFRESH_INTERVAL < currentTimestamp

  // calculate next remote check - reset if calculated value is in the past
  // if charging ends before next remote check use charge end + 10 minutes
  const remoteRefreshInterval = status.status.isCharging
    ? DEFAULT_CHARGING_REMOTE_REFRESH_INTERVAL
    : DEFAULT_REMOTE_REFRESH_INTERVAL
  let nextRemoteRefreshTime = lastRemoteCheck + remoteRefreshInterval
  if (nextRemoteRefreshTime < currentTimestamp) nextRemoteRefreshTime = currentTimestamp + remoteRefreshInterval
  if (status.status.isCharging) {
    if (chargeCompletionTime + 10 * 60 * 1000 < nextRemoteRefreshTime) {
      nextRemoteRefreshTime = chargeCompletionTime + 10 * 60 * 1000
      if (nextRemoteRefreshTime < currentTimestamp) nextRemoteRefreshTime = currentTimestamp + 5 * 60 * 1000
    }
  }

  // nextAPIRefreshTime is always based on DEFAULT_STATUS_CHECK_INTERVAL as its the default option
  const nextAPIRefreshTime = currentTimestamp + DEFAULT_STATUS_CHECK_INTERVAL

  // choose the lowest of the two values.
  const lowestRefreshTime = nextAPIRefreshTime < nextRemoteRefreshTime ? nextAPIRefreshTime : nextRemoteRefreshTime
  let nextRefresh = new Date(lowestRefreshTime)

  try {
    if (
      config.allowWidgetRemoteRefresh &&
      cache.lastCommand !== 'REMOTE' &&
      (chargingComplete || chargingAndOverRemoteRefreshInterval || notChargingAndOverRemoteRefreshInterval)
    ) {
      // Note a remote refresh takes to long to wait for - so trigger it and set a small nextRefresh value to pick
      // up the remote data on the next widget refresh
      if (config.debugLogging) logger.log('Doing Remote Refresh')
      bl.getStatus(true, true) // no await deliberatly as it takes to long to complete

      //wait for getCar command to be completed + another 200ms to ensure the remote status command is sent
      const result = await waitForCommandSent(bl, 200)
      if (result) {
        await sleep(200)
        cache.lastRemoteRefresh = currentTimestamp
        cache.lastCommand = 'REMOTE'
        if (config.debugLogging) logger.log('Completed Remote Refresh')
      } else {
        if (config.debugLogging) logger.log('Remote status command failed to send')
      }
      nextRefresh = new Date(Date.now() + 5 * 60 * 1000)
    } else if (chargingComplete || currentTimestamp > status.status.lastStatusCheck + MIN_API_REFRESH_TIME) {
      if (config.debugLogging) logger.log('Doing API Refresh')
      status = await bl.getStatus(false, true)
      cache.lastCommand = 'API'
      if (config.debugLogging) logger.log('Completed API Refresh')
    }
  } catch (_error) {
    // ignore any API errors and just displayed last cached values in widget
    // we have no guarentee of network connection
  }

  Keychain.set(getCacheKey(true), JSON.stringify(cache))
  if (config.debugLogging)
    logger.log(
      `Current time: ${new Date().toLocaleString()}. cache: ${JSON.stringify(cache)}, Last Remote Check: ${new Date(lastRemoteCheck).toLocaleString()} Setting next widget refresh to ${nextRefresh.toLocaleString()}`,
    )

  return {
    nextRefresh: nextRefresh,
    status: status,
  }
}

export function createErrorWidget(message: string) {
  const widget = newWidget()
  widget.setPadding(20, 10, 15, 15)

  const mainStack = widget.addStack()
  mainStack.layoutVertically()
  mainStack.addSpacer()

  // Add background color
  widget.backgroundColor = DARK_MODE ? new Color(DARK_BG_COLOR) : new Color(LIGHT_BG_COLOR)

  // Show app icon and title
  const titleStack = mainStack.addStack()
  const titleElement = titleStack.addText('Error')
  titleElement.textColor = DARK_MODE ? Color.red() : Color.red()
  titleElement.font = Font.boldSystemFont(25)
  titleStack.addSpacer()

  mainStack.addSpacer()

  const messageElement = mainStack.addText(message)
  messageElement.textColor = DARK_MODE ? Color.white() : Color.black()
  messageElement.font = Font.systemFont(15)
  messageElement.minimumScaleFactor = 0.5
  messageElement.lineLimit = 5
  mainStack.addSpacer()

  return widget
}

export async function createMediumWidget(config: Config, bl: Bluelink) {
  const refresh = await refreshDataForWidgetWithTimeout(bl, config)
  const status = refresh.status

  const appIcon = await bl.getCarImage(config.carColor)
  const widget = newWidget()
  widget.setPadding(14, 14, 14, 14)
  widget.refreshAfterDate = refresh.nextRefresh
  widget.backgroundColor = DARK_MODE ? new Color(DARK_BG_COLOR) : new Color(LIGHT_BG_COLOR)

  const mainStack = widget.addStack()
  mainStack.layoutVertically()

  const isCharging = status.status.isCharging
  const isPluggedIn = status.status.isPluggedIn
  const batteryPercent = status.status.soc
  const remainingChargingTime = status.status.remainingChargeTimeMins
  const chargingKw = getChargingPowerString(status.status.chargingPower)
  const isLocked = status.status.locked
  const lastSeen = new Date(status.status.lastRemoteStatusCheck)
  const odometer =
    status.car.odometer === undefined
      ? status.status.odometer
      : status.status.odometer >= status.car.odometer
        ? status.status.odometer
        : status.car.odometer
  const isClimateOn = status.status.climate
  const climateTemp = status.status.climateTemp
  const seatClimate = status.status.seatClimate
  const chargingIcon = getChargingIcon(isCharging, isPluggedIn, true)
  const loc = status.status.location
  const locationAddr = loc ? await reverseGeocode(loc.latitude, loc.longitude).catch(() => null) : null

  // ── Top row: Stats left | Lock right ──
  const topRow = mainStack.addStack()
  topRow.layoutHorizontally()
  topRow.centerAlignContent()

  const statsStack = topRow.addStack()
  statsStack.layoutVertically()

  const rangeEl = statsStack.addText(`${status.status.range} ${bl.getDistanceUnit()}`)
  rangeEl.font = Font.boldSystemFont(20)
  rangeEl.textColor = DARK_MODE ? Color.white() : Color.black()

  const socRow = statsStack.addStack()
  socRow.centerAlignContent()
  const battImg = await getTintedIconAsync(calculateBatteryIcon(batteryPercent))
  const battImgEl = socRow.addImage(battImg)
  battImgEl.imageSize = new Size(30, 30)
  if (chargingIcon) {
    const chgEl = socRow.addImage(await getTintedIconAsync(chargingIcon))
    chgEl.imageSize = new Size(20, 20)
  }
  socRow.addSpacer(3)
  const socEl = socRow.addText(`${batteryPercent}%`)
  socEl.font = Font.mediumSystemFont(18)
  socEl.textColor =
    batteryPercent <= 10
      ? Color.red()
      : batteryPercent <= 20
        ? Color.yellow()
        : DARK_MODE
          ? Color.white()
          : Color.black()

  if (locationAddr) {
    const locEl = statsStack.addText('📍 ' + locationAddr)
    locEl.font = Font.systemFont(9)
    locEl.textColor = DARK_MODE ? Color.white() : Color.black()
    locEl.textOpacity = 0.5
    locEl.minimumScaleFactor = 0.7
    locEl.lineLimit = 1
  }

  topRow.addSpacer()

  // Right: Lock (tappable — runs script with action param)
  const lockTopStack = topRow.addStack()
  lockTopStack.layoutVertically()
  lockTopStack.centerAlignContent()
  lockTopStack.url = `scriptable:///run?scriptName=${encodeURIComponent(Script.name())}&action=${isLocked ? 'unlock' : 'lock'}`

  const lockImgEl = lockTopStack.addImage(await getTintedIconAsync(isLocked ? 'locked' : 'unlocked'))
  lockImgEl.imageSize = new Size(26, 26)
  lockImgEl.tintColor = isLocked ? Color.green() : Color.red()
  const lockLabelEl = lockTopStack.addText(isLocked ? 'Locked' : 'Unlocked')
  lockLabelEl.font = Font.mediumSystemFont(11)
  lockLabelEl.textColor = isLocked ? Color.green() : Color.red()
  lockLabelEl.centerAlignText()

  // ── Car image centered ──
  mainStack.addSpacer(4)
  const carRow = mainStack.addStack()
  carRow.layoutHorizontally()
  carRow.addSpacer()
  const carImgEl = carRow.addImage(appIcon)
  carImgEl.imageSize = new Size(200, 200 / (appIcon.size.width / appIcon.size.height))
  carImgEl.centerAlignImage()
  carRow.addSpacer()
  mainStack.addSpacer(4)

  // ── Charging row ──
  if (isCharging) {
    const chargingRow = mainStack.addStack()
    chargingRow.layoutHorizontally()
    chargingRow.addSpacer()

    const speedEl = chargingRow.addText(chargingKw)
    speedEl.font = Font.mediumSystemFont(13)
    speedEl.textColor = DARK_MODE ? Color.white() : Color.black()
    speedEl.textOpacity = 0.9
    chargingRow.addSpacer(3)

    const timeIconEl = chargingRow.addImage(await getTintedIconAsync('charging-complete-widget'))
    timeIconEl.imageSize = new Size(13, 13)
    chargingRow.addSpacer(3)

    const timeEl = chargingRow.addText(formatRemainingTime(remainingChargingTime))
    timeEl.font = Font.mediumSystemFont(13)
    timeEl.textColor = Color.green()
    timeEl.textOpacity = 0.9
    chargingRow.addSpacer()
  }

  // ── Climate row ──
  const climateIconName = isClimateOn ? 'climate-on' : 'climate-off'
  const climateParts: string[] = []
  if (climateTemp !== undefined) climateParts.push(`${climateTemp}°${config.tempType}`)
  if (seatClimate) climateParts.push(`Seat: ${seatClimate}`)
  const climateLabel = isClimateOn
    ? climateParts.length > 0
      ? `Climate On (${climateParts.join(' · ')})`
      : 'Climate On'
    : 'Climate Off'

  const climateStack = mainStack.addStack()
  climateStack.addSpacer(2)
  const climateIconEl = climateStack.addImage(await getTintedIconAsync(climateIconName))
  climateIconEl.imageSize = new Size(13, 13)
  climateIconEl.imageOpacity = isClimateOn ? 1.0 : 0.5
  climateStack.addSpacer(3)
  const climateTextEl = climateStack.addText(climateLabel)
  climateTextEl.font = Font.mediumSystemFont(11)
  climateTextEl.textColor = isClimateOn ? Color.green() : DARK_MODE ? Color.white() : Color.black()
  climateTextEl.textOpacity = isClimateOn ? 1.0 : 0.5
  climateTextEl.minimumScaleFactor = 0.5
  climateStack.addSpacer()

  mainStack.addSpacer()

  // ── Footer ──
  const footerStack = mainStack.addStack()
  footerStack.addSpacer(2)

  const odomStack = footerStack.addStack()
  const odomIconEl = odomStack.addImage(await getTintedIconAsync('odometer'))
  odomIconEl.imageSize = new Size(13, 13)
  odomIconEl.imageOpacity = 0.6
  odomStack.addSpacer(3)
  const odomEl = odomStack.addText(`${Math.floor(Number(odometer)).toLocaleString()} ${bl.getDistanceUnit()}`)
  odomEl.font = Font.mediumSystemFont(11)
  odomEl.textColor = DARK_MODE ? Color.white() : Color.black()
  odomEl.textOpacity = 0.6
  odomEl.minimumScaleFactor = 0.5

  footerStack.addSpacer()

  const lastSeenStack = footerStack.addStack()
  const lastSeenIconEl = lastSeenStack.addImage(await getTintedIconAsync('charging-complete-widget'))
  lastSeenIconEl.imageSize = new Size(13, 13)
  lastSeenIconEl.imageOpacity = 0.6
  lastSeenStack.addSpacer(3)
  const lastSeenEl = lastSeenStack.addText(lastSeen.toLocaleString(undefined, dateStringOptions) || 'unknown')
  lastSeenEl.font = Font.mediumSystemFont(11)
  lastSeenEl.textOpacity = 0.6
  lastSeenEl.textColor = DARK_MODE ? Color.white() : Color.black()
  lastSeenEl.minimumScaleFactor = 0.5
  lastSeenEl.rightAlignText()

  return widget
}

export async function createSmallWidget(config: Config, bl: Bluelink) {
  const refresh = await refreshDataForWidgetWithTimeout(bl, config)
  const status = refresh.status

  const appIcon = await bl.getCarImage(config.carColor)
  const widget = newWidget()
  widget.setPadding(14, 14, 12, 14)
  widget.refreshAfterDate = refresh.nextRefresh
  widget.backgroundColor = DARK_MODE ? new Color(DARK_BG_COLOR) : new Color(LIGHT_BG_COLOR)

  const mainStack = widget.addStack()
  mainStack.layoutVertically()

  const isCharging = status.status.isCharging
  const isPluggedIn = status.status.isPluggedIn
  const batteryPercent = status.status.soc
  const remainingChargingTime = status.status.remainingChargeTimeMins
  const chargingKw = getChargingPowerString(status.status.chargingPower)
  const isLocked = status.status.locked
  const lastSeen = new Date(status.status.lastRemoteStatusCheck)
  const chargingIcon = getChargingIcon(isCharging, isPluggedIn, true)
  const loc = status.status.location
  const locationAddr = loc ? await reverseGeocode(loc.latitude, loc.longitude).catch(() => null) : null

  // ── Top row: Stats left | Lock right ──
  const topRow = mainStack.addStack()
  topRow.layoutHorizontally()
  topRow.centerAlignContent()

  const statsStack = topRow.addStack()
  statsStack.layoutVertically()

  const rangeEl = statsStack.addText(`${status.status.range} ${bl.getDistanceUnit()}`)
  rangeEl.font = Font.boldSystemFont(15)
  rangeEl.textColor = DARK_MODE ? Color.white() : Color.black()

  const socRow = statsStack.addStack()
  socRow.centerAlignContent()
  const battImg = await getTintedIconAsync(calculateBatteryIcon(batteryPercent))
  const battImgEl = socRow.addImage(battImg)
  battImgEl.imageSize = new Size(24, 24)
  if (chargingIcon) {
    const chgEl = socRow.addImage(await getTintedIconAsync(chargingIcon))
    chgEl.imageSize = new Size(15, 15)
  }
  socRow.addSpacer(2)
  const socEl = socRow.addText(`${batteryPercent}%`)
  socEl.font = Font.mediumSystemFont(13)
  socEl.textColor =
    batteryPercent <= 10
      ? Color.red()
      : batteryPercent <= 20
        ? Color.yellow()
        : DARK_MODE
          ? Color.white()
          : Color.black()

  if (locationAddr) {
    const locEl = statsStack.addText('📍 ' + locationAddr)
    locEl.font = Font.systemFont(8)
    locEl.textColor = DARK_MODE ? Color.white() : Color.black()
    locEl.textOpacity = 0.5
    locEl.minimumScaleFactor = 0.7
    locEl.lineLimit = 1
  }

  topRow.addSpacer()

  // Right: Lock (tappable — runs script with action param)
  const lockTopStack = topRow.addStack()
  lockTopStack.layoutVertically()
  lockTopStack.centerAlignContent()
  lockTopStack.url = `scriptable:///run?scriptName=${encodeURIComponent(Script.name())}&action=${isLocked ? 'unlock' : 'lock'}`

  const lockImgEl = lockTopStack.addImage(await getTintedIconAsync(isLocked ? 'locked' : 'unlocked'))
  lockImgEl.imageSize = new Size(22, 22)
  lockImgEl.tintColor = isLocked ? Color.green() : Color.red()
  const lockLabelEl = lockTopStack.addText(isLocked ? 'Locked' : 'Unlocked')
  lockLabelEl.font = Font.mediumSystemFont(9)
  lockLabelEl.textColor = isLocked ? Color.green() : Color.red()
  lockLabelEl.centerAlignText()

  // ── Car image centered ──
  mainStack.addSpacer()
  const carRow = mainStack.addStack()
  carRow.layoutHorizontally()
  carRow.addSpacer()
  const carImgEl = carRow.addImage(appIcon)
  carImgEl.imageSize = new Size(115, 115 / (appIcon.size.width / appIcon.size.height))
  carImgEl.centerAlignImage()
  carRow.addSpacer()
  mainStack.addSpacer()

  // ── Charging row ──
  if (isCharging) {
    const chargingRow = mainStack.addStack()
    chargingRow.layoutHorizontally()
    chargingRow.addSpacer()

    const speedEl = chargingRow.addText(chargingKw)
    speedEl.font = Font.mediumSystemFont(11)
    speedEl.textColor = Color.green()
    chargingRow.addSpacer(4)

    const timeIconEl = chargingRow.addImage(await getTintedIconAsync('charging-complete-widget'))
    timeIconEl.imageSize = new Size(11, 11)
    chargingRow.addSpacer(3)

    const timeEl = chargingRow.addText(formatRemainingTime(remainingChargingTime))
    timeEl.font = Font.mediumSystemFont(11)
    timeEl.textColor = Color.green()
  }

  // ── Footer: last seen ──
  const footerRow = mainStack.addStack()
  footerRow.addSpacer()
  const footerEl = footerRow.addText(lastSeen.toLocaleString(undefined, dateStringOptions) || 'unknown')
  footerEl.lineLimit = 1
  footerEl.font = Font.lightSystemFont(10)
  footerEl.textOpacity = 0.5
  footerEl.textColor = DARK_MODE ? Color.white() : Color.black()

  return widget
}

export async function createHomeScreenCircleWidget(config: Config, bl: Bluelink) {
  const refresh = await refreshDataForWidgetWithTimeout(bl, config)
  const status = refresh.status

  const widget = newWidget()
  widget.refreshAfterDate = refresh.nextRefresh

  const progressStack = await progressCircle(widget, status.status.soc)
  const mainIcon = status.status.isCharging ? SFSymbol.named('bolt.car') : SFSymbol.named('car.fill')
  const wmainIcon = progressStack.addImage(mainIcon.image)
  wmainIcon.imageSize = new Size(36, 36)
  wmainIcon.tintColor = new Color('#ffffff')

  return widget
}

export async function createHomeScreenRectangleWidget(config: Config, bl: Bluelink) {
  const refresh = await refreshDataForWidgetWithTimeout(bl, config)
  const status = refresh.status

  const widget = newWidget()
  widget.refreshAfterDate = refresh.nextRefresh

  const widgetStack = widget.addStack()
  // widgetStack.addSpacer(5)
  widgetStack.layoutVertically()
  const mainStack = widgetStack.addStack()

  const iconStack = await progressCircle(mainStack, status.status.soc)
  const mainIcon = status.status.isCharging ? SFSymbol.named('bolt.car') : SFSymbol.named('car.fill')
  const wmainIcon = iconStack.addImage(mainIcon.image)
  wmainIcon.imageSize = new Size(36, 36)
  wmainIcon.tintColor = new Color('#ffffff')

  // Battery Info
  const batteryInfoStack = mainStack.addStack()
  batteryInfoStack.layoutVertically()
  batteryInfoStack.addSpacer(5)

  // Range
  const rangeStack = batteryInfoStack.addStack()
  rangeStack.addSpacer()
  const rangeText = `${status.status.range} ${bl.getDistanceUnit()}`
  const rangeElement = rangeStack.addText(rangeText)
  rangeElement.font = Font.boldSystemFont(15)
  rangeElement.textColor = Color.white()
  rangeElement.rightAlignText()

  // set status from BL status response
  const isCharging = status.status.isCharging
  const isPluggedIn = status.status.isPluggedIn
  const batteryPercent = status.status.soc
  const remainingChargingTime = status.status.remainingChargeTimeMins
  const lastSeen = new Date(status.status.lastRemoteStatusCheck)

  // Battery Percent Value
  const batteryPercentStack = batteryInfoStack.addStack()
  batteryPercentStack.centerAlignContent()
  batteryPercentStack.addSpacer()
  const chargingIcon = getChargingIcon(isCharging, isPluggedIn, true)
  if (chargingIcon) {
    const chargingElement = batteryPercentStack.addImage(await getTintedIconAsync(chargingIcon))
    chargingElement.tintColor = new Color('#ffffff')
    chargingElement.imageSize = new Size(15, 15)
    chargingElement.rightAlignImage()
  }

  batteryPercentStack.addSpacer(3)
  const batteryPercentText = batteryPercentStack.addText(`${batteryPercent.toString()}%`)
  batteryPercentText.textColor =
    status.status.soc <= 10 ? Color.red() : status.status.soc <= 20 ? Color.yellow() : Color.white()
  batteryPercentText.font = Font.boldSystemFont(15)

  if (isCharging) {
    const chargeComplete = getChargeCompletionString(lastSeen, remainingChargingTime, 'short', true)
    const batteryChargingTimeStack = batteryInfoStack.addStack()

    // bug in dynamic spacing means we only set spacing if string is less than 10 characters
    if (chargeComplete.length < 10) {
      batteryChargingTimeStack.addSpacer()
    }

    const chargingTimeIconElement = batteryChargingTimeStack.addImage(SFSymbol.named('clock.fill').image)
    chargingTimeIconElement.tintColor = new Color('#ffffff')
    chargingTimeIconElement.imageSize = new Size(14, 14)
    batteryChargingTimeStack.addSpacer(3)

    const chargingTimeElement = batteryChargingTimeStack.addText(`${chargeComplete}`)
    chargingTimeElement.font = Font.mediumMonospacedSystemFont(12)
    chargingTimeElement.textOpacity = 0.9
    chargingTimeElement.textColor = Color.white()
    chargingTimeElement.rightAlignText()
  }

  return widget
}

export async function createHomeScreenInlineWidget(config: Config, bl: Bluelink) {
  const refresh = await refreshDataForWidgetWithTimeout(bl, config)
  const status = refresh.status

  const isCharging = status.status.isCharging
  const isPluggedIn = status.status.isPluggedIn
  const batteryPercent = status.status.soc
  const remainingChargingTime = status.status.remainingChargeTimeMins
  const lastSeen = new Date(status.status.lastRemoteStatusCheck)

  const widget = newWidget()
  widget.refreshAfterDate = refresh.nextRefresh

  const widgetStack = widget.addStack()
  widgetStack.layoutHorizontally()
  const mainStack = widgetStack.addStack()
  const chargingIcon = getChargingIcon(isCharging, isPluggedIn, true)

  const icon = await progressCircleIconImageWithSymbol(
    batteryPercent,
    'hsla(0, 0%, 100%, 1.0)',
    'hsla(0, 0%, 100%, 0.3)',
    30,
    3,
    chargingIcon ? await getTintedIconAsync(chargingIcon) : SFSymbol.named('car.fill').image,
    chargingIcon ? 17 : 14,
  )

  const iconStack = mainStack.addStack()
  iconStack.addImage(icon)

  //Only one line of text allowed in this style of widget
  let rangeText = `${status.status.range} ${bl.getDistanceUnit()}`
  if (isCharging) {
    const chargeComplete = getChargeCompletionString(lastSeen, remainingChargingTime, 'short', true)
    rangeText += ` \u{21BA} ${chargeComplete}`
  }
  const textStack = mainStack.addStack()
  textStack.addText(rangeText)

  return widget
}

async function progressCircle(
  on: ListWidget | WidgetStack,
  value = 50,
  colour = 'hsl(0, 0%, 100%)',
  background = 'hsl(0, 0%, 10%)',
  size = 60,
  barWidth = 5,
  padding = barWidth * 2,
) {
  if (value > 1) {
    value /= 100
  }
  if (value < 0) {
    value = 0
  }
  if (value > 1) {
    value = 1
  }

  const w = new WebView()
  await w.loadHTML('<canvas id="c"></canvas>')

  const base64 = await w.evaluateJavaScript(
    `
  let colour = "${colour}",
    background = "${background}",
    size = ${size}*3,
    lineWidth = ${barWidth}*3,
    percent = ${value * 100}
      
  let canvas = document.getElementById('c'),
    c = canvas.getContext('2d')
  canvas.width = size
  canvas.height = size
  let posX = canvas.width / 2,
    posY = canvas.height / 2,
    onePercent = 360 / 100,
    result = onePercent * percent
  c.lineCap = 'round'
  c.beginPath()
  c.arc( posX, posY, (size-lineWidth-1)/2, (Math.PI/180) * 270, (Math.PI/180) * (270 + 360) )
  c.strokeStyle = background
  c.lineWidth = lineWidth 
  c.stroke()
  c.beginPath()
  c.strokeStyle = colour
  c.lineWidth = lineWidth
  c.arc( posX, posY, (size-lineWidth-1)/2, (Math.PI/180) * 270, (Math.PI/180) * (270 + result) )
  c.stroke()
  completion(canvas.toDataURL().replace("data:image/png;base64,",""))`,
    true,
  )
  const image = Image.fromData(Data.fromBase64String(base64))
  image.size = new Size(size, size)
  const stack = on.addStack()
  stack.size = new Size(size, size)
  stack.backgroundImage = image
  stack.centerAlignContent()
  // const padding = barWidth * 2
  stack.setPadding(padding, padding, padding, padding)

  return stack
}

async function progressCircleIconImageWithSymbol(
  value = 50,
  colour = 'hsl(0, 0%, 100%)',
  background = 'hsl(0, 0%, 10%)',
  size = 60,
  barWidth = 5,
  symbolImage?: Image,
  symbolSize?: number, // Now optional
) {
  if (value > 1) value /= 100
  if (value < 0) value = 0
  if (value > 1) value = 1

  let symbolBase64 = undefined
  let resolvedSymbolSize = symbolSize
  if (symbolImage) {
    symbolBase64 = Data.fromPNG(symbolImage).toBase64String()
    if (!resolvedSymbolSize) resolvedSymbolSize = Math.floor(size * 0.6)
  }

  const w = new WebView()
  const html = symbolBase64
    ? `<canvas id="c"></canvas><img id="icon" src="data:image/png;base64,${symbolBase64}" />`
    : `<canvas id="c"></canvas>`
  await w.loadHTML(html)

  const base64 = await w.evaluateJavaScript(
    `
  let colour = "${colour}",
    background = "${background}",
    size = ${size},
    lineWidth = ${barWidth},
    percent = ${value * 100},
    symbolSize = ${resolvedSymbolSize ?? 0}
      
  let canvas = document.getElementById('c'),
    c = canvas.getContext('2d')
  canvas.width = size
  canvas.height = size
  let posX = canvas.width / 2,
    posY = canvas.height / 2,
    onePercent = 360 / 100,
    result = onePercent * percent
  c.lineCap = 'round'
  c.beginPath()
  c.arc( posX, posY, (size-lineWidth-1)/2, (Math.PI/180) * 270, (Math.PI/180) * (270 + 360) )
  c.strokeStyle = background
  c.lineWidth = lineWidth 
  c.stroke()
  c.beginPath()
  c.strokeStyle = colour
  c.lineWidth = lineWidth
  c.arc( posX, posY, (size-lineWidth-1)/2, (Math.PI/180) * 270, (Math.PI/180) * (270 + result) )
  c.stroke()
  // Draw SFSymbol PNG in center if present
  let img = document.getElementById('icon')
  if (img && symbolSize) {
    c.drawImage(img, posX - symbolSize/2, posY - symbolSize/2, symbolSize, symbolSize)
  }
  completion(canvas.toDataURL().replace("data:image/png;base64,",""))`,
    true,
  )
  return Image.fromData(Data.fromBase64String(base64))
}
