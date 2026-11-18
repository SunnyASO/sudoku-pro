# Sudoku Pro Project Memory

Last updated: 2026-08-07

## Project

- Project path: `D:\Antigravity\sudoku-pro-restored`
- Platform: Android Capacitor WebView app with native Java plugins.
- Package ID: `com.appsedifice.sudokupro.logicpuzzle`
- Firebase project: `sudoku-4cfd4`
- Active release/testing flow: build AAB and upload through Google Play Console Internal/Open Testing.
- Do not use Flutter commands for this project.

## Important commands

```powershell
Set-Location "D:\Antigravity\sudoku-pro-restored"

node --check www/script.js
node --check www/admob-config.js
node --check www/admob-service.js

npx.cmd cap sync android

Set-Location ".\android"
.\gradlew.bat clean
.\gradlew.bat assembleDebug
.\gradlew.bat bundleRelease
```

Release AAB:

```text
D:\Antigravity\sudoku-pro-restored\android\app\build\outputs\bundle\release\app-release.aab
```

## Current version status

- Current release build: `versionCode 18`
- Current version name: `1.0.16`

Check before upload:

```powershell
Set-Location "D:\Antigravity\sudoku-pro-restored"
Select-String -Path android\app\build.gradle -Pattern "applicationId|versionCode|versionName"
```

## Signing safety

Never commit:

- `android/key.properties`
- `android/app/sudoku-pro-release-key.keystore`
- passwords or keystore files

Check:

```powershell
git check-ignore android\key.properties
git check-ignore android\app\sudoku-pro-release-key.keystore
Select-String -Path android\app\build.gradle -Pattern "storePassword '.*'|keyPassword '.*'"
```

## Current monetization status (v1.0.16 Release)

Aggressive & policy-compliant configuration active in v1.0.16:

- Google Play Billing Library 9.1.0 (Remove Ads lifetime purchase preserved)
- Firebase Remote Config live integration via `RemoteConfigPlugin.java`
- App Open Ads (`AppOpenAdPlugin.java`):
  - Enabled on eligible cold starts (skipped on first-ever launch; never delayed after interactive content visible)
  - Enabled on background resume after 180s in background
  - Never interrupts active gameplay or purchase flows
  - Enforces minimum 240s interval and 2/session cap
  - Synchronized with shared full-screen ad lock
- Gameplay Adaptive Banner:
  - Enabled & active during gameplay (`gameplay_banner_enabled: true`)
  - Reserving 65px safe layout space with responsive board scaling (`#game-screen.has-banner`)
  - Banner refresh managed by AdMob (no custom refresh timers)
- Interstitials:
  - Fullscreen ad cooldown set to 90 seconds
  - Completion interstitial frequency = every 1 completion (`completion_interstitial_every: 1`)
  - Completion interstitial session cap = 5 (`completion_interstitial_session_cap: 5`)
  - Interstitials only at genuine content breaks (completion, voluntary abandonment)
  - Never at app exit, on game start from home, during gameplay, or immediately after another full-screen ad
- One shared full-screen ad lock across App Open, Interstitials, and Rewarded ads
- Native ads bottom-anchored on Home, Daily Challenge, and Achievements (120dp height, 16dp margin)
- Economy preserved: 3 free hints (`starting_free_hints: 3`) and existing rewarded behaviors
- Premium users (`window.isPremium === true`) receive zero forced ads
- Production flag confirmed: `IS_PRODUCTION: true`

## Firebase Push Notifications Status

- Status: **NOT IMPLEMENTED** (kept outside this task per user instruction)
- No FCM dependencies in `build.gradle`, no service in `AndroidManifest.xml`, and no notification permission requested in v1.0.16.

## Premium / Remove Ads rules

Premium users (`window.isPremium === true`):

- No banner ads (home or gameplay)
- No native ads
- No interstitial ads
- No App Open ads
- Rewarded placements auto-grant rewards without showing ad

