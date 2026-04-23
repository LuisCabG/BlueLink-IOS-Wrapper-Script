# BlueLink iOS Wrapper

A [Scriptable](https://scriptable.app) app for iOS that lets you monitor and control your Hyundai/Kia electric vehicle using the Bluelink API — directly from your home screen.

> **Based on [egmp-bluelink-scriptable](https://github.com/andyfase/egmp-bluelink-scriptable) by [Andy Fase](https://github.com/andyfase).** All credit for the original API integration, widget framework, and app architecture goes to Andy. This fork adds UI enhancements, widget improvements, and quality-of-life features.

---

## Features

- **Home screen widgets** (small, medium, lock screen accessories)
  - Car image centered in widget
  - Battery % + range in top-left corner
  - Tappable lock/unlock icon in top-right — lock or unlock your car directly from the widget without opening the app
  - Battery color: white (normal) → yellow (≤20%) → red (≤10%)
  - Reverse-geocoded car location address shown below battery %
- **Main app**
  - Car status auto-refreshes every time the app opens
  - Climate control (heat/cool/defrost) with live status updates
  - 5-minute cooldown between climate commands to avoid Bluelink API rate limits, with a live countdown timer
  - Error alerts shown as centered modal overlays instead of bottom toasts
  - Lock / unlock / charging controls
- **Siri Shortcuts** support
- **Multiple regions**: US, Canada, Europe, Australia, India

---

## Requirements

- iPhone with [Scriptable](https://scriptable.app) installed (free on the App Store)
- A Hyundai or Kia EV with an active Bluelink / UVO / MyKia subscription
- Your Bluelink app credentials (email, password, PIN)

---

## Installation

1. Install [Scriptable](https://scriptable.app) from the App Store.
2. Download the latest release `.js` file from the [Releases](https://github.com/LuisCabG/BlueLink-IOS-Wrapper-Script/releases) page.
3. Place the file in your **iCloud Drive → Scriptable** folder.
4. Open Scriptable, tap the script, and follow the on-screen setup to enter your region and credentials.

---

## Adding a Widget

1. Long-press your home screen → tap **+** → search for **Scriptable**.
2. Choose widget size (Small or Medium recommended).
3. Tap the widget → set **Script** to this script's name.
4. Set **When Interacting** to **Run Script**.

---

## Security

Your credentials (email, password, PIN) are stored exclusively in the **iOS Keychain** — they never leave your device in plaintext. The script communicates directly with Hyundai/Kia's Bluelink API over HTTPS, the same endpoints used by the official Bluelink mobile app.

---

## Updating

Open the script → tap the **ℹ About** option → if a newer version is available you'll see an **Auto Install** button that downloads and replaces the script in one tap (with an automatic backup of your current version).

---

## Supported Regions

| Region | Notes |
|--------|-------|
| USA | Hyundai / Kia Bluelink |
| Canada | Hyundai / Kia |
| Europe | Hyundai MyBluelink |
| Australia | |
| India | |

---

## Disclaimer

> **Use at your own risk.**
>
> This is an unofficial, community-built tool with no affiliation to Hyundai, Kia, or any of their subsidiaries. It interacts with your vehicle through the same API used by the official Bluelink app, but no guarantees are made about its reliability, accuracy, or safety.
>
> The author(s) of this project are **not responsible** for any damage, data loss, unintended vehicle behavior, voided warranties, account lockouts, or any other consequences — direct or indirect — that may result from using this software. By using this tool, you accept full responsibility for any actions taken on your vehicle.
>
> Always ensure your vehicle is in a safe state before using remote commands. Do not rely on this app for safety-critical decisions.

---

## Credits

- **Original project**: [egmp-bluelink-scriptable](https://github.com/andyfase/egmp-bluelink-scriptable) by [Andy Fase](https://github.com/andyfase)
- **This fork**: [LuisCabG](https://github.com/LuisCabG)

---

## License

MIT — see [LICENSE](LICENSE).
