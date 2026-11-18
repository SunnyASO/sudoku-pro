# Firebase Remote Config and Push Notifications Implementation Plan

## Goal

Integrate:

1. Firebase Remote Config to control ad behavior without shipping a new update.
2. Firebase Cloud Messaging to send push notifications to users.

## Current confirmed state

- Firebase Analytics is already added.
- Remote Config is not implemented yet.
- Push Notifications / FCM are not implemented yet.
- Native ads work and are anchored at the bottom.
- Remove Ads / Billing Library 9.1.0 is working.
- App Open Ads must remain disabled.

## Android dependencies

Modify:

```text
android/app/build.gradle
```

Add:

```gradle
implementation 'com.google.firebase:firebase-config'
implementation 'com.google.firebase:firebase-messaging'
```

Keep existing Firebase BOM.

Increase:

```gradle
versionCode 17
versionName "1.0.15"
```

## Android manifest

Modify:

```text
android/app/src/main/AndroidManifest.xml
```

Add:

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

Register Firebase messaging service:

```xml
<service
    android:name=".SudokuFirebaseMessagingService"
    android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>
```

Add default notification channel metadata if needed:

```xml
<meta-data
    android:name="com.google.firebase.messaging.default_notification_channel_id"
    android:value="sudoku_updates" />
```

## New Java files

Create:

```text
android/app/src/main/java/com/antigravity/sudokupro/RemoteConfigPlugin.java
android/app/src/main/java/com/antigravity/sudokupro/PushNotificationPlugin.java
android/app/src/main/java/com/antigravity/sudokupro/SudokuFirebaseMessagingService.java
```

### RemoteConfigPlugin.java

Plugin name:

```java
@CapacitorPlugin(name = "RemoteConfig")
```

Responsibilities:

- Set safe in-app defaults.
- Call `fetchAndActivate()`.
- Return config values to JavaScript.
- Continue using defaults if fetch fails.
- Log fetch success/failure.

### PushNotificationPlugin.java

Plugin name:

```java
@CapacitorPlugin(name = "PushNotifications")
```

Expose JS methods:

- `requestPermission()`
- `getToken()`
- `subscribeToTopic({ topic })`
- `unsubscribeFromTopic({ topic })`

### SudokuFirebaseMessagingService.java

Responsibilities:

- Extend `FirebaseMessagingService`.
- Log new FCM token in `onNewToken()`.
- Handle notification/data messages in `onMessageReceived()`.
- Show Android notification using app icon, title, and body.
- Open app when notification is tapped.
- Use notification channel:
  - ID: `sudoku_updates`
  - Name: `Sudoku Updates`

## MainActivity.java

Register plugins before `super.onCreate(savedInstanceState)`:

```java
registerPlugin(SudokuAnalyticsPlugin.class);
registerPlugin(BillingPlugin.class);
registerPlugin(NativeAdPlugin.class);
registerPlugin(RemoteConfigPlugin.class);
registerPlugin(PushNotificationPlugin.class);
super.onCreate(savedInstanceState);
```

Also create notification channel for Android 8+.

## JavaScript changes

Modify:

```text
www/admob-config.js
www/admob-service.js
www/script.js
```

### admob-config.js

- Keep all AdMob unit IDs local.
- Add local default config values matching `FIREBASE_REMOTE_CONFIG_KEYS.md`.
- Merge Remote Config values into local config.
- If fetch fails, keep local defaults.

### admob-service.js

Respect Remote Config values:

- `ads_enabled`
- `native_ads_enabled`
- `interstitial_ads_enabled`
- `rewarded_ads_enabled`
- placement-specific booleans
- cooldown/frequency values

Do not show ads if `window.isPremium === true`.

If Home native fails and `home_banner_fallback_enabled === true`, show Home banner fallback.

### script.js

Startup behavior:

- Fetch Remote Config during startup/home initialization.
- Do not block gameplay if Remote Config fails.
- Do not request notification permission on splash.
- Add Settings option/button: `Enable Notifications`
- When user taps it:
  - request notification permission
  - get FCM token
  - subscribe to topic `sudoku_general` if allowed and enabled by Remote Config.

## Notification UX rules

- Do not show notification permission popup immediately on first launch.
- Ask from Settings or after user intent.
- Do not send private or sensitive user data in notification payloads.
- Use simple topic messaging for now: `sudoku_general`

## Build verification

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

Expected AAB:

```text
D:\Antigravity\sudoku-pro-restored\android\app\build\outputs\bundle\release\app-release.aab
```

## Release reminder

Debug/testing can use:

```js
IS_PRODUCTION: false
```

Before Play Console release, switch to:

```js
IS_PRODUCTION: true
```

Also keep Remote Config:

```text
ad_test_mode_enabled = false
app_open_ads_enabled = false
```
