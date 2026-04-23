export type Lang = 'en' | 'fr'

let _lang: Lang = 'en'

export function setLang(lang: Lang) {
  _lang = lang
}

export function getLang(): Lang {
  return _lang
}

const en = {
  // ── General ──
  ok: 'Ok',
  cancel: 'Cancel',
  save: 'Save',
  install: 'Install',
  settings: 'Settings',
  share_debug_logs: 'Share Debug Logs',

  // ── App buttons ──
  charge: 'Charge',
  stop: 'Stop',
  climate: 'Climate',
  locked: 'Locked',
  unlocked: 'Unlocked',
  refresh: 'Refresh',
  remaining: 'remaining',
  vin_prefix: 'VIN ',
  waiting_for_car: '↻  Waiting for car...',

  // ── App status messages ──
  starting_charge: 'Starting charging...',
  charge_started: 'Charging started! ✓',
  charge_start_fail: 'Failed to start charging!',
  stopping_charge: 'Stopping charging...',
  charge_stopped: 'Charging stopped! ✓',
  charge_stop_fail: 'Failed to stop charging!',
  locking: 'Locking car...',
  car_locked: 'Car locked! ✓',
  lock_fail: 'Failed to lock car!',
  unlocking: 'Unlocking car...',
  car_unlocked: 'Car unlocked! ✓',
  unlock_fail: 'Failed to unlock car!',
  refreshing_status: 'Refreshing status...',
  status_updated: 'Status updated! ✓',
  status_fail: 'Failed to refresh status!',
  setting_charge_limit: 'Setting charge limit...',
  charge_limit_fail: 'Failed to set charge limit!',
  confirm_charge_limit: 'Confirm charge limit to set',

  // ── Index errors ──
  error_initializing: 'Error Initializing Bluelink',
  multiple_cars: 'Multiple cars found, choose your EV',
  login_failed: 'Login Failed - please re-check your credentials',
  init_error_generic: 'Something went wrong initializing Bluelink - try again later',

  // ── About ──
  about_title: 'BlueLink iOS Wrapper',
  about_description:
    'A Scriptable app for iOS that allows you to control your Hyundai / Kia electric car using the Bluelink API.',
  about_author: 'Author: LuisCabG',
  about_based_on: 'Based on egmp-bluelink-scriptable by Andy Fase',
  about_current_version: 'Current Version:',
  about_latest_version: 'Latest Version Available:',
  about_release_details: 'Release Details:',
  about_downgrade_failed: 'Downgrade Failed',
  disclaimer_title: '⚠️ Disclaimer',
  disclaimer_body:
    'This is an unofficial tool not affiliated with Hyundai or Kia. Use at your own risk. The author is not responsible for any damage, unintended vehicle behavior, or other consequences resulting from its use.',
  coffee_title: '☕ Buy Me a Coffee',
  coffee_body: 'If this app saves you time, consider supporting it!',

  // ── Config ──
  config_title: 'Bluelink Configuration settings',
  config_subtitle: 'Saved within iOS keychain and never exposed beyond your device(s)',
  widget_poll_title: 'Widget Poll Periods',
  widget_poll_subtitle: 'All periods are measured in minutes',
  language_label: 'Language',
  language_english: 'English',
  language_french: 'Français',

  // ── Siri ──
  siri_unsupported: "I don't support that command.",
  siri_locked: 'locked',
  siri_unlocked: 'un-locked',
  siri_climate_on: ', and your climate is currently on',
  siri_plugged_in: '. Also your car is currently plugged into a charger.',
  siri_remote_request_sent:
    "I've issued a remote status request. Ask me for the normal status again in 30 seconds and I will have your answer.",
  siri_remote_request_fail:
    "I've issued a remote status request but it seems like the command was not sent. Please try again.",
} as const

const fr: typeof en = {
  // ── General ──
  ok: 'Ok',
  cancel: 'Annuler',
  save: 'Enregistrer',
  install: 'Installer',
  settings: 'Paramètres',
  share_debug_logs: 'Partager les journaux',

  // ── App buttons ──
  charge: 'Charger',
  stop: 'Arrêter',
  climate: 'Climatisation',
  locked: 'Verrouillé',
  unlocked: 'Déverrouillé',
  refresh: 'Actualiser',
  remaining: 'restant',
  vin_prefix: 'NIV ',
  waiting_for_car: '↻  En attente de la voiture...',

  // ── App status messages ──
  starting_charge: 'Démarrage de la charge...',
  charge_started: 'Charge démarrée ! ✓',
  charge_start_fail: 'Échec du démarrage de la charge !',
  stopping_charge: 'Arrêt de la charge...',
  charge_stopped: 'Charge arrêtée ! ✓',
  charge_stop_fail: "Échec de l'arrêt de la charge !",
  locking: 'Verrouillage...',
  car_locked: 'Voiture verrouillée ! ✓',
  lock_fail: 'Échec du verrouillage !',
  unlocking: 'Déverrouillage...',
  car_unlocked: 'Voiture déverrouillée ! ✓',
  unlock_fail: 'Échec du déverrouillage !',
  refreshing_status: 'Actualisation...',
  status_updated: 'Statut mis à jour ! ✓',
  status_fail: "Échec de l'actualisation !",
  setting_charge_limit: 'Définition de la limite...',
  charge_limit_fail: 'Échec de la limite de charge !',
  confirm_charge_limit: 'Confirmer la limite de charge',

  // ── Index errors ──
  error_initializing: "Erreur lors de l'initialisation de Bluelink",
  multiple_cars: 'Plusieurs véhicules trouvés, choisissez votre VÉ',
  login_failed: 'Échec de connexion – vérifiez vos identifiants',
  init_error_generic: "Une erreur s'est produite lors de l'initialisation – réessayez plus tard",

  // ── About ──
  about_title: 'BlueLink iOS Wrapper',
  about_description:
    "Une application Scriptable pour iOS permettant de contrôler votre véhicule électrique Hyundai / Kia via l'API Bluelink.",
  about_author: 'Auteur : LuisCabG',
  about_based_on: 'Basé sur egmp-bluelink-scriptable par Andy Fase',
  about_current_version: 'Version actuelle :',
  about_latest_version: 'Dernière version disponible :',
  about_release_details: 'Détails de la version :',
  about_downgrade_failed: 'Retour arrière échoué',
  disclaimer_title: '⚠️ Avertissement',
  disclaimer_body:
    "Cet outil non officiel n'est pas affilié à Hyundai ou Kia. Utilisation à vos propres risques. L'auteur décline toute responsabilité pour tout dommage, comportement involontaire du véhicule ou autre conséquence résultant de son utilisation.",
  coffee_title: '☕ Offrez-moi un café',
  coffee_body: 'Si cette app vous fait gagner du temps, pensez à soutenir le projet !',

  // ── Config ──
  config_title: 'Paramètres Bluelink',
  config_subtitle: 'Enregistrés dans le trousseau iOS, jamais exposés hors de votre appareil',
  widget_poll_title: 'Intervalles de mise à jour',
  widget_poll_subtitle: 'Toutes les périodes sont en minutes',
  language_label: 'Langue',
  language_english: 'English',
  language_french: 'Français',

  // ── Siri ──
  siri_unsupported: 'Je ne supporte pas cette commande.',
  siri_locked: 'verrouillée',
  siri_unlocked: 'déverrouillée',
  siri_climate_on: ', et votre climatisation est actuellement en marche',
  siri_plugged_in: '. Votre voiture est actuellement branchée à un chargeur.',
  siri_remote_request_sent: "J'ai envoyé une demande de statut à distance. Demandez-moi à nouveau dans 30 secondes.",
  siri_remote_request_fail:
    "J'ai envoyé une demande de statut à distance mais la commande ne semble pas avoir été transmise. Veuillez réessayer.",
}

const translations: Record<Lang, typeof en> = { en, fr }

export function t(key: keyof typeof en): string {
  return translations[_lang][key] ?? en[key]
}

export function webT(): Record<keyof typeof en, string> {
  return translations[_lang] as Record<keyof typeof en, string>
}
