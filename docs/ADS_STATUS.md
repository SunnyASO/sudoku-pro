# Sudoku Pro Ads Status

## AdMob app

App ID:

```text
ca-app-pub-2070129323138107~6465647637
```

## Implemented ad units

| Placement | Ad unit name | Production Unit ID | Status |
|---|---|---|---|
| Home Banner | `Sudoku_Home_Banner` | `ca-app-pub-2070129323138107/9405681916` | Implemented; fallback when Home Native fails |
| Gameplay Banner | `Sudoku_Gameplay_Banner` | `ca-app-pub-2070129323138107/9349841592` | Implemented & Active; adaptive layout with 65px safe margin |
| Completion Interstitial | `Sudoku_Completion_Interstitial` | `ca-app-pub-2070129323138107/6126736289` | Implemented; cadence: every 1 completion, session cap 5, 90s cooldown |
| New Game Interstitial | `Sudoku_NewGame_Interstitial` | `ca-app-pub-2070129323138107/1233502251` | Implemented; on in-game new game (not on home start), 90s cooldown |
| Abandon Interstitial | `Sudoku_Abandon_Interstitial` | `ca-app-pub-2070129323138107/8364062982` | Implemented; on return to home, 90s cooldown |
| Hint Rewarded | `Sudoku_Hint_Rewarded` | `ca-app-pub-2070129323138107/4849313637` | Implemented; on extra hints (starts with 3 free hints) |
| Mistake Rescue Rewarded | `Sudoku_MistakeRescue_Rewarded` | `ca-app-pub-2070129323138107/9191883320` | Implemented; on 3 mistakes life revive |
| Daily Challenge Rewarded | `Sudoku_DailyChallenge_Rewarded` | `ca-app-pub-2070129323138107/4424817979` | Implemented; on daily challenge |
| Bonus Rewarded | `Sudoku_BonusReward_Rewarded` | `ca-app-pub-2070129323138107/6396375193` | Implemented; on victory bonus hint |
| Home Native | `Sudoku_Home_Native` | `ca-app-pub-2070129323138107/2374442509` | Implemented; bottom anchored |
| Achievements Native | `Sudoku_Achievements_Native` | `ca-app-pub-2070129323138107/9000311636` | Implemented; bottom anchored |
| Daily Challenge Native | `Sudoku_DailyChallenge_Native` | `ca-app-pub-2070129323138107/4698104549` | Implemented; bottom anchored |
| App Open | `Sudoku_AppOpen` | `ca-app-pub-2070129323138107/4657741942` | Implemented & Active; cold start (not 1st launch) & resume after 180s, min interval 240s, cap 2/session |

## Native ad IDs

```text
HOME_NATIVE:
ca-app-pub-2070129323138107/2374442509

ACHIEVEMENTS_NATIVE:
ca-app-pub-2070129323138107/9000311636

DAILY_CHALLENGE_NATIVE:
ca-app-pub-2070129323138107/4698104549

TEST_NATIVE:
ca-app-pub-3940256099942544/2247696110
```

## Important behavior

- Native ads are Android native overlays on top of the Capacitor WebView.
- Native ad height: `120dp`.
- Bottom margin: `16dp`.
- CSS bottom padding: about `160px`.
- Native ads must hide when:
  - Settings opens
  - Game starts
  - Remove Ads purchase starts
  - Full-screen modal opens
  - User becomes premium

## Verified native ad placement

Logcat confirmed bottom placement:

```text
Native ad y=2043.0 height=315
```

## Premium behavior

When `window.isPremium === true`:

- No banner ads.
- No native ads.
- No interstitial ads.
- Rewarded placements auto-grant the reward.
