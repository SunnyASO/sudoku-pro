# Release Checklist

Use this before uploading any AAB to Play Console.

## 1. Confirm project path

```powershell
Set-Location "D:\Antigravity\sudoku-pro-restored"
```

## 2. Confirm version/package

```powershell
Select-String -Path android\app\build.gradle -Pattern "applicationId|versionCode|versionName"
```

Expected package:

```text
com.appsedifice.sudokupro.logicpuzzle
```

Version must be higher than the latest uploaded Play Console version.

## 3. Confirm production ad mode before release

```powershell
Select-String -Path www\admob-config.js -Pattern "IS_PRODUCTION|ADS_ENABLED"
```

For Play release:

```js
IS_PRODUCTION: true
ADS_ENABLED: true
```

## 4. Confirm no old Home version text

```powershell
Select-String -Path www\index.html -Pattern "Version 1.0.0"
Select-String -Path android\app\src\main\assets\public\index.html -Pattern "Version 1.0.0"
```

Expected: no output.

## 5. Confirm signing files are local only

```powershell
git check-ignore android\key.properties
git check-ignore android\app\sudoku-pro-release-key.keystore
Select-String -Path android\app\build.gradle -Pattern "storePassword '.*'|keyPassword '.*'"
```

Expected:

- first two commands identify ignored files
- password search returns no output

## 6. Build

```powershell
node --check www/script.js
node --check www/admob-config.js
node --check www/admob-service.js

npx.cmd cap sync android

Set-Location ".\android"
.\gradlew.bat clean
.\gradlew.bat bundleRelease
```

## 7. AAB path

```text
D:\Antigravity\sudoku-pro-restored\android\app\build\outputs\bundle\release\app-release.aab
```

## 8. Manual test after Internal Testing update

- Home opens.
- Native ad appears at bottom.
- Daily Challenge opens.
- Achievements opens.
- Settings opens and native ad hides.
- Remove Ads opens Google Play purchase popup.
- Premium users see no banner/native/interstitial ads.
- App Open Ads remain disabled.
- Push notification permission is requested only after user action.
- Remote Config fetch logs success or defaults.
