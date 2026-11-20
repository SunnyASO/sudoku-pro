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
import com.google.android.gms.ads.appopen.AppOpenAd;
import com.google.firebase.analytics.FirebaseAnalytics;

import java.lang.ref.WeakReference;

/**
 * Native App Open Manager modeled on the opportunity-driven World Clock architecture.
 *
 * Owns the native AppOpenAd SDK lifecycle, deterministic state machine,
 * opportunity-driven requests, cache expiration, fullscreen lock synchronization,
 * and comprehensive funnel analytics.
 */
public class SudokuAppOpenManager {

    private static final String TAG = "SudokuAppOpenManager";
    private static volatile SudokuAppOpenManager instance;

    public enum AppOpenState {
        EMPTY,
        LOADING,
        READY,
        SHOWING,
        CONSUMED,
        FAILED,
        EXPIRED,
        INVALIDATED
    }

    public enum RequestReason {
        COLD_START,
        RESUME
    }

    public enum DisposalReason {
        OPPORTUNITY_EXPIRED,
        PREMIUM,
        REMOTE_CONFIG_DISABLED,
        COOLDOWN,
        SESSION_CAP,
        FULLSCREEN_BUSY,
        BILLING_ACTIVE,
        GAMEPLAY_ACTIVE,
        STALE_ACTIVITY,
        APP_BACKGROUNDED,
        CACHE_EXPIRED,
        REPLACED,
        CONSENT_BLOCKED,
        CONSENT_REVOKED,
        INVALIDATED,
        UNKNOWN
    }

    public interface ShowCallback {
        void onResult(boolean shown, String reason);
    }

    public interface EventListener {
        void onAdLoaded();
        void onAdFailedToLoad(int errorCode, String message);
        void onAdShown();
        void onAdImpression();
        void onAdDismissed();
        void onAdFailedToShow(int errorCode, String message);
    }

    // Context & Activity tracking
    private Context appContext;
    private WeakReference<Activity> currentActivityRef = new WeakReference<>(null);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private EventListener eventListener;

    // State machine & SDK objects
    private volatile AppOpenState currentState = AppOpenState.EMPTY;
    private AppOpenAd appOpenAd = null;
    private long loadGeneration = 0L;
    private long loadStartTimestampMs = 0L;
    private long loadedTimestampMs = 0L;
    private RequestReason currentRequestReason = null;

    // Cold-start startup window tracking
    private boolean isColdStartOpportunityActive = false;

    // Limits, thresholds, and policy gates (Preserving Sudoku Pro defaults)
    private long resumeThresholdMs = 45 * 1000L;     // 45 seconds in background
    private long minIntervalMs = 120 * 1000L;        // 120 seconds minimum interval
    private int sessionCap = 4;                      // 4 per session
    private static final long CACHE_VALIDITY_MS = 4 * 3600 * 1000L; // 4 hours Google validity recommendation

    private String adUnitId = "ca-app-pub-3940256099942544/9257395921"; // default Google test unit
    private boolean isEnabled = false;
    private boolean isPremium = false;
    private boolean canRequestAds = false;
    private boolean autoResumeEnabled = false;
    private boolean isGameplayActive = false;
    private boolean isPurchaseActive = false;
    private boolean isSharedFullScreenLocked = false;

    private int appOpenShownCount = 0;
    private long lastAppOpenShownTimeMs = 0L;
    private long backgroundTimestampMs = 0L;
    private Runnable backgroundThresholdRunnable = null;

    private SudokuAppOpenManager() {}

    public static SudokuAppOpenManager getInstance() {
        if (instance == null) {
            synchronized (SudokuAppOpenManager.class) {
                if (instance == null) {
                    instance = new SudokuAppOpenManager();
                }
            }
        }
        return instance;
    }

    public void initialize(@NonNull Context context) {
        this.appContext = context.getApplicationContext();
        Log.d(TAG, "SudokuAppOpenManager initialized with context.");
    }

    public void setEventListener(EventListener listener) {
        this.eventListener = listener;
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

    // ═══════════════════════════════════════════════
    //  CONFIGURATION & GATES
    // ═══════════════════════════════════════════════

    public void configure(String unitId, boolean enabled, boolean premium, boolean autoResume) {
        if (unitId != null && !unitId.isEmpty()) {
            this.adUnitId = unitId;
        }
        this.isEnabled = enabled;
        this.isPremium = premium;
        this.autoResumeEnabled = autoResume;

        Log.d(TAG, "Configured: unit=" + adUnitId + ", enabled=" + isEnabled +
                ", isPremium=" + isPremium + ", autoResume=" + autoResumeEnabled);

        if (isPremium) {
            disposeCurrentInventory(DisposalReason.PREMIUM);
        } else if (!isEnabled) {
            disposeCurrentInventory(DisposalReason.REMOTE_CONFIG_DISABLED);
        }
    }

    public void configureLimits(long minIntervalSec, int sessionCapLimit, long bgThresholdSec) {
        if (minIntervalSec > 0) this.minIntervalMs = minIntervalSec * 1000L;
        if (sessionCapLimit > 0) this.sessionCap = sessionCapLimit;
        if (bgThresholdSec > 0) this.resumeThresholdMs = bgThresholdSec * 1000L;

        Log.d(TAG, "Limits configured: interval=" + (minIntervalMs / 1000) + "s, cap=" +
                sessionCap + ", bgThreshold=" + (resumeThresholdMs / 1000) + "s");
    }

    public void setPremium(boolean premium) {
        this.isPremium = premium;
        Log.d(TAG, "setPremium: " + premium);
        if (this.isPremium) {
            disposeCurrentInventory(DisposalReason.PREMIUM);
        }
    }

    public void setGameplayActive(boolean active) {
        this.isGameplayActive = active;
        Log.d(TAG, "setGameplayActive: " + active);
        if (active && currentState == AppOpenState.READY) {
            // Never preserve speculative App Open inventory into active gameplay
            Log.d(TAG, "Gameplay started while App Open ad was READY. Disposing to protect UX.");
            disposeCurrentInventory(DisposalReason.GAMEPLAY_ACTIVE);
        }
    }

    public void setPurchaseActive(boolean active) {
        this.isPurchaseActive = active;
        Log.d(TAG, "setPurchaseActive: " + active);
        if (active && currentState == AppOpenState.READY) {
            disposeCurrentInventory(DisposalReason.BILLING_ACTIVE);
        }
    }

    public void setSharedFullScreenLocked(boolean locked) {
        this.isSharedFullScreenLocked = locked;
        Log.d(TAG, "setSharedFullScreenLocked: " + locked);
    }

    public void setCanRequestAds(boolean canRequest) {
        this.canRequestAds = canRequest;
        Log.d(TAG, "[AppOpen] setCanRequestAds: " + canRequest);
        if (!canRequest && currentState == AppOpenState.READY) {
            Log.i(TAG, "[AppOpen] Disposing ready inventory due to revoked consent.");
            disposeCurrentInventory(DisposalReason.CONSENT_REVOKED);
        }
    }

    public boolean canRequestAds() {
        return canRequestAds;
    }

    public AppOpenState getCurrentState() {
        return currentState;
    }

    public boolean isAdAvailable() {
        if (!isEnabled || isPremium || appOpenAd == null) {
            return false;
        }
        if (isCacheExpired()) {
            disposeCurrentInventory(DisposalReason.CACHE_EXPIRED);
            return false;
        }
        return currentState == AppOpenState.READY;
    }

    private boolean isCacheExpired() {
        return (System.currentTimeMillis() - loadedTimestampMs) >= CACHE_VALIDITY_MS;
    }

    // ═══════════════════════════════════════════════
    //  OPPORTUNITY EVALUATION
    // ═══════════════════════════════════════════════

    public boolean isColdStartEligible() {
        if (!canRequestAds) {
            logOpportunity(RequestReason.COLD_START, false, "consent_blocked");
            return false;
        }
        if (!isEnabled) {
            logOpportunity(RequestReason.COLD_START, false, "remote_config_disabled");
            return false;
        }
        if (isPremium) {
            logOpportunity(RequestReason.COLD_START, false, "premium");
            return false;
        }
        if (isSharedFullScreenLocked) {
            logOpportunity(RequestReason.COLD_START, false, "fullscreen_busy");
            return false;
        }
        if (isPurchaseActive) {
            logOpportunity(RequestReason.COLD_START, false, "billing_active");
            return false;
        }
        logOpportunity(RequestReason.COLD_START, true, "none");
        return true;
    }

    public boolean isResumeEligible(long backgroundDurationMs) {
        if (!canRequestAds) {
            logOpportunity(RequestReason.RESUME, false, "consent_blocked");
            return false;
        }
        if (!isEnabled) {
            logOpportunity(RequestReason.RESUME, false, "remote_config_disabled");
            return false;
        }
        if (isPremium) {
            logOpportunity(RequestReason.RESUME, false, "premium");
            return false;
        }
        if (!autoResumeEnabled) {
            logOpportunity(RequestReason.RESUME, false, "auto_resume_disabled");
            return false;
        }
        if (currentState == AppOpenState.SHOWING) {
            logOpportunity(RequestReason.RESUME, false, "already_showing");
            return false;
        }
        if (isGameplayActive) {
            logOpportunity(RequestReason.RESUME, false, "gameplay_active");
            return false;
        }
        if (isPurchaseActive) {
            logOpportunity(RequestReason.RESUME, false, "billing_active");
            return false;
        }
        if (isSharedFullScreenLocked) {
            logOpportunity(RequestReason.RESUME, false, "fullscreen_busy");
            return false;
        }
        if (backgroundDurationMs < resumeThresholdMs) {
            logOpportunity(RequestReason.RESUME, false, "background_duration_under_threshold");
            return false;
        }
        if (appOpenShownCount >= sessionCap) {
            logOpportunity(RequestReason.RESUME, false, "session_cap");
            return false;
        }
        long now = System.currentTimeMillis();
        if (lastAppOpenShownTimeMs > 0 && (now - lastAppOpenShownTimeMs) < minIntervalMs) {
            logOpportunity(RequestReason.RESUME, false, "cooldown");
            return false;
        }

        Activity act = getCurrentActivity();
        if (act == null) {
            logOpportunity(RequestReason.RESUME, false, "stale_activity");
            return false;
        }

        logOpportunity(RequestReason.RESUME, true, "none");
        return true;
    }

    // ═══════════════════════════════════════════════
    //  OPPORTUNITY-DRIVEN REQUESTING & LOADING
    // ═══════════════════════════════════════════════

    public void startColdStartOpportunity(Activity activity) {
        updateCurrentActivity(activity);
        this.isColdStartOpportunityActive = true;

        if (!isColdStartEligible()) {
            Log.d(TAG, "[AppOpen] Cold start opportunity skipped: not eligible.");
            return;
        }

        Log.d(TAG, "[AppOpen] Cold start opportunity started. Requesting ad...");
        requestAdInternal(RequestReason.COLD_START);
    }

    public void onColdStartWindowExpired() {
        if (!isColdStartOpportunityActive) return;
        this.isColdStartOpportunityActive = false;
        Log.d(TAG, "[AppOpen] Cold start startup window expired.");

        // If an ad was loaded but not shown during startup, dispose it immediately
        if (currentState == AppOpenState.READY && currentRequestReason == RequestReason.COLD_START) {
            Log.i(TAG, "[AppOpen] Disposing cold start ad loaded after startup deadline expired.");
            disposeCurrentInventory(DisposalReason.OPPORTUNITY_EXPIRED);
        }
    }

    public void requestAd(RequestReason reason) {
        requestAdInternal(reason);
    }

    private void requestAdInternal(final RequestReason reason) {
        try {
            if (!canRequestAds) {
                Log.d(TAG, "[AppOpen] request skipped: consent not granted (canRequestAds=false).");
                return;
            }
            if (!isEnabled || isPremium) {
                Log.d(TAG, "[AppOpen] request skipped: disabled or premium.");
                return;
            }

            if (currentState == AppOpenState.LOADING) {
                Log.d(TAG, "[AppOpen] request skipped: already LOADING.");
                return;
            }

            if (currentState == AppOpenState.SHOWING) {
                Log.d(TAG, "[AppOpen] request skipped: currently SHOWING.");
                return;
            }

            if (currentState == AppOpenState.READY) {
                if (!isCacheExpired()) {
                    Log.d(TAG, "[AppOpen] request skipped: ad already READY and valid.");
                    return;
                } else {
                    disposeCurrentInventory(DisposalReason.CACHE_EXPIRED);
                }
            }

            final Context ctx = appContext != null ? appContext : (getCurrentActivity() != null ? getCurrentActivity().getApplicationContext() : null);
            if (ctx == null) {
                Log.w(TAG, "[AppOpen] Cannot load ad: Context is null.");
                return;
            }

            if (adUnitId == null || adUnitId.isEmpty()) {
                Log.w(TAG, "[AppOpen] Cannot load ad: adUnitId is empty.");
                return;
            }

            final long generation = ++loadGeneration;
            this.currentState = AppOpenState.LOADING;
            this.currentRequestReason = reason;
            this.loadStartTimestampMs = System.currentTimeMillis();

            Bundle reqBundle = new Bundle();
            reqBundle.putString("reason", reason != null ? reason.name().toLowerCase() : "unknown");
            reqBundle.putBoolean("test_mode", isTestAdUnit(adUnitId));
            logAnalytics("app_open_requested", reqBundle);

            Log.d(TAG, "[AppOpen] Requesting AppOpenAd (generation " + generation + ", reason=" + reason + ") with unit: " + adUnitId);

            mainHandler.post(() -> {
                try {
                    AdRequest request = new AdRequest.Builder().build();
                    AppOpenAd.load(
                            ctx,
                            adUnitId,
                            request,
                            new AppOpenAd.AppOpenAdLoadCallback() {
                                @Override
                                public void onAdLoaded(@NonNull AppOpenAd loadedAd) {
                                    if (generation != loadGeneration) {
                                        Log.w(TAG, "[AppOpen] Stale generation onAdLoaded (" + generation + " != " + loadGeneration + "). Discarding.");
                                        disposeAdObject(loadedAd, DisposalReason.REPLACED);
                                        return;
                                    }

                                    if (isPremium) {
                                        Log.i(TAG, "[AppOpen] User became premium during load. Discarding.");
                                        disposeAdObject(loadedAd, DisposalReason.PREMIUM);
                                        currentState = AppOpenState.EMPTY;
                                        return;
                                    }

                                    if (!isEnabled) {
                                        Log.i(TAG, "[AppOpen] Ads disabled during load. Discarding.");
                                        disposeAdObject(loadedAd, DisposalReason.REMOTE_CONFIG_DISABLED);
                                        currentState = AppOpenState.EMPTY;
                                        return;
                                    }

                                    // If this was for cold start but the startup window already elapsed, destroy immediately!
                                    if (reason == RequestReason.COLD_START && !isColdStartOpportunityActive) {
                                        Log.w(TAG, "[AppOpen] Cold start ad loaded after startup opportunity elapsed. Disposing to prevent delayed popup.");
                                        disposeAdObject(loadedAd, DisposalReason.OPPORTUNITY_EXPIRED);
                                        currentState = AppOpenState.EMPTY;
                                        return;
                                    }

                                    appOpenAd = loadedAd;
                                    currentState = AppOpenState.READY;
                                    loadedTimestampMs = System.currentTimeMillis();
                                    long duration = loadedTimestampMs - loadStartTimestampMs;

                                    Log.d(TAG, "[AppOpen] onAdLoaded success (generation=" + generation + ", duration=" + duration + "ms)");

                                    Bundle loadBundle = new Bundle();
                                    loadBundle.putString("reason", reason != null ? reason.name().toLowerCase() : "unknown");
                                    loadBundle.putLong("load_duration_ms", duration);
                                    logAnalytics("app_open_loaded", loadBundle);

                                    if (eventListener != null) {
                                        try { eventListener.onAdLoaded(); } catch (Exception ignored) {}
                                    }
                                }

                                @Override
                                public void onAdFailedToLoad(@NonNull LoadAdError loadAdError) {
                                    if (generation != loadGeneration) {
                                        return;
                                    }

                                    appOpenAd = null;
                                    currentState = AppOpenState.FAILED;
                                    Log.e(TAG, "[AppOpen] onAdFailedToLoad: " + loadAdError.getMessage() + " (Code: " + loadAdError.getCode() + ")");

                                    Bundle failBundle = new Bundle();
                                    failBundle.putString("reason", reason != null ? reason.name().toLowerCase() : "unknown");
                                    failBundle.putInt("error_code", loadAdError.getCode());
                                    failBundle.putString("normalized_reason", loadAdError.getMessage());
                                    logAnalytics("app_open_load_failed", failBundle);

                                    if (eventListener != null) {
                                        try { eventListener.onAdFailedToLoad(loadAdError.getCode(), loadAdError.getMessage()); } catch (Exception ignored) {}
                                    }

                                    currentState = AppOpenState.EMPTY;
                                }
                            }
                    );
                } catch (Exception e) {
                    currentState = AppOpenState.EMPTY;
                    Log.e(TAG, "[AppOpen] Exception during AppOpenAd.load", e);
                }
            });
        } catch (Exception e) {
            currentState = AppOpenState.EMPTY;
            Log.e(TAG, "[AppOpen] Exception in requestAdInternal", e);
        }
    }

    // ═══════════════════════════════════════════════
    //  SHOWING & SDK LIFECYCLE CALLBACKS
    // ═══════════════════════════════════════════════

    public boolean showAd(@Nullable Activity activity, @NonNull RequestReason reason, @Nullable ShowCallback callback) {
        final Activity act = activity != null ? activity : getCurrentActivity();
        if (act == null || act.isFinishing() || act.isDestroyed()) {
            Log.w(TAG, "[AppOpen] showAd skipped: Activity unavailable or finishing.");
            if (callback != null) callback.onResult(false, "invalid_activity");
            return false;
        }

        if (!isEnabled) {
            if (callback != null) callback.onResult(false, "disabled");
            return false;
        }

        if (isPremium) {
            if (callback != null) callback.onResult(false, "premium");
            return false;
        }

        if (currentState == AppOpenState.SHOWING) {
            if (callback != null) callback.onResult(false, "already_showing");
            return false;
        }

        if (isSharedFullScreenLocked) {
            if (callback != null) callback.onResult(false, "shared_fullscreen_locked");
            return false;
        }

        if (isPurchaseActive) {
            if (callback != null) callback.onResult(false, "purchase_active");
            return false;
        }

        if (isGameplayActive && reason != RequestReason.COLD_START) {
            if (callback != null) callback.onResult(false, "gameplay_active");
            return false;
        }

        if (appOpenShownCount >= sessionCap) {
            if (callback != null) callback.onResult(false, "session_cap_reached");
            return false;
        }

        long now = System.currentTimeMillis();
        if (lastAppOpenShownTimeMs > 0 && (now - lastAppOpenShownTimeMs) < minIntervalMs) {
            if (callback != null) callback.onResult(false, "interval_cooldown_active");
            return false;
        }

        if (!isAdAvailable()) {
            if (callback != null) callback.onResult(false, "not_ready");
            return false;
        }

        final AppOpenAd adToShow = this.appOpenAd;
        if (adToShow == null) {
            if (callback != null) callback.onResult(false, "ad_null");
            return false;
        }

        this.currentState = AppOpenState.SHOWING;
        Log.d(TAG, "[AppOpen] Presenting AppOpenAd (reason=" + reason + ")...");

        Bundle attemptBundle = new Bundle();
        attemptBundle.putString("reason", reason.name().toLowerCase());
        logAnalytics("app_open_show_attempt", attemptBundle);

        mainHandler.post(() -> {
            try {
                // Official FullScreenContentCallback registration
                adToShow.setFullScreenContentCallback(new FullScreenContentCallback() {
                    @Override
                    public void onAdShowedFullScreenContent() {
                        Log.d(TAG, "[AppOpen] onAdShowedFullScreenContent");
                        appOpenShownCount++;
                        lastAppOpenShownTimeMs = System.currentTimeMillis();
                        if (eventListener != null) {
                            try { eventListener.onAdShown(); } catch (Exception ignored) {}
                        }
                    }

                    @Override
                    public void onAdImpression() {
                        // OFFICIAL SDK IMPRESSION CALLBACK
                        Log.i(TAG, "[AppOpen] onAdImpression confirmed by SDK");
                        Bundle impBundle = new Bundle();
                        impBundle.putString("reason", reason.name().toLowerCase());
                        logAnalytics("app_open_impression", impBundle);
                        if (eventListener != null) {
                            try { eventListener.onAdImpression(); } catch (Exception ignored) {}
                        }
                    }

                    @Override
                    public void onAdDismissedFullScreenContent() {
                        Log.d(TAG, "[AppOpen] onAdDismissedFullScreenContent");
                        adToShow.setFullScreenContentCallback(null);
                        appOpenAd = null;
                        currentState = AppOpenState.CONSUMED;

                        Bundle disBundle = new Bundle();
                        disBundle.putString("reason", reason.name().toLowerCase());
                        disBundle.putInt("session_count", appOpenShownCount);
                        logAnalytics("app_open_dismissed", disBundle);

                        currentState = AppOpenState.EMPTY;

                        if (eventListener != null) {
                            try { eventListener.onAdDismissed(); } catch (Exception ignored) {}
                        }

                        // NOTE: DO NOT PRELOAD IMMEDIATELY ON DISMISSAL!
                        // Cooldown is active. Requests must be opportunity-driven.
                    }

                    @Override
                    public void onAdFailedToShowFullScreenContent(@NonNull AdError adError) {
                        Log.e(TAG, "[AppOpen] onAdFailedToShowFullScreenContent: " + adError.getMessage());
                        adToShow.setFullScreenContentCallback(null);
                        appOpenAd = null;
                        currentState = AppOpenState.FAILED;
                        currentState = AppOpenState.EMPTY;

                        if (eventListener != null) {
                            try {
                                eventListener.onAdFailedToShow(adError.getCode(), adError.getMessage());
                                eventListener.onAdDismissed();
                            } catch (Exception ignored) {}
                        }
                    }
                });

                // Official Paid Event Listener registration
                adToShow.setOnPaidEventListener(adValue -> {
                    try {
                        long valueMicros = adValue.getValueMicros();
                        String currency = adValue.getCurrencyCode();
                        int precision = adValue.getPrecisionType();

                        Log.i(TAG, "[AppOpen] onPaidEvent: " + valueMicros + " " + currency + " (precision=" + precision + ")");

                        Bundle paidBundle = new Bundle();
                        paidBundle.putString("reason", reason.name().toLowerCase());
                        paidBundle.putLong("value_micros", valueMicros);
                        paidBundle.putString("currency", currency != null ? currency : "USD");
                        paidBundle.putInt("precision", precision);
                        logAnalytics("app_open_paid", paidBundle);
                    } catch (Exception e) {
                        Log.w(TAG, "Error logging paid event", e);
                    }
                });

                adToShow.show(act);
                if (callback != null) callback.onResult(true, "shown");
            } catch (Exception e) {
                currentState = AppOpenState.EMPTY;
                Log.e(TAG, "[AppOpen] Exception showing ad on UI thread", e);
                if (callback != null) callback.onResult(false, "exception: " + e.getMessage());
            }
        });

        return true;
    }

    // ═══════════════════════════════════════════════
    //  BACKGROUND & RESUME LIFECYCLE
    // ═══════════════════════════════════════════════

    public void handleOnPause() {
        this.backgroundTimestampMs = System.currentTimeMillis();
        cancelBackgroundThresholdTimer();

        // If eligible for an upcoming resume, schedule opportunity check when threshold passes
        if (isEnabled && !isPremium && autoResumeEnabled && !isGameplayActive && !isPurchaseActive && !isSharedFullScreenLocked) {
            scheduleBackgroundThresholdTimer();
        }
    }

    private void scheduleBackgroundThresholdTimer() {
        backgroundThresholdRunnable = () -> {
            try {
                long now = System.currentTimeMillis();
                long duration = backgroundTimestampMs > 0 ? (now - backgroundTimestampMs) : 0;
                if (duration >= resumeThresholdMs) {
                    boolean cooldownPassed = (lastAppOpenShownTimeMs == 0) || ((now - lastAppOpenShownTimeMs) >= minIntervalMs);
                    boolean capNotReached = appOpenShownCount < sessionCap;

                    if (cooldownPassed && capNotReached && !isPremium && isEnabled && !isGameplayActive) {
                        Log.d(TAG, "[AppOpen] App reached 45s background threshold with eligible resume criteria. Pre-buffering resume ad...");
                        requestAdInternal(RequestReason.RESUME);
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Error in background threshold check", e);
            }
        };
        mainHandler.postDelayed(backgroundThresholdRunnable, resumeThresholdMs);
    }

    private void cancelBackgroundThresholdTimer() {
        if (backgroundThresholdRunnable != null) {
            mainHandler.removeCallbacks(backgroundThresholdRunnable);
            backgroundThresholdRunnable = null;
        }
    }

    public void handleOnResume(@Nullable Activity activity) {
        updateCurrentActivity(activity);
        cancelBackgroundThresholdTimer();

        try {
            long now = System.currentTimeMillis();
            long backgroundDuration = backgroundTimestampMs > 0 ? (now - backgroundTimestampMs) : 0;
            backgroundTimestampMs = 0L;

            if (!isResumeEligible(backgroundDuration)) {
                return;
            }

            Log.d(TAG, "[AppOpen] Resume opportunity confirmed (" + (backgroundDuration / 1000) + "s in background). Checking readiness...");

            if (isAdAvailable()) {
                showAd(getCurrentActivity(), RequestReason.RESUME, null);
            } else {
                Log.d(TAG, "[AppOpen] Resume eligible but ad not ready. Triggering on-demand opportunity request.");
                requestAdInternal(RequestReason.RESUME);
            }
        } catch (Exception e) {
            Log.e(TAG, "Exception in handleOnResume", e);
        }
    }

    // ═══════════════════════════════════════════════
    //  INVENTORY DISPOSAL & CLEANUP
    // ═══════════════════════════════════════════════

    public void disposeCurrentInventory(@NonNull DisposalReason reason) {
        if (this.appOpenAd != null) {
            disposeAdObject(this.appOpenAd, reason);
            this.appOpenAd = null;
        }
        if (currentState != AppOpenState.SHOWING) {
            this.currentState = AppOpenState.EMPTY;
        }
    }

    private void disposeAdObject(@Nullable AppOpenAd ad, @NonNull DisposalReason reason) {
        if (ad != null) {
            try {
                ad.setFullScreenContentCallback(null);
                ad.setOnPaidEventListener(null);
            } catch (Exception ignored) {}
        }

        Log.i(TAG, "[AppOpen] Inventory disposed. Reason: " + reason);

        Bundle bundle = new Bundle();
        bundle.putString("reason", reason.name().toLowerCase());
        logAnalytics("app_open_inventory_disposed", bundle);
    }

    // ═══════════════════════════════════════════════
    //  ANALYTICS HELPER
    // ═══════════════════════════════════════════════

    private void logOpportunity(RequestReason reason, boolean eligible, String blockedReason) {
        Bundle bundle = new Bundle();
        bundle.putString("reason", reason != null ? reason.name().toLowerCase() : "unknown");
        bundle.putBoolean("eligible", eligible);
        bundle.putString("blocked_reason", blockedReason != null ? blockedReason : "none");
        logAnalytics("app_open_opportunity", bundle);
    }

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

    private boolean isTestAdUnit(String unit) {
        return unit != null && unit.contains("3940256099942544");
    }
}
