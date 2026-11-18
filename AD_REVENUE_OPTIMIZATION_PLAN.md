# Sudoku Pro - Ad Revenue & Show Rate Optimization Plan

## 1. Executive Summary & Baseline Metrics Analysis

Based on current AdMob telemetry for **Sudoku: Classic Logic Puzzle** (450 Active Users, ~992 Total Impressions, ~$0.84 Estimated Earnings):

| Ad Unit | Format | Requests | Matched | Match Rate | Show Rate | Imps | Observed eCPM | Revenue Impact / Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Sudoku_AppOpen** | App Open | 674 | 649 | 96.29% | **7.70%** | 50 | $0.87 | **CRITICAL LEAK**: 599 matched ads wasted. |
| **Sudoku_MistakeRescue_Rewarded** | Rewarded | 22 | 22 | 100% | **4.55%** | 1 | $0.84 | **CRITICAL LEAK**: 21 loaded ads never shown. |
| **Sudoku_Hint_Rewarded** | Rewarded | 1 | 1 | 100% | **0.00%** | 0 | - | Inactive / Zero impressions. |
| **Sudoku_BonusReward_Rewarded** | Rewarded | 3 | 3 | 100% | **0.00%** | 0 | - | Zero impressions. |
| **Sudoku_Home_Banner** | Banner | 152 | 32 | 21.05% | **46.88%** | 15 | $0.20 | Low match, low show rate, low eCPM. |
| **Sudoku_Home_Native** | Native Advanced | 791 | 633 | 80.03% | 78.67% | 498 | $0.86 | Top earner ($0.43). Strong baseline. |
| **Sudoku_Completion_Interstitial** | Interstitial | 72 | 72 | 100% | 90.28% | 65 | $1.15 | Strong show rate & eCPM ($1.15). |
| **Sudoku_Abandon_Interstitial** | Interstitial | 71 | 71 | 100% | 83.10% | 59 | $1.25 | Reliable performer. |
| **Sudoku_NewGame_Interstitial** | Interstitial | 24 | 24 | 100% | 87.50% | 21 | **$1.88** | **Highest eCPM** ($1.88) - under-utilized. |
| **Sudoku_DailyChallenge_Rewarded** | Rewarded | 22 | 22 | 100% | 63.64% | 14 | $1.40 | Good eCPM ($1.40) - volume can grow. |

### Core Objectives
1. **Fix Show Rates**: Recover ~600+ wasted matched impressions from App Open and Rewarded units.
2. **Increase Screen Opportunities & Placements**: Introduce natural game loop screens (Results Screen, Level Selection, Pause Menu) to increase Impressions per Active User (Imps/AU) from 2.2 to 5.0+.
3. **Drive Rewarded Engagement**: Create high-value player incentives (Hints, Mistakes, Auto-Check, Theme Unlocks).

---

## 2. Low Show Rate: Technical Root Cause & Fixes

### A. App Open Ad (7.70% Show Rate)
* **Root Cause 1 - Cold Start Race Condition**: During splash/startup, the JavaScript layer calls `showAppOpenAd()` before the Google SDK completes loading the ad asset (average latency: 3.92s). Because `isAdAvailable()` is false, the app displays the home screen. When the ad finally finishes downloading, it is stored in memory and expires without showing.
* **Root Cause 2 - Overly Restrictive Resume Thresholds**:
  * Current `backgroundThresholdSeconds`: **180s** (3 minutes). Players switching away to read an SMS or WhatsApp for 30–60 seconds never trigger the ad on return.
  * Current `minIntervalSeconds`: **240s** (4 minutes) and `sessionCap`: **2**.
* **Technical Fix**:
  1. Add a brief hold during splash screen (up to 2.5s) to let cold-start App Open ad finish loading before rendering main UI.
  2. Adjust Remote Config / defaults:
     * `app_open_background_threshold_seconds`: Reduce from **180s -> 45s**.
     * `app_open_min_interval_seconds`: Reduce from **240s -> 120s**.
     * `app_open_session_cap`: Increase from **2 -> 4**.

### B. Rewarded Ads (4.55% Show Rate on Mistake Rescue, 0% on Hints)
* **Root Cause - On-Demand Loading Latency**: Currently, `prepareRewardVideoAd()` is only invoked *after* the player taps "Watch Ad" inside the modal. Rewarded ads have a 5.8-second load latency. When the player sees a spinner or loading overlay for 5+ seconds, they cancel, back out, or force quit before the ad opens.
* **Technical Fix - Proactive Preloading**:
  1. Trigger background preloading of rewarded ads when the player enters a puzzle.
  2. When the player taps "Rescue" or "Hint", the ad plays **instantly** (0ms latency), driving the show rate to **85%+**.
  3. Preload the next rewarded ad as soon as the current one is closed.

### C. Home Banner vs Native Conflict (46.88% Show Rate)
* **Root Cause**: `Sudoku_Home_Native` and `Sudoku_Home_Banner` compete for the same real estate on the Home screen.
* **Technical Fix**: Disable `home_banner_fallback_enabled` and standardize on Native Advanced Ads, which deliver 4x higher eCPM ($0.86 vs $0.20) and a higher show rate (78.7%).

---

## 3. Screen Expansion & New Ad Placements

To scale ad inventory naturally without annoying players or violating Google Play policies:

### Placement 1: Dedicated Victory / Results Screen (High Impact)
* **Current state**: Game completion displays a compact popup modal with basic stats.
* **New Design**: Transition to a full **Victory Screen** after completing a puzzle.
* **Ad Integration**:
  1. **Native Ad Card**: Positioned beneath player stats (Solve Time, Mistakes, Accuracy, Star Rating).
  2. **Rewarded CTA Button**: *"Double Your XP / Claim +2 Free Hints for Next Game"*.
  3. **Interstitial Ad**: Triggered cleanly upon tapping "Play Next" or "Home" (respecting cooldown).

### Placement 2: Mid-Game Pause Screen
* **Current state**: Pause modal dims the game grid with a few small buttons.
* **New Design**: Clean pause view with puzzle progress, resume, restart, and sound toggle.
* **Ad Integration**:
  * An embedded **Native Banner (300x100 or 320x50)** inside the pause card.

### Placement 3: Level / Category Selection Screen
* **Current state**: Quick play starts immediately with difficulty selected from home tab.
* **New Design**: A dedicated Level / Puzzle Pack browser (Classic, Speedrun, Daily Calendar, Master Challenges).
* **Ad Integration**:
  * An **Adaptive Banner** at the bottom or an inline **MREC Native Card** between puzzle categories.

### Placement 4: Game Over / Defeat Screen Redesign
* **Current state**: Basic Game Over modal.
* **New Design**: Dedicated screen offering:
  1. "Second Chance" (Watch Rewarded Video to revive puzzle).
  2. New Game button (shows interstitial, highest eCPM at $1.88).

---

## 4. High-Converting Rewarded Ad Mechanics

Sudoku players respond strongly to utility and progression rewards. We will introduce:

1. **Daily Streak / Daily Hint Chest**:
   * "Watch a short ad to claim today's 3 free hint tokens."
2. **Board Auto-Check / Mistake Highlighter**:
   * "Watch an ad to scan the board and highlight all conflicting numbers."
3. **Board Theme / Tile Style Unlock**:
   * Allow non-paying users to unlock premium color themes (e.g., Midnight OLED, Warm Wood, Cyberpunk) for 24 hours via a single rewarded video.

---

## 5. Implementation Roadmap

### Phase 1: Show Rate & Configuration Fixes (Immediate)
- [ ] Update `AppOpenAdPlugin.java` & `admob-config.js` default thresholds:
  - Background threshold: 45 seconds.
  - Interval: 120 seconds.
  - Session cap: 4.
- [ ] Implement proactive preloading for Rewarded Ads (`admob-service.js`):
  - Preload at game start.
  - Preload next ad on ad dismissal.
- [ ] Turn off redundant `home_banner_fallback_enabled` to eliminate low-performing requests.

### Phase 2: Dedicated Victory Screen (Highest Revenue Uplift)
- [x] Create full Victory Screen layout in `www/index.html` & `www/style.css` (Stitch Screen 6).
- [x] Embed Native Ad container into the Victory layout (`HOME_NATIVE`).
- [x] Wire completion routing to transition through the Victory Screen with 2x Bonus Rewarded trigger.

### Phase 3: Pause Screen & New Rewarded Mechanics
- [x] Upgrade Pause modal into an enhanced screen with native ad placement (`HOME_NATIVE`, bottom clearance 154px, zero button overlap).
- [x] Add "Auto-Check / Scan Mistakes" rewarded ad mechanic (highlights incorrect player entries, per-puzzle limit, zero rule violation).
- [x] Add 24-Hour Theme Unlock via Rewarded Ad (`BONUS_REWARDED`, Zen Wood & Cyber Neon themes, 24h expiration with auto-fallback).
- [x] Centralize Rewarded lifecycle architecture (`requestRewardedReward` with distinct reward and dismissal callbacks).
- [x] Add Remote Config controls for Phase 3 features (`pause_native_ad_enabled`, `auto_check_rewarded_enabled`, `auto_check_per_puzzle_limit`, `theme_rewarded_unlock_enabled`, `theme_unlock_duration_hours`).

---

## 6. Target KPIs & Expected Impact

| Metric | Current Baseline | Post-Optimization Target |
| :--- | :--- | :--- |
| **App Open Show Rate** | 7.70% | **> 70.0%** |
| **Rewarded Show Rate** | 4.55% | **> 85.0%** |
| **Imps / Active User (Imps/AU)** | 2.2 | **4.5 - 6.0** |
| **Daily Impressions** | ~990 | **2,200 - 3,000+** |
| **Projected Revenue Growth** | Baseline (~$0.84/day) | **$2.50 - $4.00+/day (3x - 5x boost)** |
