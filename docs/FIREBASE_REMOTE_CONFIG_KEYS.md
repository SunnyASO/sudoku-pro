# Firebase Remote Config Keys

Firebase Console path:

```text
Firebase Console → Remote Config → Add parameter
```

After adding/updating parameters, click:

```text
Publish changes
```

## Ad master controls

| Key | Type | Default |
|---|---:|---:|
| `ads_enabled` | Boolean | `true` |
| `ad_test_mode_enabled` | Boolean | `false` |

## Banner controls

| Key | Type | Default |
|---|---:|---:|
| `banner_ads_enabled` | Boolean | `true` |
| `home_banner_enabled` | Boolean | `false` |
| `home_banner_fallback_enabled` | Boolean | `true` |

## Native ad controls

| Key | Type | Default |
|---|---:|---:|
| `native_ads_enabled` | Boolean | `true` |
| `home_native_enabled` | Boolean | `true` |
| `achievements_native_enabled` | Boolean | `true` |
| `daily_challenge_native_enabled` | Boolean | `true` |
| `native_ad_height_dp` | Number | `120` |
| `native_ad_bottom_margin_dp` | Number | `16` |

## Interstitial controls

| Key | Type | Default |
|---|---:|---:|
| `interstitial_ads_enabled` | Boolean | `true` |
| `completion_interstitial_enabled` | Boolean | `true` |
| `new_game_interstitial_enabled` | Boolean | `true` |
| `abandon_interstitial_enabled` | Boolean | `true` |
| `fullscreen_ad_cooldown_seconds` | Number | `120` |
| `completion_interstitial_every` | Number | `2` |
| `completion_interstitial_session_cap` | Number | `2` |

## Rewarded controls

| Key | Type | Default |
|---|---:|---:|
| `rewarded_ads_enabled` | Boolean | `true` |
| `rewarded_hint_enabled` | Boolean | `true` |
| `mistake_rescue_rewarded_enabled` | Boolean | `true` |
| `daily_challenge_rewarded_enabled` | Boolean | `true` |
| `bonus_rewarded_enabled` | Boolean | `true` |

## App Open controls

| Key | Type | Default |
|---|---:|---:|
| `app_open_ads_enabled` | Boolean | `false` |

Keep `app_open_ads_enabled = false` until App Open Ads are intentionally implemented.

## Push notification controls

| Key | Type | Default |
|---|---:|---:|
| `push_notifications_enabled` | Boolean | `true` |
| `push_topic_general_enabled` | Boolean | `true` |

## Copy-paste values

```text
ads_enabled = true
ad_test_mode_enabled = false

banner_ads_enabled = true
home_banner_enabled = false
home_banner_fallback_enabled = true

native_ads_enabled = true
home_native_enabled = true
achievements_native_enabled = true
daily_challenge_native_enabled = true
native_ad_height_dp = 120
native_ad_bottom_margin_dp = 16

interstitial_ads_enabled = true
completion_interstitial_enabled = true
new_game_interstitial_enabled = true
abandon_interstitial_enabled = true
fullscreen_ad_cooldown_seconds = 120
completion_interstitial_every = 2
completion_interstitial_session_cap = 2

rewarded_ads_enabled = true
rewarded_hint_enabled = true
mistake_rescue_rewarded_enabled = true
daily_challenge_rewarded_enabled = true
bonus_rewarded_enabled = true

app_open_ads_enabled = false

push_notifications_enabled = true
push_topic_general_enabled = true
```

## Safety rules

- Do not put AdMob ad unit IDs in Remote Config.
- Do not put secrets/passwords/API private keys in Remote Config.
- If `ads_enabled = false`, show no ads.
- If user is premium, show no banner/native/interstitial ads and auto-grant rewarded rewards.
- If Remote Config fails, use safe local defaults.
- For final release, keep `ad_test_mode_enabled = false`.
