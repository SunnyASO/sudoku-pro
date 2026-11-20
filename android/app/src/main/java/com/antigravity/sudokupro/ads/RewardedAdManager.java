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
import com.google.android.gms.ads.OnUserEarnedRewardListener;
import com.google.android.gms.ads.rewarded.RewardItem;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;
import com.google.firebase.analytics.FirebaseAnalytics;

import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Native Rewarded Ad Manager modeled on World Clock's placement-aware architecture.
 *
 * Guarantees:
 * 1. Strict placement identity matching (requested placement == cached placement).
 * 2. Intent-proximate preloading (no blind startup preloading).
 * 3. Exactly-once reward granting via atomic synchronization.
 * 4. Stale generation token protection against out-of-order network responses.
 * 5. Fullscreen lock coordination with App Open and other fullscreen surfaces.
 * 6. Explicit cache TTL tracking and disposal telemetry.
 */
public class RewardedAdManager {

    private static final String TAG = "RewardedAdManager";
    private static volatile RewardedAdManager instance;

    // Google AdMob recommended cache validity for rewarded ads (1 hour = 60 * 60 * 1000 ms)
    public static final long REWARDED_CACHE_VALIDITY_MS = 60 * 60 * 1000L;
    public static final long CACHE_VALIDITY_MS = REWARDED_CACHE_VALIDITY_MS;

    // Google official test rewarded ad unit ID
    public static final String TEST_AD_UNIT_ID = "ca-app-pub-3940256099942544/5224354917";

    public interface PrepareCallback {
        void onResult(boolean prepared, String message);
    }

    public interface ShowCallback {
        void onResult(boolean shown, boolean rewardEarned, String rewardType, int rewardAmount, String reason);
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
    private RewardedAdSlot currentSlot = null;

    // Production ad unit defaults per placement
    private final Map<RewardedPlacement, String> adUnitMap = new HashMap<>();

    private RewardedAdManager() {
        // Initialize default production ad unit IDs matching admob-config.js
        adUnitMap.put(RewardedPlacement.HINT, "ca-app-pub-2070129323138107/4849313637");
        adUnitMap.put(RewardedPlacement.MISTAKE_RESCUE, "ca-app-pub-2070129323138107/9191883320");
        adUnitMap.put(RewardedPlacement.DAILY_CHALLENGE, "ca-app-pub-2070129323138107/4424817979");
        adUnitMap.put(RewardedPlacement.VICTORY_BONUS, "ca-app-pub-2070129323138107/6396375193");
        adUnitMap.put(RewardedPlacement.THEME_UNLOCK, "ca-app-pub-2070129323138107/6396375193");
        adUnitMap.put(RewardedPlacement.AUTO_CHECK, "ca-app-pub-2070129323138107/4849313637");
    }

    public static RewardedAdManager getInstance() {
        if (instance == null) {
            synchronized (RewardedAdManager.class) {
                if (instance == null) {
                    instance = new RewardedAdManager();
                }
            }
        }
        return instance;
    }

    public void initialize(@NonNull Context context) {
        this.appContext = context.getApplicationContext();
        Log.d(TAG, "RewardedAdManager initialized.");
    }

    public void updateCurrentActivity(@Nullable Activity activity) {
        if (activity != null) {
            this.currentActivityRef = new WeakReference<>(activity);
        }
    }

    @Nullable
    public Activity getCurrentActivity() {
        Activity act = currentActivityRef.get();
        if (act != null && !act.isFinishing() && !act.isDestroyed()) {
            return act;
        }
        return null;
    }

    public void configure(boolean enabled, boolean premium, boolean testMode) {
        this.isEnabled = enabled;
        this.isPremium = premium;
        this.isTestMode = testMode;

        Log.d(TAG, "Configured: enabled=" + isEnabled + ", isPremium=" + isPremium + ", testMode=" + isTestMode);

        if (isPremium) {
            disposeCurrentSlot(RewardedAdSlot.DisposalReason.PREMIUM);
        } else if (!isEnabled) {
            disposeCurrentSlot(RewardedAdSlot.DisposalReason.REMOTE_CONFIG_DISABLED);
        }
    }

    public void setAdUnitId(@NonNull RewardedPlacement placement, @NonNull String adUnitId) {
        if (adUnitId != null && !adUnitId.isEmpty()) {
            adUnitMap.put(placement, adUnitId);
        }
    }

    public void setPremium(boolean premium) {
        this.isPremium = premium;
        Log.d(TAG, "setPremium: " + premium);
        if (premium) {
            disposeCurrentSlot(RewardedAdSlot.DisposalReason.PREMIUM);
        }
    }

    public void setSharedFullScreenLocked(boolean locked) {
        this.isSharedFullScreenLocked = locked;
    }

    public void setPurchaseActive(boolean active) {
        this.isPurchaseActive = active;
        if (active) {
            disposeCurrentSlot(RewardedAdSlot.DisposalReason.BILLING_ACTIVE);
        }
    }

    public void setCanRequestAds(boolean canRequest) {
        this.canRequestAds = canRequest;
        Log.d(TAG, "[Rewarded] setCanRequestAds: " + canRequest);
        if (!canRequest && currentSlot != null && currentSlot.getState() == RewardedAdSlot.State.READY) {
            Log.i(TAG, "[Rewarded] Disposing ready slot due to revoked consent.");
            disposeCurrentSlot(RewardedAdSlot.DisposalReason.CONSENT_REVOKED);
        }
    }

    public boolean canRequestAds() {
        return canRequestAds;
    }

    @NonNull
    public String resolveAdUnitId(@NonNull RewardedPlacement placement, @Nullable String unitOverride) {
        if (isTestMode) {
            return TEST_AD_UNIT_ID;
        }
        if (unitOverride != null && !unitOverride.isEmpty()) {
            return unitOverride;
        }
        String unit = adUnitMap.get(placement);
        return unit != null ? unit : TEST_AD_UNIT_ID;
    }

    // ═══════════════════════════════════════════════
    //  READINESS & PLACEMENT MATCHING
    // ═══════════════════════════════════════════════

    public boolean isReady(@NonNull RewardedPlacement placement) {
        if (!isEnabled || isPremium || !canRequestAds) {
            return false;
        }
        if (currentSlot == null) {
            return false;
        }

        // Strict placement identity rule: requested placement MUST match cached placement
        if (currentSlot.getPlacement() != placement) {
            return false;
        }

        if (currentSlot.isExpired(CACHE_VALIDITY_MS)) {
            Log.i(TAG, "[Rewarded] Cached ad expired for placement: " + placement);
            disposeCurrentSlot(RewardedAdSlot.DisposalReason.CACHE_EXPIRED);
            return false;
        }

        return currentSlot.isLoaded();
    }

    @Nullable
    public RewardedPlacement getCurrentSlotPlacement() {
        return currentSlot != null ? currentSlot.getPlacement() : null;
    }

    // ═══════════════════════════════════════════════
    //  PREPARATION (INTENT-PROXIMATE PRELOAD)
    // ═══════════════════════════════════════════════

    public void prepareRewarded(@NonNull final RewardedPlacement placement,
                                @Nullable final String adUnitIdOverride,
                                @Nullable final PrepareCallback callback) {
        try {
            if (!canRequestAds) {
                Log.d(TAG, "[Rewarded] prepare skipped: consent not granted (canRequestAds=false) for " + placement);
                if (callback != null) callback.onResult(false, "consent_blocked");
                return;
            }

            if (!isEnabled) {
                Log.d(TAG, "[Rewarded] prepare skipped: disabled by config for " + placement);
                if (callback != null) callback.onResult(false, "disabled");
                return;
            }

            if (isPremium) {
                Log.d(TAG, "[Rewarded] prepare skipped: user is premium for " + placement);
                if (callback != null) callback.onResult(false, "premium");
                return;
            }

            // If we already have a ready, unexpired ad for THIS EXACT placement, reuse it!
            if (isReady(placement)) {
                Log.d(TAG, "[Rewarded] prepare skipped: already READY for placement " + placement);
                if (callback != null) callback.onResult(true, "already_ready");
                return;
            }

            // If an ad is currently loading for THIS placement, do not duplicate
            if (currentSlot != null && currentSlot.getPlacement() == placement
                    && currentSlot.getState() == RewardedAdSlot.State.LOADING) {
                Log.d(TAG, "[Rewarded] prepare skipped: already LOADING for placement " + placement);
                if (callback != null) callback.onResult(false, "already_loading");
                return;
            }

            // If a slot exists for a DIFFERENT placement, dispose it first to enforce 1-slot hygiene
            if (currentSlot != null) {
                Log.i(TAG, "[Rewarded] Displacing previous slot (" + currentSlot.getPlacement() +
                        ") for new placement request: " + placement);
                disposeCurrentSlot(RewardedAdSlot.DisposalReason.PLACEMENT_REPLACED);
            }

            final Context ctx = appContext != null ? appContext :
                    (getCurrentActivity() != null ? getCurrentActivity().getApplicationContext() : null);
            if (ctx == null) {
                Log.w(TAG, "[Rewarded] Cannot load ad: context is null.");
                if (callback != null) callback.onResult(false, "null_context");
                return;
            }

            final String resolvedUnitId = resolveAdUnitId(placement, adUnitIdOverride);
            final long generation = ++loadGeneration;
            final RewardedAdSlot newSlot = new RewardedAdSlot(placement, resolvedUnitId, generation);
            this.currentSlot = newSlot;

            // Log opportunity and request analytics
            Bundle oppBundle = new Bundle();
            oppBundle.putString("placement", placement.getKey());
            logAnalytics("rewarded_opportunity", oppBundle);

            Bundle reqBundle = new Bundle();
            reqBundle.putString("placement", placement.getKey());
            reqBundle.putBoolean("test_mode", isTestMode || isTestAdUnit(resolvedUnitId));
            logAnalytics("rewarded_requested", reqBundle);

            Log.d(TAG, "[Rewarded] Requesting ad (gen=" + generation + ", placement=" + placement +
                    ", unit=" + resolvedUnitId + ")");

            mainHandler.post(() -> {
                try {
                    AdRequest adRequest = new AdRequest.Builder().build();
                    RewardedAd.load(
                            ctx,
                            resolvedUnitId,
                            adRequest,
                            new RewardedAdLoadCallback() {
                                @Override
                                public void onAdLoaded(@NonNull RewardedAd loadedAd) {
                                    if (generation != loadGeneration || currentSlot != newSlot) {
                                        Log.w(TAG, "[Rewarded] Stale generation onAdLoaded (" + generation +
                                                " != " + loadGeneration + "). Discarding.");
                                        disposeAdObject(loadedAd, placement, RewardedAdSlot.DisposalReason.STALE_GENERATION, 0);
                                        return;
                                    }

                                    if (isPremium) {
                                        Log.i(TAG, "[Rewarded] User became premium during load. Discarding.");
                                        disposeAdObject(loadedAd, placement, RewardedAdSlot.DisposalReason.PREMIUM, 0);
                                        currentSlot = null;
                                        if (callback != null) callback.onResult(false, "premium");
                                        return;
                                    }

                                    if (!isEnabled) {
                                        Log.i(TAG, "[Rewarded] Ads disabled during load. Discarding.");
                                        disposeAdObject(loadedAd, placement, RewardedAdSlot.DisposalReason.REMOTE_CONFIG_DISABLED, 0);
                                        currentSlot = null;
                                        if (callback != null) callback.onResult(false, "disabled");
                                        return;
                                    }

                                    newSlot.setRewardedAd(loadedAd);
                                    long durationMs = System.currentTimeMillis() - newSlot.getLoadStartTimestampMs();

                                    Log.d(TAG, "[Rewarded] onAdLoaded success (placement=" + placement +
                                            ", duration=" + durationMs + "ms)");

                                    Bundle loadBundle = new Bundle();
                                    loadBundle.putString("placement", placement.getKey());
                                    loadBundle.putLong("load_duration_ms", durationMs);
                                    logAnalytics("rewarded_loaded", loadBundle);

                                    if (callback != null) callback.onResult(true, "loaded");
                                }

                                @Override
                                public void onAdFailedToLoad(@NonNull LoadAdError loadAdError) {
                                    if (generation != loadGeneration || currentSlot != newSlot) {
                                        return;
                                    }

                                    newSlot.setState(RewardedAdSlot.State.FAILED);
                                    currentSlot = null;

                                    Log.e(TAG, "[Rewarded] onAdFailedToLoad (placement=" + placement +
                                            "): " + loadAdError.getMessage() + " (Code: " + loadAdError.getCode() + ")");

                                    Bundle failBundle = new Bundle();
                                    failBundle.putString("placement", placement.getKey());
                                    failBundle.putInt("error_code", loadAdError.getCode());
                                    failBundle.putString("normalized_reason", normalizeErrorCode(loadAdError.getCode()));
                                    logAnalytics("rewarded_load_failed", failBundle);

                                    if (callback != null) callback.onResult(false, "load_failed: " + loadAdError.getMessage());
                                }
                            }
                    );
                } catch (Exception e) {
                    if (currentSlot == newSlot) currentSlot = null;
                    Log.e(TAG, "[Rewarded] Exception invoking RewardedAd.load", e);
                    if (callback != null) callback.onResult(false, "exception: " + e.getMessage());
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "[Rewarded] Exception in prepareRewarded", e);
            if (callback != null) callback.onResult(false, "exception: " + e.getMessage());
        }
    }

    // ═══════════════════════════════════════════════
    //  SHOWING & EXACTLY-ONCE REWARD GUARANTEE
    // ═══════════════════════════════════════════════

    public boolean showRewarded(@NonNull final RewardedPlacement placement,
                                @Nullable final Activity activity,
                                @Nullable final ShowCallback callback) {
        final Activity act = activity != null ? activity : getCurrentActivity();
        if (act == null || act.isFinishing() || act.isDestroyed()) {
            Log.w(TAG, "[Rewarded] show skipped: Activity is invalid or finishing.");
            if (callback != null) callback.onResult(false, false, "", 0, "invalid_activity");
            return false;
        }

        if (!isEnabled) {
            if (callback != null) callback.onResult(false, false, "", 0, "disabled");
            return false;
        }

        if (isPremium) {
            // Auto-grant for premium without showing ad
            if (callback != null) callback.onResult(true, true, "premium_grant", 1, "premium_auto_grant");
            return true;
        }

        if (!canRequestAds) {
            Log.w(TAG, "[Rewarded] show skipped: consent not granted (canRequestAds=false).");
            if (callback != null) callback.onResult(false, false, "", 0, "consent_blocked");
            return false;
        }

        if (isPurchaseActive) {
            Log.w(TAG, "[Rewarded] show skipped: billing purchase sheet active.");
            if (callback != null) callback.onResult(false, false, "", 0, "billing_active");
            return false;
        }

        // Shared fullscreen lock coordination
        if (isSharedFullScreenLocked) {
            Log.w(TAG, "[Rewarded] show skipped: fullscreen lock active.");
            if (callback != null) callback.onResult(false, false, "", 0, "fullscreen_busy");
            return false;
        }

        // Coordinate with App Open manager: do not present if App Open is currently showing
        if (SudokuAppOpenManager.getInstance().getCurrentState() == SudokuAppOpenManager.AppOpenState.SHOWING) {
            Log.w(TAG, "[Rewarded] show skipped: App Open is currently showing.");
            if (callback != null) callback.onResult(false, false, "", 0, "app_open_showing");
            return false;
        }

        // Strict placement matching check
        if (currentSlot == null || currentSlot.getPlacement() != placement) {
            String cachedPl = currentSlot != null ? currentSlot.getPlacement().name() : "none";
            Log.w(TAG, "[Rewarded] show skipped: placement mismatch! Requested=" + placement + ", Cached=" + cachedPl);
            if (callback != null) callback.onResult(false, false, "", 0, "placement_mismatch");
            return false;
        }

        // Cache expiration verification: strictly reject inventory >= 1 hour old
        if (currentSlot.isExpired(CACHE_VALIDITY_MS)) {
            Log.w(TAG, "[Rewarded] show skipped: cached ad expired for placement: " + placement);
            disposeCurrentSlot(RewardedAdSlot.DisposalReason.CACHE_EXPIRED);
            if (callback != null) callback.onResult(false, false, "", 0, "cache_expired");
            return false;
        }

        if (!isReady(placement)) {
            Log.w(TAG, "[Rewarded] show skipped: ad not ready for placement " + placement);
            if (callback != null) callback.onResult(false, false, "", 0, "not_ready");
            return false;
        }

        final RewardedAd adToShow = currentSlot.getRewardedAd();
        if (adToShow == null) {
            if (callback != null) callback.onResult(false, false, "", 0, "ad_null");
            return false;
        }

        final RewardedAdSlot activeSlot = currentSlot;
        activeSlot.setState(RewardedAdSlot.State.SHOWING);

        // Acquire fullscreen lock
        SudokuAppOpenManager.getInstance().setSharedFullScreenLocked(true);
        this.isSharedFullScreenLocked = true;

        Bundle showAttemptBundle = new Bundle();
        showAttemptBundle.putString("placement", placement.getKey());
        logAnalytics("rewarded_show_attempt", showAttemptBundle);

        Log.d(TAG, "[Rewarded] Presenting Rewarded ad for placement: " + placement);

        // Atomic reward state: guarantees exactly-once reward delivery
        final AtomicBoolean rewardGranted = new AtomicBoolean(false);
        final String[] grantedType = new String[]{""};
        final int[] grantedAmount = new int[]{0};

        mainHandler.post(() -> {
            try {
                adToShow.setFullScreenContentCallback(new FullScreenContentCallback() {
                    @Override
                    public void onAdShowedFullScreenContent() {
                        Log.d(TAG, "[Rewarded] onAdShowedFullScreenContent (placement=" + placement + ")");
                    }

                    @Override
                    public void onAdImpression() {
                        Log.i(TAG, "[Rewarded] onAdImpression confirmed by SDK (placement=" + placement + ")");
                        Bundle impBundle = new Bundle();
                        impBundle.putString("placement", placement.getKey());
                        logAnalytics("rewarded_impression", impBundle);
                    }

                    @Override
                    public void onAdDismissedFullScreenContent() {
                        Log.d(TAG, "[Rewarded] onAdDismissedFullScreenContent (placement=" + placement + ")");
                        adToShow.setFullScreenContentCallback(null);
                        adToShow.setOnPaidEventListener(null);

                        // Release fullscreen lock
                        SudokuAppOpenManager.getInstance().setSharedFullScreenLocked(false);
                        isSharedFullScreenLocked = false;

                        boolean earned = rewardGranted.get();
                        activeSlot.setState(RewardedAdSlot.State.CONSUMED);
                        if (currentSlot == activeSlot) {
                            currentSlot = null;
                        }

                        Bundle disBundle = new Bundle();
                        disBundle.putString("placement", placement.getKey());
                        disBundle.putBoolean("reward_granted", earned);
                        logAnalytics("rewarded_dismissed", disBundle);

                        if (callback != null) {
                            callback.onResult(true, earned, grantedType[0], grantedAmount[0], "dismissed");
                        }

                        // NOTE: STRICTLY DO NOT PRELOAD ON DISMISSAL!
                        // Follow opportunity-driven preloading only when next user intent warrants it.
                    }

                    @Override
                    public void onAdFailedToShowFullScreenContent(@NonNull AdError adError) {
                        Log.e(TAG, "[Rewarded] onAdFailedToShowFullScreenContent: " + adError.getMessage());
                        adToShow.setFullScreenContentCallback(null);
                        adToShow.setOnPaidEventListener(null);

                        // Release fullscreen lock
                        SudokuAppOpenManager.getInstance().setSharedFullScreenLocked(false);
                        isSharedFullScreenLocked = false;

                        activeSlot.setState(RewardedAdSlot.State.FAILED);
                        if (currentSlot == activeSlot) {
                            currentSlot = null;
                        }

                        Bundle disBundle = new Bundle();
                        disBundle.putString("placement", placement.getKey());
                        disBundle.putString("disposal_reason", "show_failed");
                        disBundle.putLong("cache_age_ms", activeSlot.getCacheAgeMs());
                        logAnalytics("rewarded_inventory_disposed", disBundle);

                        if (callback != null) {
                            callback.onResult(false, false, "", 0, "show_failed: " + adError.getMessage());
                        }
                    }
                });

                // Paid Event Tracking
                adToShow.setOnPaidEventListener(adValue -> {
                    try {
                        long valueMicros = adValue.getValueMicros();
                        String currency = adValue.getCurrencyCode();
                        int precision = adValue.getPrecisionType();

                        Log.i(TAG, "[Rewarded] onPaidEvent (" + placement + "): " + valueMicros + " " + currency);

                        Bundle paidBundle = new Bundle();
                        paidBundle.putString("placement", placement.getKey());
                        paidBundle.putLong("value_micros", valueMicros);
                        paidBundle.putString("currency", currency != null ? currency : "USD");
                        paidBundle.putInt("precision", precision);
                        logAnalytics("rewarded_paid", paidBundle);
                    } catch (Exception e) {
                        Log.w(TAG, "Error logging paid event", e);
                    }
                });

                // Present Rewarded ad with authoritative SDK OnUserEarnedRewardListener
                adToShow.show(act, new OnUserEarnedRewardListener() {
                    @Override
                    public void onUserEarnedReward(@NonNull RewardItem rewardItem) {
                        // EXACTLY-ONCE GUARANTEE
                        if (rewardGranted.compareAndSet(false, true)) {
                            grantedType[0] = rewardItem.getType();
                            grantedAmount[0] = rewardItem.getAmount();

                            Log.i(TAG, "[Rewarded] onUserEarnedReward (placement=" + placement +
                                    ", type=" + grantedType[0] + ", amount=" + grantedAmount[0] + ")");

                            Bundle rewardBundle = new Bundle();
                            rewardBundle.putString("placement", placement.getKey());
                            rewardBundle.putString("reward_type", grantedType[0]);
                            rewardBundle.putInt("reward_amount", grantedAmount[0]);
                            logAnalytics("rewarded_granted", rewardBundle);
                        }
                    }
                });
            } catch (Exception e) {
                // Ensure fullscreen lock is released on unexpected exception
                SudokuAppOpenManager.getInstance().setSharedFullScreenLocked(false);
                isSharedFullScreenLocked = false;
                if (currentSlot == activeSlot) {
                    currentSlot = null;
                }

                Log.e(TAG, "[Rewarded] Exception presenting ad on UI thread", e);
                if (callback != null) {
                    callback.onResult(false, false, "", 0, "exception: " + e.getMessage());
                }
            }
        });

        return true;
    }

    // ═══════════════════════════════════════════════
    //  DISPOSAL & INVENTORY CLEANUP
    // ═══════════════════════════════════════════════

    public void disposeCurrentSlot(@NonNull RewardedAdSlot.DisposalReason reason) {
        if (currentSlot != null) {
            RewardedPlacement placement = currentSlot.getPlacement();
            long cacheAgeMs = currentSlot.getCacheAgeMs();

            currentSlot.dispose(reason);
            currentSlot = null;

            Bundle bundle = new Bundle();
            bundle.putString("placement", placement.getKey());
            bundle.putString("disposal_reason", reason.name().toLowerCase());
            bundle.putLong("cache_age_ms", cacheAgeMs);
            logAnalytics("rewarded_inventory_disposed", bundle);
        }
    }

    private void disposeAdObject(@NonNull RewardedAd ad,
                                 @NonNull RewardedPlacement placement,
                                 @NonNull RewardedAdSlot.DisposalReason reason,
                                 long cacheAgeMs) {
        try {
            ad.setFullScreenContentCallback(null);
            ad.setOnPaidEventListener(null);
        } catch (Exception ignored) {}

        Bundle bundle = new Bundle();
        bundle.putString("placement", placement.getKey());
        bundle.putString("disposal_reason", reason.name().toLowerCase());
        bundle.putLong("cache_age_ms", cacheAgeMs);
        logAnalytics("rewarded_inventory_disposed", bundle);
    }

    // ═══════════════════════════════════════════════
    //  ANALYTICS HELPER
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
            Log.w(TAG, "Failed logging analytics event: " + eventName, e);
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
