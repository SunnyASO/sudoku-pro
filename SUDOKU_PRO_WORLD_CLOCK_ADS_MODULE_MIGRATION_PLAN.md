# Sudoku Pro — World Clock Ads Module Migration Plan

**Status:** Approved implementation plan — phased migration only
**Target project:** `D:\Antigravity\sudoku-pro-restored`
**Reference benchmark build:** `WorldClock_vn1.9vc9-release.aab`
**Current Sudoku Pro baseline:** `v1.0.18 (versionCode 20)`
**Plan date:** 2026-11-19

---

## 1. Objective

Migrate Sudoku Pro toward the proven native Android advertising architecture observed in the World Clock production build, with the primary goals of:

- increasing AdMob show rate;
- reducing matched ads that never become impressions;
- improving impressions per legitimate ad opportunity;
- improving placement-level attribution and reporting;
- reducing speculative ad requests;
- preserving premium behavior, gameplay UX, and existing monetization rules;
- moving ad lifecycle ownership out of JavaScript where practical and into a native Java ads module behind Capacitor.

This plan does **not** assume that World Clock's architecture alone caused its higher show rate. Traffic, geography, user behavior, format mix, ad source, and reporting periods also affect AdMob performance.

World Clock is therefore used as a **tested architectural benchmark**, not as a guaranteed numerical target.

---

## 2. Current Sudoku Pro benchmark

Recent AdMob Network report for Sudoku Pro, last 7 days:

| Placement | Matched requests | Impressions | Show rate |
|---|---:|---:|---:|
| App Open | 113 | 12 | 10.62% |
| Home Native | 76 | 53 | 69.74% |
| Home Banner | 12 | 4 | 33.33% |
| Gameplay Banner | 69 | 68 | 98.55% |
| Completion Interstitial | 18 | 16 | 88.89% |
| Abandon Interstitial | 29 | 22 | 75.86% |
| Daily Challenge | 10 | 10 | 100.00% |
| Mistake Rescue Rewarded | 12 | 0 | 0.00% |

Aggregate:

- Requests: 466
- Matched requests: 346
- Impressions: 190
- Show rate: 54.91%

The largest single source of show-rate loss is App Open:

- 113 matched requests
- 12 impressions
- 101 matched ads did not become impressions

Gameplay Banner is already healthy and should not be aggressively redesigned early.

---

## 3. World Clock architecture findings

Inspection of the World Clock AAB and its bundled R8/ProGuard mapping revealed a dedicated native advertising package:

`com.dev.bytes.adsmanager`

Recoverable components include:

- `AppOpen`
- `InterAdsManagerKt`
- `RewardedAdManagerKt`
- `NativeAdsManagerKt`
- `InterAdPair`
- `RewardedAdPair`
- `NativeAdPair`
- `InterDelayTimer`
- `ADUnitType`
- `ADUnitPlacements`
- `BannerADUnit`
- `RemoteConfig`

The reference build also contains:

- Google Mobile Ads SDK 24.2.0
- Google User Messaging Platform (UMP) 3.1.0

World Clock therefore uses a substantially more native, modular advertising architecture than Sudoku Pro currently does.

### Key architectural characteristics observed

#### 3.1 App Open ownership

The World Clock `AppOpen` implementation owns or directly coordinates:

- `Application`
- current `Activity`
- an `AppOpenAd`
- showing state
- Activity lifecycle callbacks
- process lifecycle observation
- loading UI/state
- Remote Config eligibility
- fullscreen/ad collision checks
- `showAdIfAvailable()`

A particularly important recovered pattern is that App Open ad request creation occurs in or very close to the `showAdIfAvailable()` path.

This strongly suggests a more **opportunity-driven load/show model** than Sudoku Pro's current speculative preload behavior.

#### 3.2 Native ad object wrappers

World Clock uses typed native ad holders such as:

- `InterAdPair`
- `RewardedAdPair`
- `NativeAdPair`

These objects hold the actual SDK ad object and expose state/show/populate behavior.

Examples conceptually include:

```text
InterAdPair
  └─ InterstitialAd
      ├─ isLoaded()
      └─ showAd(...)

RewardedAdPair
  └─ RewardedAd
      ├─ isLoaded()
      └─ showAd(...)

NativeAdPair
  └─ NativeAd
      ├─ isLoaded()
      └─ populate(...)
```

This is preferable to relying mainly on JavaScript booleans such as:

```text
isRewardedAdReady
currentPreloadedRewardedKey
```

because native SDK state remains the authoritative source of truth.

#### 3.3 Strongly identified placements

World Clock includes:

- `ADUnitType`
- `ADUnitPlacements`

Placement configuration contains properties such as:

- AdMob unit ID
- media aspect ratio
- AdChoices placement

The app also contains placement-specific Remote Config keys such as:

- `home_screen_native_ads`
- `allCity_list_screen_native_ads`
- `open_city_details_screen_native_ads`
- `settings_screen_native_ads`
- `convert_timeline_screen_native_ads`
- `onboarding_screen_native_ads`
- `language_screen_native_ads`
- `cross_premium_screen_inter_ads`
- `open_time_table_screen_rewarded_ads`

This confirms that World Clock treats placements as first-class identities rather than generic ad-format flags.

#### 3.4 Interstitial management

World Clock includes:

- format-specific interstitial loading;
- native interstitial holder objects;
- delay/cooldown logic through `InterDelayTimer`;
- callback-driven load/show behavior.

The important architectural principle is:

> Eligibility should influence whether an ad is requested, not only whether a loaded ad is allowed to show.

Avoid:

```text
request
→ matched
→ cooldown/session rule prevents display
→ matched inventory wasted
```

Prefer:

```text
not yet eligible
→ do not request

eligibility approaching
→ preload if appropriate

valid opportunity
→ show cached inventory
```

#### 3.5 Rewarded management

World Clock has dedicated rewarded manager and rewarded holder classes rather than a generic shared Boolean-ready state.

Sudoku Pro should move toward rewarded cache objects that carry placement identity and native object state.

#### 3.6 Native ads

World Clock has dedicated native ad loading and rendering code including placement-aware configuration.

Given World Clock's historically strong native show rates, this is the second major architecture area to migrate after App Open.

#### 3.7 Consent

World Clock includes UMP 3.1.0 and the corresponding Google consent stack.

Sudoku Pro should adopt a proper UMP-based advertising consent flow rather than relying solely on a custom local HTML consent flag.

---

## 4. Target Sudoku Pro architecture

Sudoku Pro should evolve toward the following structure:

```text
                  SUDOKU WEB UI
                       |
                       | Capacitor bridge
                       v
             SudokuAdsPlugin.java
                  thin bridge
                       |
                       v
        +--------------------------------+
        |      Native Ads Module         |
        |                                |
        | AdPlacement                    |
        | AdUnitResolver                 |
        | AdEligibilityPolicy            |
        | AdsRemoteConfig                |
        | FullscreenCoordinator          |
        |                                |
        | AppOpenManager                 |
        | InterstitialManager            |
        | RewardedManager                |
        | NativeAdManager                |
        | BannerManager                  |
        |                                |
        | AdAnalyticsTracker             |
        +---------------+----------------+
                        |
                        v
               Google Mobile Ads SDK
```

### Design principle

JavaScript should request ad actions.

Native Java should own:

- SDK object lifecycle;
- cache state;
- placement identity;
- freshness/TTL;
- activity validity;
- request cancellation;
- show eligibility;
- load/show callbacks;
- SDK impression callbacks;
- paid-event callbacks;
- stale inventory disposal.

Long-term JavaScript usage should become closer to:

```text
Ads.showNative("HOME")
Ads.showInterstitial("COMPLETION")
Ads.showRewarded("HINT")
Ads.hideNative("HOME")
```

rather than JavaScript coordinating low-level SDK state itself.

---

## 5. Migration strategy

Do **not** replace the full ad stack in one release.

Migrate format-by-format and validate each one before continuing.

Recommended order:

1. App Open
2. Home Native
3. Other Native placements
4. Interstitial
5. Rewarded
6. Banner
7. Remove obsolete legacy ad logic only after parity and production measurement

---

# Phase 0 — Protected baseline and reconstruction

## Goal

Establish a safe implementation baseline and reconstruct the World Clock patterns as precisely as the binary permits.

### Tasks

- confirm Sudoku Pro branch, HEAD, Git status and version;
- protect the clean baseline;
- inspect current production ad code before every migration batch;
- preserve production AdMob unit IDs unless explicitly approved;
- preserve Remote Config behavior;
- preserve premium suppression;
- preserve billing, review, update and gameplay logic;
- preserve signing configuration;
- do not reset or clean the repository;
- do not delete working legacy code until the replacement has passed validation.

### Deliverable

A format-by-format parity matrix:

| Capability | World Clock | Sudoku Pro | Migration action |
|---|---|---|---|
| App Open lifecycle | Native, lifecycle-owned | Custom Java + JS startup | Rebuild first |
| Native cache/placement | Native placement-aware | On-demand overlay | Migrate second |
| Interstitial lifecycle | Native manager/pair | Mostly JS/plugin | Migrate later |
| Rewarded lifecycle | Native manager/pair | Shared JS cache | Migrate later |
| Banner | Native abstraction | Capacitor plugin | Keep initially |
| UMP | Present | Missing/incomplete | Add |
| Remote Config | Native placement-aware | Existing | Preserve + adapt |
| Fullscreen lock | Native coordination | Existing functional lock | Preserve unless inferior |
| Placement identity | Strongly typed | Mixed/shared | Improve |
| Analytics | Native lifecycle callbacks | Partial | Expand |

---

# Phase 1 — App Open migration

## Why first

Sudoku App Open currently has the weakest show rate:

- matched: 113
- impressions: 12
- show rate: 10.62%

World Clock historically shows much stronger App Open impression capture.

This is the highest-value architecture to migrate first.

## Target

Create a new native App Open implementation modeled on World Clock's opportunity-driven architecture.

Suggested class:

`SudokuAppOpenManager.java`

### Required responsibilities

- own the current `AppOpenAd`;
- own current load/show state;
- observe Application/Activity lifecycle;
- know whether a valid App Open opportunity exists;
- respect premium entitlement;
- respect Remote Config;
- respect fullscreen ad coordination;
- respect billing flow;
- respect session cap;
- respect background threshold;
- respect minimum interval;
- reject stale Activity references;
- fail open to Home when no valid ad is available;
- prevent duplicate loads;
- prevent duplicate shows;
- expose actual SDK impression callbacks;
- expose paid events where available;
- track why loaded inventory was not used.

### Desired state model

```text
EMPTY
  |
  v
ELIGIBILITY_CHECK
  |
  +-- not eligible --> EMPTY
  |
  v
LOADING
  |
  +-- failed --> EMPTY/BACKOFF
  |
  v
READY
  |
  +-- opportunity expired --> DISPOSED
  |
  +-- premium/config changed --> DISPOSED
  |
  v
SHOWING
  |
  +-- impression
  |
  v
CONSUMED
  |
  v
EMPTY
```

### Important principle

Do not request App Open inventory far in advance of a real show opportunity unless production measurement proves that doing so improves both:

- impressions/session;
- show rate/revenue.

### Preserve existing Sudoku rules initially

Keep the currently intended policy unless explicitly changed:

- cold-start App Open opportunity;
- resume App Open behavior;
- ~45-second background threshold;
- ~120-second minimum interval/cooldown;
- session cap of 4;
- premium suppression;
- Remote Config gate;
- no App Open interruption after the user has already begun active gameplay just to consume inventory.

### Required instrumentation

For every App Open lifecycle:

- eligible opportunity;
- request initiated;
- load success;
- load failure;
- ready;
- show attempt;
- SDK impression;
- paid event;
- dismissal;
- unused disposal;
- disposal reason;
- cache age.

Normalized unused reasons should include:

- opportunity_expired
- premium_changed
- remote_config_disabled
- fullscreen_busy
- billing_active
- session_cap
- cooldown
- app_state_changed
- stale_activity
- replaced
- cache_expired
- unknown

### Gate before Phase 2

Do not migrate Native ads until:

- debug/test-ad physical device behavior is stable;
- cold start still fails open safely;
- resume behavior remains correct;
- no duplicate App Open shows occur;
- billing/premium suppression works;
- telemetry proves the new lifecycle is measurable;
- production measurement shows no major regression in impressions/session or revenue.

---

# Phase 2 — Home Native migration

## Goal

Replace the current purely on-demand native overlay lifecycle with a placement-aware native manager inspired by World Clock's `NativeAdPair` model.

Suggested classes:

```text
NativeAdManager.java
NativeAdSlot.java
NativePlacementConfig.java
```

## Requirements

Each native slot should track:

- placement;
- native SDK object;
- load state;
- generation/request token;
- loaded timestamp;
- current screen/session generation;
- rendering configuration;
- AdChoices placement;
- media aspect ratio;
- visibility ownership.

### Fix the current stale-load race

Current Sudoku behavior can allow a native callback to arrive after navigation.

Required rule:

```text
load starts for HOME generation 42
user leaves HOME
HOME generation becomes 43
callback for generation 42 arrives
→ destroy NativeAd
→ never attach view
```

### Home Native goals

- request only when Home has a real display opportunity;
- avoid duplicate requests for the same Home visit;
- preserve a valid already-shown ad across harmless DOM rerenders where appropriate;
- destroy inventory when the screen opportunity is genuinely gone;
- capture real SDK impressions;
- track stale-disposal causes.

### Gate before other Native placements

Measure:

- requests;
- matched/loaded;
- impressions;
- stale disposals;
- screen-left-before-load;
- impressions per Home visit;
- Home Native show rate.

---

# Phase 3 — Other Native placements

After Home Native is stable, migrate:

- Gameplay Native
- Pause Native
- Victory Native
- Achievements Native
- Daily Challenge Native

Use strongly typed internal placement identities:

```text
HOME
GAMEPLAY
PAUSE
VICTORY
ACHIEVEMENTS
DAILY_CHALLENGE
```

Do not require separate AdMob ad unit IDs immediately.

Internal placement identity and lifecycle ownership should be separated first.

Dedicated production unit IDs can be introduced later only if explicitly approved.

---

# Phase 4 — Interstitial migration

## Goal

Move interstitial lifecycle ownership from JavaScript/community-plugin calls into a native manager modeled on World Clock's interstitial architecture.

Suggested classes:

```text
InterstitialManager.java
InterstitialSlot.java
InterstitialDelayPolicy.java
```

### Preserve existing Sudoku placement policies

Initially preserve:

- Completion Interstitial
- New Game Interstitial
- Abandon Interstitial
- Game Over Interstitial
- cooldown rules
- session caps
- natural-break placement behavior

### Key design rule

Do not preload every interstitial generically.

Preload only when:

- the placement is enabled;
- premium is false;
- cooldown/session rules indicate a likely upcoming opportunity;
- no conflicting fullscreen ad is active;
- the placement has a predictable future trigger.

Examples:

Completion may be preloaded late in a puzzle when a valid completion opportunity is becoming likely.

Abandon may remain on-demand because abandonment is unpredictable.

### Slot state

```text
EMPTY
LOADING
READY
SHOWING
CONSUMED
FAILED
EXPIRED
INVALIDATED
```

### Gate

Do not proceed until:

- existing completion show rate is preserved or improved;
- no additional interruptions are introduced;
- navigation fallback remains immediate if an ad cannot show;
- fullscreen mutual exclusion remains correct.

---

# Phase 5 — Rewarded migration

## Goal

Replace generic JavaScript rewarded readiness booleans with native rewarded slot objects carrying placement identity.

Suggested model:

```text
RewardedSlot {
    placement
    RewardedAd ad
    state
    loadedAt
}
```

### Placements

Examples include:

```text
HINT
MISTAKE_RESCUE
DAILY_CHALLENGE
VICTORY_BONUS
THEME_UNLOCK
AUTO_CHECK
```

### Requirements

- no rewarded ad may be consumed by the wrong placement;
- reward callback grants exactly once;
- premium auto-grant behavior is preserved;
- no rewarded ad is forced merely to improve show rate;
- preload only when user intent becomes reasonably likely;
- cache freshness/TTL is explicit;
- stale/replaced rewarded inventory is measurable.

### Intent-proximate preload examples

Mistake Rescue:

- prepare when the user approaches rescue eligibility, such as after the second mistake;
- do not prepare generically at startup.

Hint:

- prepare when no free hints remain or the rewarded hint opportunity becomes likely.

Daily Challenge/theme/victory:

- preserve current voluntary opt-in behavior.

---

# Phase 6 — Banner migration

## Priority

Low.

Gameplay Banner currently performs very well:

- 69 matched
- 68 impressions
- 98.55% show rate

Do not destabilize this path early.

Only migrate banner ownership after App Open, Native, Interstitial and Rewarded paths are stable.

If the existing banner plugin remains superior and reliable, it may remain as-is behind the final Ads facade.

Architectural purity is not more important than working monetization.

---

## 6. Consent / UMP integration

Sudoku Pro should implement Google's supported UMP flow.

### Required behavior

At launch:

1. update consent information;
2. determine whether a form is required;
3. display the required form where applicable;
4. use authoritative UMP consent state;
5. allow advertising requests only when UMP permits them;
6. expose privacy-options entry in Settings when required;
7. avoid duplicate Mobile Ads initialization;
8. fail safe without permanently blocking app startup.

The existing custom Sudoku first-launch consent UI should not be treated as the authoritative AdMob consent mechanism.

If it has a separate onboarding/privacy acknowledgment purpose, preserve that purpose without duplicating or misrepresenting Google's advertising consent.

---

## 7. Fullscreen coordination

Sudoku Pro already has working fullscreen coordination.

Do **not** rewrite it automatically.

The final native module should either:

- reuse the existing coordination semantics; or
- replace them only after proving the new native coordinator is equivalent or better.

All fullscreen formats must remain mutually exclusive:

```text
App Open
Interstitial
Rewarded
Billing flow
Other blocking system UI
```

No two fullscreen ad flows may race or overlap.

---

## 8. Placement model

Create strongly typed internal placement identities.

Example:

```text
APP_OPEN_COLD_START
APP_OPEN_RESUME

HOME_NATIVE
GAMEPLAY_NATIVE
PAUSE_NATIVE
VICTORY_NATIVE
ACHIEVEMENTS_NATIVE
DAILY_CHALLENGE_NATIVE

GAMEPLAY_BANNER
HOME_BANNER

COMPLETION_INTERSTITIAL
NEW_GAME_INTERSTITIAL
ABANDON_INTERSTITIAL
GAME_OVER_INTERSTITIAL

HINT_REWARDED
MISTAKE_RESCUE_REWARDED
DAILY_CHALLENGE_REWARDED
VICTORY_BONUS_REWARDED
THEME_UNLOCK_REWARDED
AUTO_CHECK_REWARDED
```

Every load, show, failure, impression and paid event should be associated with a placement identity.

---

## 9. Ad funnel telemetry

The migration must make the complete ad lifecycle measurable.

Required funnel:

```text
eligible opportunity
        ↓
request initiated
        ↓
loaded / matched
        ↓
ready
        ↓
show attempted
        ↓
SDK impression
        ↓
paid event
        ↓
dismissal
```

Also track inventory that never reaches impression.

### Minimal events

- `ad_opportunity`
- `ad_requested`
- `ad_loaded`
- `ad_load_failed`
- `ad_show_attempt`
- `ad_impression`
- `ad_paid`
- `ad_dismissed`
- `ad_cache_expired`
- `ad_inventory_disposed`
- `ad_skipped`

### Important

A successful call to `show()` is **not** a confirmed impression.

`ad_impression` must be emitted only from the SDK's actual impression callback where available.

Do not send high-cardinality request IDs as Firebase custom dimensions.

---

## 10. Success metrics

Primary metric:

```text
show rate = SDK impressions / matched requests
```

But do not optimize this metric in isolation.

Guardrails:

- impressions/session must not fall materially;
- revenue/session must not fall materially;
- retention must not fall;
- crash/ANR must not regress;
- premium users must not see forced ads;
- rewarded ads must remain voluntary;
- no deceptive ad placement;
- no extra ad interruptions merely to consume inventory.

### Placement-specific goals

App Open:

- major improvement from current 10.62%;
- reduce speculative matched inventory;
- improve impression capture per valid opportunity.

Home Native:

- improve from current 69.74%;
- reduce stale native callbacks and unused matched loads.

Gameplay Banner:

- preserve approximately current 98.55% show rate.

Interstitial:

- preserve high-performing existing placements while reducing load/show latency.

Rewarded:

- reduce unused speculative inventory;
- preserve reward conversion and exact-once semantics.

Aggregate:

- materially improve from current 54.91%;
- do not sacrifice absolute impressions or revenue merely to raise the percentage.

World Clock's >80% aggregate/network benchmark is an architectural reference, not a guaranteed Sudoku target.

---

## 11. Implementation safety rules

Throughout the migration:

- no `git reset`;
- no `git clean`;
- no unrelated dependency upgrades;
- no production ad ID changes without approval;
- no Remote Config policy changes without approval;
- no version bump unless explicitly authorized;
- no release upload unless explicitly authorized;
- no removal of legacy code until replacement parity is proven;
- no increase in ad frequency merely to improve show rate;
- no forced rewarded impressions;
- no App Open shown after the user is already actively interacting merely to consume a cached ad;
- preserve premium purchase/restore behavior;
- preserve Review and In-App Update systems;
- preserve gameplay state and navigation;
- preserve signing configuration.

---

## 12. Rollout strategy

Each format migration must use the following sequence:

```text
1. Inspect current Sudoku behavior
2. Reconstruct corresponding World Clock behavior
3. Implement isolated native replacement
4. Use test ads
5. Static validation
6. Physical-device lifecycle testing
7. Compare old vs new funnel
8. Keep rollback path
9. Release only after approval
10. Measure equivalent production window
11. Proceed to next format only after parity
```

Do not migrate multiple major formats in the same production experiment unless the previous format is already proven.

---

## 13. Recommended immediate next task

The next implementation task should be **App Open only**.

Antigravity should:

1. inspect World Clock's recovered `AppOpen` class and related lifecycle references;
2. inspect Sudoku Pro's current `AppOpenAdPlugin.java` and startup/resume JS;
3. produce a state-machine comparison;
4. create a Sudoku-native `AppOpenManager` modeled on the World Clock opportunity-driven lifecycle;
5. preserve Sudoku premium, Remote Config, billing, cooldown, background threshold and session cap rules;
6. instrument the full request → load → show → SDK impression → dismissal path;
7. use test ads for validation;
8. keep the old App Open implementation available for rollback;
9. do not migrate Native/Interstitial/Rewarded/Banner in the same batch;
10. do not commit/push/release without explicit approval.

### App Open validation matrix

Must test:

- fresh install;
- returning user;
- premium user;
- Remote Config disabled;
- cold start with fast network;
- cold start with slow network;
- no-fill;
- background < threshold;
- background > threshold;
- cooldown active;
- session cap reached;
- billing flow active;
- rewarded/interstitial busy;
- app backgrounded during load;
- Activity changes during load;
- duplicate resume callbacks;
- consent required;
- consent not required;
- consent network error;
- ad loaded but opportunity disappears;
- dismissal;
- show failure.

---

## 14. Post-App-Open decision gate

After App Open is implemented and tested:

Compare:

```text
Old:
matched requests
impressions
show rate
impressions/session
estimated revenue/session

New:
matched requests
impressions
show rate
impressions/session
estimated revenue/session
unused loaded inventory
```

Only proceed to Native migration when the new App Open architecture is stable and no major monetization or UX regression is observed.

---

## 15. Final migration destination

Long-term target:

```text
Sudoku UI / JavaScript
          |
          v
SudokuAdsPlugin
          |
          v
Native Ads Module
├── AppOpenManager
├── NativeAdManager
├── InterstitialManager
├── RewardedManager
├── BannerManager
├── AdEligibilityPolicy
├── AdUnitResolver
├── AdsRemoteConfig
├── FullscreenCoordinator
└── AdAnalyticsTracker
          |
          v
Google Mobile Ads SDK
```

JavaScript remains the product/UI layer.

Native Java becomes the authoritative advertising lifecycle layer.

This design follows the strongest reusable pattern recovered from World Clock while preserving Sudoku Pro's existing successful behavior where it is already performing well.

---

## 16. Decision

**Approved architectural direction:**

Reimplement the World Clock advertising module's proven native patterns inside Sudoku Pro rather than directly copying compiled classes.

**Migration order:**

**App Open → Home Native → Other Native → Interstitial → Rewarded → Banner**

**Immediate focus:**

App Open lifecycle and show-rate efficiency.

**App size optimization:**

Postponed until the ads migration is stable.
