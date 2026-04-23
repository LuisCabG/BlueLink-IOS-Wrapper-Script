import { getTable, Div, P, Spacer, quickOptions, OK } from 'lib/scriptable-utils'
import { GithubRelease, Version } from 'lib/version'
import { getAppLogger } from './lib/util'
import { t } from './lib/i18n'

const SCRIPTABLE_DIR = '/var/mobile/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents'
const logger = getAppLogger()

export function doDowngrade(appFile = `${Script.name()}.js`) {
  const fm = FileManager.iCloud()
  if (fm.fileExists(`${SCRIPTABLE_DIR}/${appFile}.backup`)) {
    fm.remove(`${SCRIPTABLE_DIR}/${appFile}`)
    fm.move(`${SCRIPTABLE_DIR}/${appFile}.backup`, `${SCRIPTABLE_DIR}/${appFile}`)
  } else {
    OK(t('about_downgrade_failed'), { message: `There is no previous version of ${appFile}` })
  }
}

async function doUpgrade(url: string, appFile = `${Script.name()}.js`) {
  const req = new Request(url)
  const data = await req.load()
  if (req.response.statusCode === 200) {
    const fm = FileManager.iCloud()
    try {
      if (fm.fileExists(`${SCRIPTABLE_DIR}/${appFile}.backup`)) {
        fm.remove(`${SCRIPTABLE_DIR}/${appFile}.backup`)
      }
      fm.move(`${SCRIPTABLE_DIR}/${appFile}`, `${SCRIPTABLE_DIR}/${appFile}.backup`)
    } catch (e) {
      logger.log(`Failed to backup current script: ${e}`)
    }
    fm.write(`${SCRIPTABLE_DIR}/${appFile}`, data)
  } else {
    OK('Download Error', { message: `Failed to download release: ${req.response.statusCode}` })
  }
}

const { present, connect, setState } = getTable<{
  release: GithubRelease | undefined
  currentVersion: string
  coffeeImage: Image | undefined
}>({
  name: 'About App',
})

export async function loadAboutScreen() {
  const version = new Version('LuisCabG', 'BlueLink-IOS-Wrapper-Script')
  version.getRelease().then((release) => setState({ release: release }))

  const req = new Request('https://bluelink.andyfase.com/images/coffee.png')
  req.loadImage().then((image) => setState({ coffeeImage: image }))

  return present({
    defaultState: {
      release: undefined,
      currentVersion: version.getCurrentVersion(),
      coffeeImage: undefined,
    },
    render: () => [
      pageTitle(),
      appDescription(),
      appWebsite(),
      author(),
      Spacer({ rowHeight: 30 }),
      currentVersion(),
      latestVersion(),
      Spacer(),
      upgrade(),
      upgradeNotes(),
      kofi(),
      disclaimer(),
    ],
  })
}

const pageTitle = connect(() => {
  return Div([
    P(t('about_title'), {
      font: (n) => Font.boldSystemFont(n),
      fontSize: 35,
      align: 'left',
    }),
  ])
})

const appDescription = connect(() => {
  return Div(
    [
      P(t('about_description'), {
        font: (n) => Font.mediumRoundedSystemFont(n),
        fontSize: 20,
        align: 'left',
      }),
    ],
    { height: 100 },
  )
})

const author = connect(() => {
  return Div(
    [
      P(t('about_author'), {
        font: (n) => Font.mediumRoundedSystemFont(n),
        fontSize: 20,
        align: 'left',
      }),
      P(t('about_based_on'), {
        font: (n) => Font.systemFont(n),
        fontSize: 14,
        align: 'left',
      }),
    ],
    {
      height: 70,
      align: 'center',
      onTap: () => Safari.open('https://github.com/LuisCabG/BlueLink-IOS-Wrapper-Script'),
    },
  )
})

const currentVersion = connect(({ state: { currentVersion } }) => {
  return Div([
    P(t('about_current_version'), {
      font: (n) => Font.mediumRoundedSystemFont(n),
      fontSize: 20,
      align: 'left',
    }),
    P(currentVersion, {
      font: (n) => Font.boldRoundedSystemFont(n),
      fontSize: 20,
      align: 'right',
    }),
  ])
})

const latestVersion = connect(({ state: { currentVersion, release } }) => {
  if (!release) return Spacer()

  return Div([
    P(t('about_latest_version'), {
      font: (n) => Font.mediumRoundedSystemFont(n),
      fontSize: 20,
      align: 'left',
      width: '80%',
    }),
    P(release.version, {
      font: (n) => Font.boldRoundedSystemFont(n),
      fontSize: 20,
      align: 'right',
      color:
        Version.versionToNumber(currentVersion) >= Version.versionToNumber(release.version)
          ? Color.green()
          : Color.blue(),
    }),
  ])
})

const upgrade = connect(({ state: { currentVersion, release } }) => {
  if (!release || Version.versionToNumber(currentVersion) >= Version.versionToNumber(release.version)) return Spacer()

  return Div(
    [
      P(`${t('install')} ${release.version}`, {
        font: (n) => Font.mediumRoundedSystemFont(n),
        fontSize: 20,
        color: Color.blue(),
        align: 'center',
      }),
    ],
    {
      onTap: async () => {
        const appFile = `${Script.name()}.js`
        quickOptions([t('install'), t('cancel')], {
          title: `${t('install')} "${appFile}"`,
          onOptionSelect: async (opt) => {
            if (opt === t('install')) {
              await doUpgrade(release.url, appFile)
              Script.complete()
              // @ts-ignore - undocumented api
              App.close()
            }
          },
        })
      },
    },
  )
})

const upgradeNotes = connect(({ state: { currentVersion, release } }) => {
  if (!release || Version.versionToNumber(currentVersion) >= Version.versionToNumber(release.version)) return Spacer()

  return Div(
    [
      P(`${t('about_release_details')}\n\n ${release.name}:\n\n ${release.notes}`, {
        font: (n) => Font.mediumRoundedSystemFont(n),
        fontSize: 17,
        align: 'left',
      }),
    ],
    { height: 300 },
  )
})

const kofi = connect(() => {
  return Div(
    [
      P(t('coffee_title'), {
        font: (n) => Font.boldRoundedSystemFont(n),
        fontSize: 18,
        color: Color.orange(),
        align: 'center',
      }),
      P(t('coffee_body'), {
        font: (n) => Font.systemFont(n),
        fontSize: 13,
        align: 'center',
        color: Color.gray(),
      }),
    ],
    {
      height: 70,
      onTap: () => Safari.open('https://ko-fi.com/donlucho'),
    },
  )
})

const disclaimer = connect(() => {
  return Div(
    [
      P(t('disclaimer_title'), {
        font: (n) => Font.boldSystemFont(n),
        fontSize: 14,
        align: 'left',
        color: Color.gray(),
      }),
      P(t('disclaimer_body'), {
        font: (n) => Font.systemFont(n),
        fontSize: 12,
        align: 'left',
        color: Color.gray(),
      }),
    ],
    { height: 100 },
  )
})

const appWebsite = connect(() => {
  return Div(
    [
      P('https://bluelink.andyfase.com', {
        font: (n) => Font.mediumRoundedSystemFont(n),
        fontSize: 20,
        color: Color.blue(),
        align: 'left',
      }),
    ],
    {
      onTap: async () => {
        Safari.open('https://bluelink.andyfase.com')
      },
    },
  )
})
