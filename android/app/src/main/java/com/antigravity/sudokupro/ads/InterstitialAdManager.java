package com.antigravity.sudokupro.ads;

import android.app.Activity;
import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.interstitial.InterstitialAd;
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback;
import com.google.firebase.analytics.FirebaseAnalytics;

import java.lang.ref.WeakReference;
import java.util.EnumMap;
import java.util.Map;

/**
 * InterstitialAdManager — authoritative native interstitial advertising lifecycle manager for Sudoku Pro.
 * Modeled on World Clock's InterAdsManagerKt, InterAdPair, and InterDelayTimer patterns.
 *
 * Key guarantees:
 * 1. Placement ownership: distinct strongly typed internal placements (COMPLETION, NEW_GAME, ABANDON, GAME_OVER).
 * 2. Pre-network eligibility gating: cooldown, caps, premium, and fullscreen lock are checked BEFORE loading.
 * 3. Generation token protection against out-of-order responses.
 * 4. Shared fullscreen lock coordination with App Open and Rewarded formats.
 * 5. Authoritative SDK impression, paid-event, and dismissal telemetry.
 * 6. Non-blocking navigation safety: navigation proceeds immediately if no ad is available.
 */
public class InterstitialAdManager {

    private static final String TAG = "InterstitialAdManager";
    private static volatile InterstitialAdManager instance;

    // Google AdMob recommended cache validity for interstitial ads (1 hour = 60 * 60 * 1000 ms)
    public static final long INTERSTITIAL_CACHE_VALIDITY_MS = 60 * 60 * 1000L;
    public static final long CACHE_VALIDITY_MS = INTERSTITIAL_CACHE_VALIDITY_MS;

    // Google official test interstitial ad unit ID
    public static final String TEST_AD_UNIT_ID = "ca-app-pub-3940256099942544/1033173712";

    public interface PrepareCallback {
        void onResult(boolean prepared, String message);
    }

    public interface ShowCallback {
        void onResult(boolean shown, boolean dismissed, String reason);
    }

    private Context appContext;
    private WeakReference<Activity> currentActivityRef = new WeakReference<>(null);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private boolean isEnabled = true;
    private boolean isPremium = false;
    private boolean canRequestAds = false;
    private boolean isTestMode = false;
    private boolean isSharedFullScreenLocked = false;
    private boolean isPurchaseActive = false;

    private long loadGeneration = 0L;
    private InterstitialAdSlot currentSlot = null;

    // Production ad units per placement
    private final Map<InterstitialPlacement, String> adUnitMap = new EnumMap<>(InterstitialPlacement.class);
    // Placement-specific enabled flags matching Remote Config
    private final Map<InterstitialPlacement, Boolean> placementEnabledMap = new EnumMap<>(InterstitialPlacement.class);

    // Cooldown & Delay timer tracking (InterDelayTimer pattern)
    private long lastShowTimestampMs = 0L;
    private long cooldownDurationMs = 60 * 1000L; // default 60 seconds (matches fullscreen_ad_cooldown_seconds)

    // Session caps & counters
    private int completionSessionCap = 8;
    private int gameOverSessionCap = 8;
    private int completionShownCount = 0;
    private int gameOverShownCount = 0;

    private InterstitialAdManager() {
        // Initialize default production ad unit IDs matching admob-config.js
        adUnitMap.put(InterstitialPlacement.COMPLETION, "ca-app-pub-2070129323138107/6126736289");
        adUnitMap.put(InterstitialPlacement.NEW_GAME, "ca-app-pub-2070129323138107/1233502251");
        adUnitMap.put(InterstitialPlacement.ABANDON, "ca-app-pub-2070129323138107/8364062982");
        adUnitMap.put(InterstitialPlacement.GAME_OVER, "ca-app-pub-2070129323138107/8364062982");

        for (InterstitialPlacement p : InterstitialPlacement.values()) {
            placementEnabledMap.put(p, true);
        }
    }

    public static InterstitialAdManager getInstance() {
        if (instance == null) {
            synchronized (InterstitialAdManager.class) {
                if (instance == null) {
                    instance = new InterstitialAdManager();
                }
            }
        }
        return instance;
    }

    public void initialize(@NonNull Context context) {
        this.appContext = context.getApplicationContext();
        Log.d(TAG, "Initialized InterstitialAdManager with application context.");
    }

    public void updateCurrentActivity(@Nullable Activity activity) {
        if (activity != null) {
            this.currentActivityRef = new WeakReference<>(activity);
            if (this.appContext == null) {
                this.appContext = activity.getApplicationContext();
            }
        }
    }

    @Nullable
    public Activity getCurrentActivity() {
        return currentActivityRef.get();
    }

    public void configure(boolean enabled, boolean premium, boolean testMode) {
        this.isEnabled = enabled;
        this.isPremium = premium;
        this.isTestMode = testMode;
        Log.d(TAG, "configure: enabled=" + enabled + ", premium=" + premium + ", testMode=" + testMode);

        if (premium) {
            disposeCurrentSlot(InterstitialAdSlot.DisposalReason.PREMIUM);
        } else if (!enabled) {
            disposeCurrentSlot(InterstitialAdSlot.DisposalReason.REMOTE_CONFIG_DISABLED);
        }
    }

    public void configurePolicies(long cooldownSeconds, int completionCap, int gameOverCap) {
        if (cooldownSeconds > 0) {
            this.cooldownDurationMs = cooldownSeconds * 1000L;
        }
        if (completionCap > 0) {
            this.completionSessionCap = completionCap;
        }
        if (gameOverCap > 0) {
            this.gameOverSessionCap = gameOverCap;
        }
        Log.d(TAG, "configurePolicies: cooldownMs=" + cooldownDurationMs +
                ", completionCap=" + completionSessionCap + ", gameOverCap=" + gameOverSessionCap);
    }

    public void setAdUnitId(@NonNull InterstitialPlacement placement, @Nullable String adUnitId) {
        if (adUnitId != null && !adUnitId.trim().isEmpty()) {
            adUnitMap.put(placement, adUnitId.trim());
        }
    }

    public void setPremium(boolean premium) {
        this.isPremium = premium;
        Log.d(TAG, "setPremium: " + premium);
        if (premium) {
            disposeCurrentSlot(InterstitialAdSlot.DisposalReason.PREMIUM);
        }
    }

    public void setSharedFullScreenLocked(boolean locked) {
        this.isSharedFullScreenLocked = locked;
    }

    public void setPurchaseActive(boolean active) {
        this.isPurchaseActive = active;
        Log.d(TAG, "setPurchaseActive: " + active);
        if (active) {
            loadGeneration++;
            if (currentSlot != null && currentSlot.getState() != InterstitialAdSlot.State.SHOWING) {
                disposeCurrentSlot(InterstitialAdSlot.DisposalReason.BILLING_ACTIVE);
            }
        }
    }

    public void setCanRequestAds(boolean canRequest) {
        this.canRequestAds = canRequest;
        Log.d(TAG, "[Interstitial] setCanRequestAds: " + canRequest);
        if (!canRequest && currentSlot != null && currentSlot.getState() == InterstitialAdSlot.State.READY) {
            Log.i(TAG, "[Interstitial] Disposing ready slot due to revoked consent.");
            disposeCurrentSlot(InterstitialAdSlot.DisposalReason.CONSENT_REVOKED);
        }
    }

    public boolean canRequestAds() {
        return canRequestAds;
    }

    public void setPlacementEnabled(@NonNull InterstitialPlacement placement, boolean enabled) {
        placementEnabledMap.put(placement, enabled);
        Log.d(TAG, "setPlacementEnabled: " + placement + " = " + enabled);
        if (!enabled && currentSlot != null && currentSlot.getPlacement() == placement
                && currentSlot.getState() != InterstitialAdSlot.State.SHOWING) {
            disposeCurrentSlot(InterstitialAdSlot.DisposalReason.REMOTE_CONFIG_DISABLED);
        }
    }

    public boolean isPlacementEnabled(@NonNull InterstitialPlacement placement) {
        Boolean b = placementEnabledMap.get(placement);
        return b != null ? b : true;
    }

    @NonNull
    public String resolveAdUnitId(@NonNull InterstitialPlacement placement, @Nullable String unitOverride) {
        if (isTestMode) {
            return TEST_AD_UNIT_ID;
        }
        if (unitOverride != null && !unitOverride.trim().isEmpty()) {
            return unitOverride.trim();
        }
        String unit = adUnitMap.get(placement);
        return unit != null ? unit : TEST_AD_UNIT_ID;
    }

    // ═══════════════════════════════════════════════
    //  COOLDOWN & ELIGIBILITY (INTERDELAYTIMER PATTERN)
    // ═══════════════════════════════════════════════

    public boolean isDelaySpent() {
        if (lastShowTimestampMs <= 0) return true;
        return (System.currentTimeMillis() - lastShowTimestampMs) >= cooldownDurationMs;
    }

    public long getRemainingCooldownMs() {
        if (lastShowTimestampMs <= 0) return 0L;
        long elapsed = System.currentTimeMillis() - lastShowTimestampMs;
        return Math.max(0L, cooldownDurationMs - elapsed);
    }

    /**
     * Checks all eligibility conditions BEFORE initiating network requests.
     * Prevents wasted matched requests that could never become impressions.
     */
    public boolean isEligible(@NonNull InterstitialPlacement placement) {
        if (!canRequestAds) {
            Log.d(TAG, "[Interstitial] Ineligible (" + placement + "): consent not granted (canRequestAds=false).");
            return false;
        }
        if (!isEnabled) {
            Log.d(TAG, "[Interstitial] Ineligible (" + placement + "): disabled globally by config.");
            return false;
        }
        if (!isPlacementEnabled(placement)) {
            Log.d(TAG, "[Interstitial] Ineligible (" + placement + "): placement disabled by Remote Config.");
            return false;
        }
        if (isPremium) {
            Log.d(TAG, "[Interstitial] Ineligible (" + placement + "): user is premium.");
            return false;
        }
        if (isPurchaseActive) {
            Log.d(TAG, "[Interstitial] Ineligible (" + placement + "): billing purchase active.");
            return false;
        }
        if (isSharedFullScreenLocked) {
            Log.d(TAG, "[Interstitial] Ineligible (" + placement + "): shared fullscreen locked.");
            return false;
        }
        if (SudokuAppOpenManager.getInstance().getCurrentState() == SudokuAppOpenManager.AppOpenState.SHOWING) {
            Log.d(TAG, "[Interstitial] Ineligible (" + placement + "): App Open currently showing.");
            return false;
        }

        // Session Cap Checks
        if (placement == InterstitialPlacement.COMPLETION && completionShownCount >= completionSessionCap) {
            Log.d(TAG, "[Interstitial] Ineligible (COMPLETION): session cap reached (" +
                    completionShownCount + "/" + completionSessionCap + ").");
            return false;
        }
        if (placement == InterstitialPlacement.GAME_OVER && gameOverShownCount >= gameOverSessionCap) {
            Log.d(TAG, "[Interstitial] Ineligible (GAME_OVER): session cap reached (" +
                    gameOverShownCount + "/" + gameOverSessionCap + ").");
            return false;
        }

        // Fullscreen Cooldown Check
        if (!isDelaySpent()) {
            Log.d(TAG, "[Interstitial] Ineligible (" + placement + "): cooldown active (" +
                    getRemainingCooldownMs() + "ms remaining).");
            return false;
        }

        return true;
    }

    // ═══════════════════════════════════════════════
    //  READINESS & PLACEMENT MATCHING
    // ═══════════════════════════════════════════════

    public boolean isReady(@NonNull InterstitialPlacement placement) {
        if (!isEligible(placement)) {
            return false;
        }
        if (currentSlot == null) {
            return false;
        }
        if (currentSlot.getPlacement() != placement) {
            return false;
        }
        if (currentSlot.isExpired(CACHE_VALIDITY_MS)) {
            Log.i(TAG, "[Interstitial] Cached ad expired for placement: " + placement);
            disposeCurrentSlot(InterstitialAdSlot.DisposalReason.CACHE_EXPIRED);
            return false;
        }
        return currentSlot.isLoaded();
    }

    @Nullable
    public InterstitialPlacement getCurrentSlotPlacement() {
        return currentSlot != null ? currentSlot.getPlacement() : null;
    }

    // ═══════════════════════════════════════════════
    //  PREPARATION (INTENT-PROXIMATE PRELOAD)
    // ═══════════════════════════════════════════════

    public void prepareInterstitial(@NonNull final InterstitialPlacement placement,
                                    @Nullable final String adUnitIdOverride,
                                    @Nullable final PrepareCallback callback) {
        try {
            // STEP 0: Check eligibility BEFORE requesting ad
            if (!isEligible(placement)) {
                Log.d(TAG, "[Interstitial] prepare skipped: ineligible for " + placement);
                if (callback != null) callback.onResult(false, "ineligible");
                return;
            }

            // If we already have a ready, unexpired ad for THIS EXACT placement, reuse it!
            if (isReady(placement)) {
                Log.d(TAG, "[Interstitial] prepare skipped: already READY for placement " + placement);
                if (callback != null) callback.onResult(true, "already_ready");
                return;
            }

            // If an ad is currently loading for THIS placement, do not duplicate
            if (currentSlot != null && currentSlot.getPlacement() == placement
                    && currentSlot.getState() == InterstitialAdSlot.State.LOADING) {
                Log.d(TAG, "[Interstitial] prepare skipped: already LOADING for placement " + placement);
                if (callback != null) callback.onResult(false, "already_loading");
                return;
            }

            // If a slot exists for a DIFFERENT placement, displace it
            if (currentSlot != null) {
                Log.i(TAG, "[Interstitial] Displacing previous slot (" + currentSlot.getPlacement() +
                        ") for new placement request: " + placement);
                disposeCurrentSlot(InterstitialAdSlot.DisposalReason.PLACEMENT_REPLACED);
            }

            final Context ctx = appContext != null ? appContext :
                    (getCurrentActivity() != null ? getCurrentActivity().getApplicationContext() : null);
            if (ctx == null) {
                Log.w(TAG, "[Interstitial] Cannot load ad: context is null.");
                if (callback != null) callback.onResult(false, "null_context");
                return;
            }

            final String resolvedUnitId = resolveAdUnitId(placement, adUnitIdOverride);
            final long generation = ++loadGeneration;
            final InterstitialAdSlot newSlot = new InterstitialAdSlot(placement, resolvedUnitId, generation);
            this.currentSlot = newSlot;

            // Analytics: opportunity & request
            Bundle oppBundle = new Bundle();
            oppBundle.putString("placement", placement.getKey());
            logAnalytics("interstitial_opportunity", oppBundle);

            Bundle reqBundle = new Bundle();
            reqBundle.putString("placement", placement.getKey());
            reqBundle.putBoolean("test_mode", isTestMode || isTestAdUnit(resolvedUnitId));
            logAnalytics("interstitial_requested", reqBundle);

            Log.d(TAG, "[Interstitial] Requesting ad: placement=" + placement +
                    ", gen=" + generation + ", unit=" + resolvedUnitId);

            mainHandler.post(() -> {
                try {
                    AdRequest adRequest = new AdRequest.Builder().build();
                    InterstitialAd.load(
                            ctx,
                            resolvedUnitId,
                            adRequest,
                            new InterstitialAdLoadCallback() {
                                @Override
                                public void onAdLoaded(@NonNull InterstitialAd loadedAd) {
                                    if (generation != loadGeneration || currentSlot != newSlot) {
                                        Log.w(TAG, "[Interstitial] Stale generation onAdLoaded (" + generation +
                                                " != " + loadGeneration + "). Discarding.");
                                        disposeAdObject(loadedAd, placement, InterstitialAdSlot.DisposalReason.STALE_GENERATION, 0);
                                        return;
                                    }

                                    if (!canRequestAds) {
                                        Log.i(TAG, "[Interstitial] Consent revoked during load. Discarding.");
                                        disposeAdObject(loadedAd, placement, InterstitialAdSlot.DisposalReason.CONSENT_REVOKED, 0);
                                        currentSlot = null;
                                        if (callback != null) callback.onResult(false, "consent_revoked");
                                        return;
                                    }

                                    if (isPremium) {
                                        Log.i(TAG, "[Interstitial] User became premium during load. Discarding.");
                                        disposeAdObject(loadedAd, placement, InterstitialAdSlot.DisposalReason.PREMIUM, 0);
                                        currentSlot = null;
                                        if (callback != null) callback.onResult(false, "premium");
                                        return;
                                    }

                                    if (isPurchaseActive) {
                                        Log.i(TAG, "[Interstitial] Billing purchase active onAdLoaded. Discarding.");
                                        disposeAdObject(loadedAd, placement, InterstitialAdSlot.DisposalReason.BILLING_ACTIVE, 0);
                                        currentSlot = null;
                                        if (callback != null) callback.onResult(false, "billing_active");
                                        return;
                                    }

                                    if (!isEnabled || !isPlacementEnabled(placement)) {
                                        Log.i(TAG, "[Interstitial] Ads or placement disabled during load. Discarding.");
                                        disposeAdObject(loadedAd, placement, InterstitialAdSlot.DisposalReason.REMOTE_CONFIG_DISABLED, 0);
                                        currentSlot = null;
                                        if (callback != null) callback.onResult(false, "disabled");
                                        return;
                                    }

                                    newSlot.setInterstitialAd(loadedAd);
                                    long durationMs = System.currentTimeMillis() - newSlot.getLoadStartTimestampMs();

                                    Log.d(TAG, "[Interstitial] onAdLoaded success (placement=" + placement +
                                            ", duration=" + durationMs + "ms)");

                                    Bundle loadBundle = new Bundle();
                                    loadBundle.putString("placement", placement.getKey());
                                    loadBundle.putLong("load_duration_ms", durationMs);
                                    logAnalytics("interstitial_loaded", loadBundle);

                                    if (callback != null) callback.onResult(true, "loaded");
                                }

                                @Override
                                public void onAdFailedToLoad(@NonNull LoadAdError loadAdError) {
                                    if (generation != loadGeneration || currentSlot != newSlot) {
                                        return;
                                    }

                                    newSlot.setState(InterstitialAdSlot.State.FAILED);
                                    currentSlot = null;

                                    Log.e(TAG, "[Interstitial] onAdFailedToLoad (placement=" + placement +
                                            "): " + loadAdError.getMessage() + " (Code: " + loadAdError.getCode() + ")");

                                    Bundle failBundle = new Bundle();
                                    failBundle.putString("placement", placement.getKey());
                                    failBundle.putInt("error_code", loadAdError.getCode());
                                    failBundle.putString("normalized_reason", normalizeErrorCode(loadAdError.getCode()));
                                    logAnalytics("interstitial_load_failed", failBundle);

                                    if (callback != null) callback.onResult(false, "load_failed: " + loadAdError.getMessage());
                                }
                            }
                    );
                } catch (Exception e) {
                    if (currentSlot == newSlot) currentSlot = null;
                    Log.e(TAG, "[Interstitial] Exception invoking InterstitialAd.load", e);
                    if (callback != null) callback.onResult(false, "exception: " + e.getMessage());
                }
            });

        } catch (Exception e) {
            Log.e(TAG, "[Interstitial] Exception in prepareInterstitial", e);
            if (callback != null) callback.onResult(false, "exception: " + e.getMessage());
        }
    }

    // ═══════════════════════════════════════════════
    //  SHOWING & EXACT PRESENTATION SEMANTICS
    // ═══════════════════════════════════════════════

    public boolean showInterstitial(@NonNull final InterstitialPlacement placement,
                                    @Nullable final Activity activity,
                                    @Nullable final ShowCallback callback) {
        final Activity act = activity != null ? activity : getCurrentActivity();
        if (act == null || act.isFinishing() || act.isDestroyed()) {
            Log.w(TAG, "[Interstitial] show skipped: Activity is invalid or finishing.");
            if (callback != null) callback.onResult(false, false, "invalid_activity");
            return false;
        }

        if (!isEligible(placement)) {
            if (callback != null) callback.onResult(false, false, "ineligible");
            return false;
        }

        // Placement matching check
        if (currentSlot == null || currentSlot.getPlacement() != placement) {
            String cachedPl = currentSlot != null ? currentSlot.getPlacement().name() : "none";
            Log.w(TAG, "[Interstitial] show skipped: placement mismatch! Requested=" + placement + ", Cached=" + cachedPl);
            if (callback != null) callback.onResult(false, false, "placement_mismatch");
            return false;
        }

        // Cache expiration check
        if (currentSlot.isExpired(CACHE_VALIDITY_MS)) {
            Log.w(TAG, "[Interstitial] show skipped: cached ad expired for placement: " + placement);
            disposeCurrentSlot(InterstitialAdSlot.DisposalReason.CACHE_EXPIRED);
            if (callback != null) callback.onResult(false, false, "cache_expired");
            return false;
        }

        if (!isReady(placement)) {
            Log.w(TAG, "[Interstitial] show skipped: ad not ready for placement " + placement);
            if (callback != null) callback.onResult(false, false, "not_ready");
            return false;
        }

        final InterstitialAd adToShow = currentSlot.getInterstitialAd();
        if (adToShow == null) {
            if (callback != null) callback.onResult(false, false, "ad_null");
            return false;
        }

        final InterstitialAdSlot activeSlot = currentSlot;
        activeSlot.setState(InterstitialAdSlot.State.SHOWING);

        // Acquire shared fullscreen lock
        SudokuAppOpenManager.getInstance().setSharedFullScreenLocked(true);
        this.isSharedFullScreenLocked = true;

        Bundle showAttemptBundle = new Bundle();
        showAttemptBundle.putString("placement", placement.getKey());
        logAnalytics("interstitial_show_attempt", showAttemptBundle);

        Log.d(TAG, "[Interstitial] Presenting Interstitial ad for placement: " + placement);

        mainHandler.post(() -> {
            try {
                adToShow.setFullScreenContentCallback(new FullScreenContentCallback() {
                    @Override
                    public void onAdShowedFullScreenContent() {
                        Log.d(TAG, "[Interstitial] onAdShowedFullScreenContent confirmed (placement=" + placement + ")");

                        // EXACT SEMANTICS: only advance cooldown & session counters on genuine show!
                        lastShowTimestampMs = System.currentTimeMillis();
                        if (placement == InterstitialPlacement.COMPLETION) {
                            completionShownCount++;
                        } else if (placement == InterstitialPlacement.GAME_OVER) {
                            gameOverShownCount++;
                        }

                        Bundle shownBundle = new Bundle();
                        shownBundle.putString("placement", placement.getKey());
                        logAnalytics("interstitial_shown", shownBundle);
                    }

                    @Override
                    public void onAdImpression() {
                        Log.i(TAG, "[Interstitial] onAdImpression confirmed by SDK (placement=" + placement + ")");
                        Bundle impBundle = new Bundle();
                        impBundle.putString("placement", placement.getKey());
                        logAnalytics("interstitial_impression", impBundle);
                    }

                    @Override
                    public void onAdDismissedFullScreenContent() {
                        Log.d(TAG, "[Interstitial] onAdDismissedFullScreenContent (placement=" + placement + ")");
                        adToShow.setFullScreenContentCallback(null);
                        adToShow.setOnPaidEventListener(null);

                        // Release shared fullscreen lock
                        SudokuAppOpenManager.getInstance().setSharedFullScreenLocked(false);
                        isSharedFullScreenLocked = false;

                        activeSlot.setState(InterstitialAdSlot.State.CONSUMED);
                        if (currentSlot == activeSlot) {
                            currentSlot = null;
                        }

                        Bundle disBundle = new Bundle();
                        disBundle.putString("placement", placement.getKey());
                        logAnalytics("interstitial_dismissed", disBundle);

                        if (callback != null) {
                            callback.onResult(true, true, "dismissed");
                        }
                    }

                    @Override
                    public void onAdFailedToShowFullScreenContent(@NonNull AdError adError) {
                        Log.e(TAG, "[Interstitial] onAdFailedToShowFullScreenContent: " + adError.getMessage());
                        adToShow.setFullScreenContentCallback(null);
                        adToShow.setOnPaidEventListener(null);

                        // Release shared fullscreen lock
                        SudokuAppOpenManager.getInstance().setSharedFullScreenLocked(false);
                        isSharedFullScreenLocked = false;

                        activeSlot.setState(InterstitialAdSlot.State.FAILED);
                        if (currentSlot == activeSlot) {
                            currentSlot = null;
                        }

                        Bundle disBundle = new Bundle();
                        disBundle.putString("placement", placement.getKey());
                        disBundle.putString("disposal_reason", "show_failed");
                        disBundle.putLong("cache_age_ms", activeSlot.getCacheAgeMs());
                        logAnalytics("interstitial_inventory_disposed", disBundle);

                        if (callback != null) {
                            callback.onResult(false, false, "show_failed: " + adError.getMessage());
                        }
                    }
                });

                // Paid Event Tracking
                adToShow.setOnPaidEventListener(adValue -> {
                    try {
                        long valueMicros = adValue.getValueMicros();
                        String currency = adValue.getCurrencyCode();
                        int precision = adValue.getPrecisionType();

                        Log.i(TAG, "[Interstitial] onPaidEvent (" + placement + "): " + valueMicros + " " + currency);

                        Bundle paidBundle = new Bundle();
                        paidBundle.putString("placement", placement.getKey());
                        paidBundle.putLong("value_micros", valueMicros);
                        paidBundle.putString("currency", currency != null ? currency : "USD");
                        paidBundle.putInt("precision", precision);
                        logAnalytics("interstitial_paid", paidBundle);
                    } catch (Exception e) {
                        Log.w(TAG, "Error logging interstitial paid event", e);
                    }
                });

                adToShow.show(act);

            } catch (Exception e) {
                // Ensure fullscreen lock is released on unexpected exception
                SudokuAppOpenManager.getInstance().setSharedFullScreenLocked(false);
                isSharedFullScreenLocked = false;
                if (currentSlot == activeSlot) {
                    currentSlot = null;
                }

                Log.e(TAG, "[Interstitial] Exception presenting interstitial on UI thread", e);
                if (callback != null) {
                    callback.onResult(false, false, "exception: " + e.getMessage());
                }
            }
        });

        return true;
    }

    // ═══════════════════════════════════════════════
    //  DISPOSAL & INVENTORY CLEANUP
    // ═══════════════════════════════════════════════

    public void disposeCurrentSlot(@NonNull InterstitialAdSlot.DisposalReason reason) {
        if (currentSlot != null) {
            InterstitialPlacement placement = currentSlot.getPlacement();
            long cacheAgeMs = currentSlot.getCacheAgeMs();

            currentSlot.dispose(reason);
            currentSlot = null;

            Bundle bundle = new Bundle();
            bundle.putString("placement", placement.getKey());
            bundle.putString("disposal_reason", reason.name().toLowerCase());
            bundle.putLong("cache_age_ms", cacheAgeMs);
            logAnalytics("interstitial_inventory_disposed", bundle);
        }
    }

    private void disposeAdObject(@NonNull InterstitialAd ad,
                                 @NonNull InterstitialPlacement placement,
                                 @NonNull InterstitialAdSlot.DisposalReason reason,
                                 long cacheAgeMs) {
        try {
            ad.setFullScreenContentCallback(null);
            ad.setOnPaidEventListener(null);
        } catch (Exception ignored) {}

        Bundle bundle = new Bundle();
        bundle.putString("placement", placement.getKey());
        bundle.putString("disposal_reason", reason.name().toLowerCase());
        bundle.putLong("cache_age_ms", cacheAgeMs);
        logAnalytics("interstitial_inventory_disposed", bundle);
    }

    // ═══════════════════════════════════════════════
    //  ANALYTICS & HELPERS
    // ═══════════════════════════════════════════════

    private void logAnalytics(String eventName, Bundle params) {
        try {
            if (appContext != null) {
                FirebaseAnalytics analytics = FirebaseAnalytics.getInstance(appContext);
                if (analytics != null) {
                    analytics.logEvent(eventName, params);
                }
            }
            Log.d(TAG, "[Analytics] " + eventName + ": " + (params != null ? params.toString() : "{}"));
        } catch (Exception e) {
            Log.w(TAG, "Failed logging interstitial analytics: " + eventName, e);
        }
    }

    private String normalizeErrorCode(int errorCode) {
        switch (errorCode) {
            case 0: return "internal_error";
            case 1: return "invalid_request";
            case 2: return "network_error";
            case 3: return "no_fill";
            default: return "unknown_code_" + errorCode;
        }
    }

    private boolean isTestAdUnit(String unit) {
        return unit != null && unit.contains("3940256099942544");
    }
}
