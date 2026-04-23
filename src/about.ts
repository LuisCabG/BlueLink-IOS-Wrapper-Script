import { getTable, Div, P, Spacer, quickOptions, OK } from 'lib/scriptable-utils'
import { GithubRelease, Version } from 'lib/version'
import { getAppLogger } from './lib/util'

const SCRIPTABLE_DIR = '/var/mobile/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents'
const logger = getAppLogger()

export function doDowngrade(appFile = `${Script.name()}.js`) {
  const fm = FileManager.iCloud()
  if (fm.fileExists(`${SCRIPTABLE_DIR}/${appFile}.backup`)) {
    fm.remove(`${SCRIPTABLE_DIR}/${appFile}`)
    fm.move(`${SCRIPTABLE_DIR}/${appFile}.backup`, `${SCRIPTABLE_DIR}/${appFile}`)
  } else {
    OK('Downgrade Dailed', { message: `There is no previous version of ${appFile}` })
  }
}

async function doUpgrade(url: string, appFile = `${Script.name()}.js`) {
  const req = new Request(url)
  const data = await req.load()
  if (req.response.statusCode === 200) {
    const fm = FileManager.iCloud()
    // try to backup current script - log errors, script could have been renamed for example
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
  // load version async
  const version = new Version('LuisCabG', 'BlueLink-IOS-Wrapper-Script')
  version.getRelease().then((release) => setState({ release: release }))

  // load image async - placeholder until donation link is set up
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
      disclaimer(),
    ],
  })
}

const pageTitle = connect(() => {
  return Div([
    P('BlueLink iOS Wrapper', {
      font: (n) => Font.boldSystemFont(n),
      fontSize: 35,
      align: 'left',
    }),
  ])
})

const appDescription = connect(() => {
  return Div(
    [
      P('A scriptable app for IOS that allows you to control your Hyundai / Kia electric car using the Bluelink API.', {
        font: (n) => Font.mediumRoundedSystemFont(n),
        fontSize: 20,
        align: 'left',
      }),
    ],
    {
      height: 100,
    },
  )
})

const author = connect(() => {
  const divArray = [
    P('Author: LuisCabG', {
      font: (n) => Font.mediumRoundedSystemFont(n),
      fontSize: 20,
      align: 'left',
    }),
    P('Based on egmp-bluelink-scriptable by Andy Fase', {
      font: (n) => Font.systemFont(n),
      fontSize: 14,
      align: 'left',
    }),
  ]
  return Div(divArray, {
    height: 70,
    align: 'center',
    onTap: () => Safari.open('https://github.com/LuisCabG/BlueLink-IOS-Wrapper-Script'),
  })
})

const currentVersion = connect(({ state: { currentVersion } }) => {
  return Div([
    P(`Current Version:`, {
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
    P(`Latest Version Available:`, {
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
      P(`Click to Auto Install ${release.version}`, {
        font: (n) => Font.mediumRoundedSystemFont(n),
        fontSize: 20,
        color: Color.blue(),
        align: 'center',
      }),
    ],
    {
      onTap: async () => {
        const appFile = `${Script.name()}.js`
        quickOptions(['Install', 'Cancel'], {
          title: `Confirm Install - App will update "${appFile}" and auto-close`,
          onOptionSelect: async (opt) => {
            if (opt === 'Install') {
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
      P(`Release Details:\n\n ${release.name}:\n\n ${release.notes}`, {
        font: (n) => Font.mediumRoundedSystemFont(n),
        fontSize: 17,
        align: 'left',
      }),
    ],
    { height: 300 },
  )
})

const disclaimer = connect(() => {
  return Div(
    [
      P('⚠️ Disclaimer', {
        font: (n) => Font.boldSystemFont(n),
        fontSize: 14,
        align: 'left',
        color: Color.gray(),
      }),
      P(
        'This is an unofficial tool not affiliated with Hyundai or Kia. Use at your own risk. The author is not responsible for any damage, unintended vehicle behavior, or other consequences resulting from its use.',
        {
          font: (n) => Font.systemFont(n),
          fontSize: 12,
          align: 'left',
          color: Color.gray(),
        },
      ),
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
