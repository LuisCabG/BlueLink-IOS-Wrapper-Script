# BlueLink iOS Wrapper

---

## 🇬🇧🇨🇦 English

A [Scriptable](https://scriptable.app) app for iOS that lets you monitor and control your Hyundai/Kia electric vehicle using the Bluelink API — directly from your home screen.

> **Based on [egmp-bluelink-scriptable](https://github.com/andyfase/egmp-bluelink-scriptable) by [Andy Fase](https://github.com/andyfase).** All credit for the original API integration, widget framework, and app architecture goes to Andy. This fork adds UI enhancements, widget improvements, and quality-of-life features.

### Features

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
  - Error alerts shown as centered modal overlays
  - Lock / unlock / charging controls
- **Language support**: English and French (configurable in Settings)
- **Siri Shortcuts** support
- **Multiple regions**: US, Canada, Europe, Australia, India

### Requirements

- iPhone with [Scriptable](https://scriptable.app) installed (free on the App Store)
- A Hyundai or Kia EV with an active Bluelink / UVO / MyKia subscription
- Your Bluelink app credentials (email, password, PIN)

### Installation

1. Install [Scriptable](https://scriptable.app) from the App Store.
2. Download the latest release `.js` file from the [Releases](https://github.com/LuisCabG/BlueLink-IOS-Wrapper-Script/releases) page.
3. Place the file in your **iCloud Drive → Scriptable** folder.
4. Open Scriptable, tap the script, and follow the on-screen setup to enter your region and credentials.

### Adding a Widget

1. Long-press your home screen → tap **+** → search for **Scriptable**.
2. Choose widget size (Small or Medium recommended).
3. Tap the widget → set **Script** to this script's name.
4. Set **When Interacting** to **Run Script**.

### Security

Your credentials (email, password, PIN) are stored exclusively in the **iOS Keychain** — they never leave your device in plaintext. The script communicates directly with Hyundai/Kia's Bluelink API over HTTPS, the same endpoints used by the official Bluelink mobile app.

### Updating

Open the script → tap the **ℹ About** option → if a newer version is available you'll see an **Auto Install** button that downloads and replaces the script in one tap (with an automatic backup of your current version).

### Testing Notes

> ⚠️ This app has currently only been tested on an **iPhone 17 Pro Max** — it should work on other iPhone models but this has not been verified. Only the **Canada** region has been tested. Other regions may work (they use the same upstream API logic) but are not guaranteed.

### Disclaimer

> **Use at your own risk.**
>
> This is an unofficial, community-built tool with no affiliation to Hyundai, Kia, or any of their subsidiaries. It interacts with your vehicle through the same API used by the official Bluelink app, but no guarantees are made about its reliability, accuracy, or safety.
>
> The author(s) are **not responsible** for any damage, data loss, unintended vehicle behavior, voided warranties, account lockouts, or any other consequences. By using this tool, you accept full responsibility for any actions taken on your vehicle.

### Support

If this app saves you time, consider buying me a coffee — it helps keep the project going!

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/donlucho)

### Credits

- **Original project**: [egmp-bluelink-scriptable](https://github.com/andyfase/egmp-bluelink-scriptable) by [Andy Fase](https://github.com/andyfase)
- **This fork**: [LuisCabG](https://github.com/LuisCabG)

### License

MIT — see [LICENSE](LICENSE).

---

## 🇫🇷🇨🇦 Français

Une application [Scriptable](https://scriptable.app) pour iOS qui vous permet de surveiller et de contrôler votre véhicule électrique Hyundai/Kia via l'API Bluelink — directement depuis votre écran d'accueil.

> **Basé sur [egmp-bluelink-scriptable](https://github.com/andyfase/egmp-bluelink-scriptable) par [Andy Fase](https://github.com/andyfase).** Tout le crédit pour l'intégration API originale, le framework de widgets et l'architecture de l'application revient à Andy. Ce fork ajoute des améliorations d'interface, des widgets améliorés et des fonctionnalités pratiques.

### Fonctionnalités

- **Widgets d'écran d'accueil** (petit, moyen, accessoires d'écran de verrouillage)
  - Image du véhicule centrée dans le widget
  - % de batterie + autonomie en haut à gauche
  - Icône verrouillage/déverrouillage cliquable en haut à droite — verrouillez ou déverrouillez votre voiture directement depuis le widget
  - Couleur de la batterie : blanc (normal) → jaune (≤20%) → rouge (≤10%)
  - Adresse de localisation du véhicule affichée sous le % de batterie
- **Application principale**
  - Statut du véhicule mis à jour automatiquement à chaque ouverture
  - Contrôle climatique (chauffage/refroidissement/dégivrage) avec mises à jour en temps réel
  - Délai de 5 minutes entre les commandes climatiques pour éviter les limites de l'API Bluelink, avec minuterie en direct
  - Alertes d'erreur affichées sous forme de fenêtres modales centrées
  - Contrôles de verrouillage / déverrouillage / recharge
- **Support multilingue** : français et anglais (configurable dans les Paramètres)
- **Support des raccourcis Siri**
- **Plusieurs régions** : États-Unis, Canada, Europe, Australie, Inde

### Prérequis

- iPhone avec [Scriptable](https://scriptable.app) installé (gratuit sur l'App Store)
- Un VÉ Hyundai ou Kia avec un abonnement Bluelink / UVO / MyKia actif
- Vos identifiants de l'application Bluelink (courriel, mot de passe, NIP)

### Installation

1. Installez [Scriptable](https://scriptable.app) depuis l'App Store.
2. Téléchargez le fichier `.js` de la dernière version depuis la page [Releases](https://github.com/LuisCabG/BlueLink-IOS-Wrapper-Script/releases).
3. Placez le fichier dans votre dossier **iCloud Drive → Scriptable**.
4. Ouvrez Scriptable, appuyez sur le script et suivez les instructions à l'écran pour entrer votre région et vos identifiants.

### Ajouter un widget

1. Appuyez longuement sur l'écran d'accueil → appuyez sur **+** → recherchez **Scriptable**.
2. Choisissez la taille du widget (Petit ou Moyen recommandé).
3. Appuyez sur le widget → définissez le **Script** avec le nom de ce script.
4. Définissez **Lors de l'interaction** sur **Exécuter le script**.

### Sécurité

Vos identifiants (courriel, mot de passe, NIP) sont stockés exclusivement dans le **trousseau iOS** — ils ne quittent jamais votre appareil en clair. Le script communique directement avec l'API Bluelink de Hyundai/Kia via HTTPS, les mêmes points d'accès que l'application Bluelink officielle.

### Mise à jour

Ouvrez le script → appuyez sur l'option **ℹ À propos** → si une version plus récente est disponible, vous verrez un bouton **Installation auto** qui télécharge et remplace le script en un seul appui (avec une sauvegarde automatique de votre version actuelle).

### Notes de test

> ⚠️ Cette application a été testée uniquement sur un **iPhone 17 Pro Max** — elle devrait fonctionner sur d'autres modèles iPhone, mais cela n'a pas été vérifié. Seule la région **Canada** a été testée. Les autres régions peuvent fonctionner (elles utilisent la même logique API en amont) mais ne sont pas garanties.

### Avertissement

> **Utilisation à vos propres risques.**
>
> Il s'agit d'un outil non officiel, développé par la communauté, sans aucune affiliation avec Hyundai, Kia ou leurs filiales. Il interagit avec votre véhicule via la même API que l'application Bluelink officielle, mais aucune garantie n'est donnée quant à sa fiabilité, son exactitude ou sa sécurité.
>
> L'auteur n'est **pas responsable** des dommages, pertes de données, comportements involontaires du véhicule, annulations de garantie, blocages de compte ou toute autre conséquence. En utilisant cet outil, vous acceptez l'entière responsabilité de toute action effectuée sur votre véhicule.

### Soutien

Si cette application vous fait gagner du temps, pensez à m'offrir un café — ça aide à maintenir le projet !

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/donlucho)

### Crédits

- **Projet original** : [egmp-bluelink-scriptable](https://github.com/andyfase/egmp-bluelink-scriptable) par [Andy Fase](https://github.com/andyfase)
- **Ce fork** : [LuisCabG](https://github.com/LuisCabG)

### Licence

MIT — voir [LICENSE](LICENSE).
