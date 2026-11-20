package com.antigravity.sudokupro;

import android.app.Activity;
import android.util.Log;

import androidx.annotation.NonNull;

import com.antigravity.sudokupro.ads.SudokuAppOpenManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.appopen.AppOpenAd;

import java.util.Date;

@CapacitorPlugin(name = "AppOpenAd")
public class AppOpenAdPlugin extends Plugin {

    private static final String TAG = "AppOpenAdPlugin";

    /**
     * Rollback Safety Switch:
     * Set to true to use the opportunity-driven Native SudokuAppOpenManager.
     * Set to false to instantly revert to legacy in-plugin App Open logic during testing.
     */
    private static final boolean USE_NEW_APP_OPEN_MANAGER = true;

    private SudokuAppOpenManager mManager;

    // ═══════════════════════════════════════════════
    //  LEGACY STATE (Preserved for Rollback Safety)
    // ═══════════════════════════════════════════════
    private long resumeThresholdMs = 45 * 1000L;
    private long minIntervalMs = 120 * 1000L;
    private int sessionCap = 4;

    private AppOpenAd mAppOpenAd = null;
    private boolean isLoadingAd = false;
    private boolean isShowingAd = false;
    private boolean isPremium = false;
    private boolean isEnabled = false;
    private boolean autoResumeEnabled = false;
    private boolean isGameplayActive = false;
    private boolean isPurchaseActive = false;
    private boolean isSharedFullScreenLocked = false;

    private int appOpenShownCount = 0;
    private long lastAppOpenShownTimeMs = 0;
    private long loadTime = 0;
    private long backgroundTimestamp = 0;
    private String currentAdUnitId = "ca-app-pub-3940256099942544/9257395921";

    @Override
    public void load() {
        super.load();
        if (USE_NEW_APP_OPEN_MANAGER) {
            mManager = SudokuAppOpenManager.getInstance();
            if (getContext() != null) {
                mManager.initialize(getContext());
            }
            if (getActivity() != null) {
                mManager.updateCurrentActivity(getActivity());
            }
            mManager.setEventListener(new SudokuAppOpenManager.EventListener() {
                @Override
                public void onAdLoaded() {
                    try {
                        notifyListeners("appOpenLoaded", new JSObject());
                    } catch (Exception e) {
                        Log.e(TAG, "Error notifying appOpenLoaded", e);
                    }
                }

                @Override
                public void onAdFailedToLoad(int errorCode, String message) {
                    // Failures logged via telemetry
                }

                @Override
                public void onAdShown() {
                    try {
                        notifyListeners("appOpenShown", new JSObject());
                    } catch (Exception e) {
                        Log.e(TAG, "Error notifying appOpenShown", e);
                    }
                }

                @Override
                public void onAdImpression() {
                    // Telemetry captured in manager
                }

                @Override
                public void onAdDismissed() {
                    try {
                        notifyListeners("appOpenDismissed", new JSObject());
                    } catch (Exception e) {
                        Log.e(TAG, "Error notifying appOpenDismissed", e);
                    }
                }

                @Override
                public void onAdFailedToShow(int errorCode, String message) {
                    try {
                        notifyListeners("appOpenDismissed", new JSObject());
                    } catch (Exception e) {
                        Log.e(TAG, "Error notifying appOpenDismissed on failure", e);
                    }
                }
            });
            Log.d(TAG, "AppOpenAdPlugin loaded with new SudokuAppOpenManager.");
        } else {
            Log.d(TAG, "AppOpenAdPlugin loaded with LEGACY manager.");
        }
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (USE_NEW_APP_OPEN_MANAGER && mManager != null) {
            mManager.handleOnPause();
        } else {
            backgroundTimestamp = System.currentTimeMillis();
        }
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (USE_NEW_APP_OPEN_MANAGER && mManager != null) {
            mManager.handleOnResume(getActivity());
        } else {
            handleLegacyResume();
        }
    }

    @PluginMethod
    public void init(PluginCall call) {
        try {
            String unitId = call.getString("adUnitId");
            boolean enabled = call.getBoolean("enabled", false);
            boolean premium = call.getBoolean("isPremium", false);
            boolean autoResume = call.getBoolean("autoResume", false);

            if (USE_NEW_APP_OPEN_MANAGER && mManager != null) {
                if (getActivity() != null) {
                    mManager.updateCurrentActivity(getActivity());
                }
                mManager.configure(unitId, enabled, premium, autoResume);
                if (enabled && !premium) {
                    mManager.startColdStartOpportunity(getActivity());
                }
            } else {
                if (unitId != null && !unitId.isEmpty()) {
                    this.currentAdUnitId = unitId;
                }
                this.isEnabled = enabled;
                this.isPremium = premium;
                this.autoResumeEnabled = autoResume;

                if (isEnabled && !isPremium) {
                    loadAdInternal();
                }
            }

            JSObject ret = new JSObject();
            ret.put("initialized", true);
            ret.put("enabled", enabled);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Exception in init", e);
            call.reject("Init failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void configureLimits(PluginCall call) {
        try {
            long minIntervalSec = call.hasOption("minIntervalSeconds") ? call.getInt("minIntervalSeconds", 240) : 240;
            int cap = call.hasOption("sessionCap") ? call.getInt("sessionCap", 2) : 2;
            long bgThresholdSec = call.hasOption("backgroundThresholdSeconds") ? call.getInt("backgroundThresholdSeconds", 180) : 180;

            if (USE_NEW_APP_OPEN_MANAGER && mManager != null) {
                mManager.configureLimits(minIntervalSec, cap, bgThresholdSec);
            } else {
                this.minIntervalMs = minIntervalSec * 1000L;
                this.sessionCap = cap;
                this.resumeThresholdMs = bgThresholdSec * 1000L;
            }

            JSObject ret = new JSObject();
            ret.put("configured", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Exception in configureLimits", e);
            call.reject("ConfigureLimits failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void setGameplayActive(PluginCall call) {
        try {
            boolean active = call.getBoolean("active", false);
            if (USE_NEW_APP_OPEN_MANAGER && mManager != null) {
                mManager.setGameplayActive(active);
            } else {
                this.isGameplayActive = active;
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Exception in setGameplayActive", e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void setPurchaseActive(PluginCall call) {
        try {
            boolean active = call.getBoolean("active", false);
            if (USE_NEW_APP_OPEN_MANAGER && mManager != null) {
                mManager.setPurchaseActive(active);
            } else {
                this.isPurchaseActive = active;
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Exception in setPurchaseActive", e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void setSharedFullScreenLocked(PluginCall call) {
        try {
            boolean locked = call.getBoolean("locked", false);
            if (USE_NEW_APP_OPEN_MANAGER && mManager != null) {
                mManager.setSharedFullScreenLocked(locked);
            } else {
                this.isSharedFullScreenLocked = locked;
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Exception in setSharedFullScreenLocked", e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void setPremium(PluginCall call) {
        try {
            boolean premium = call.getBoolean("isPremium", false);
            if (USE_NEW_APP_OPEN_MANAGER && mManager != null) {
                mManager.setPremium(premium);
            } else {
                this.isPremium = premium;
                if (this.isPremium && mAppOpenAd != null) {
                    mAppOpenAd = null;
                }
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Exception in setPremium", e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void load(PluginCall call) {
        try {
            String unitId = call.getString("adUnitId");
            if (USE_NEW_APP_OPEN_MANAGER && mManager != null) {
                if (unitId != null && !unitId.isEmpty()) {
                    mManager.configure(unitId, true, false, true);
                }
                mManager.requestAd(SudokuAppOpenManager.RequestReason.COLD_START);
            } else {
                if (unitId != null && !unitId.isEmpty()) {
                    this.currentAdUnitId = unitId;
                }
                loadAdInternal();
            }
            JSObject ret = new JSObject();
            ret.put("loading", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Exception in load", e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void show(PluginCall call) {
        if (USE_NEW_APP_OPEN_MANAGER && mManager != null) {
            SudokuAppOpenManager.RequestReason reason = SudokuAppOpenManager.RequestReason.COLD_START;
            mManager.showAd(getActivity(), reason, (shown, resultReason) -> {
                JSObject ret = new JSObject();
                ret.put("shown", shown);
                ret.put("reason", resultReason);
                call.resolve(ret);
            });
        } else {
            showAdInternal(call);
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        try {
            boolean available;
            if (USE_NEW_APP_OPEN_MANAGER && mManager != null) {
                available = mManager.isAdAvailable();
            } else {
                available = isAdAvailable();
            }
            JSObject ret = new JSObject();
            ret.put("available", available);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Exception in isAvailable", e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void onColdStartWindowExpired(PluginCall call) {
        try {
            if (USE_NEW_APP_OPEN_MANAGER && mManager != null) {
                mManager.onColdStartWindowExpired();
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Exception in onColdStartWindowExpired", e);
            call.reject(e.getMessage());
        }
    }

    // ═══════════════════════════════════════════════
    //  LEGACY METHODS (Preserved for Rollback Safety)
    // ═══════════════════════════════════════════════

    private boolean isAdAvailable() {
        return isEnabled && mAppOpenAd != null && ((new Date()).getTime() - loadTime < (4 * 3600 * 1000));
    }

    private void loadAdInternal() {
        try {
            if (!isEnabled || isLoadingAd || isAdAvailable() || isPremium) {
                return;
            }

            if (currentAdUnitId == null || currentAdUnitId.isEmpty()) {
                Log.w(TAG, "Cannot load AppOpenAd: adUnitId is empty.");
                return;
            }

            final Activity activity = getActivity();
            if (activity == null || activity.isDestroyed() || activity.isFinishing()) {
                return;
            }

            isLoadingAd = true;
            activity.runOnUiThread(() -> {
                try {
                    if (activity.isDestroyed() || activity.isFinishing() || !isEnabled || isPremium) {
                        isLoadingAd = false;
                        return;
                    }

                    if (isAdAvailable()) {
                        isLoadingAd = false;
                        return;
                    }

                    Log.d(TAG, "[AppOpen] preload_started with unit: " + currentAdUnitId);
                    AdRequest request = new AdRequest.Builder().build();
                    AppOpenAd.load(
                            activity,
                            currentAdUnitId,
                            request,
                            new AppOpenAd.AppOpenAdLoadCallback() {
                                @Override
                                public void onAdLoaded(@NonNull AppOpenAd appOpenAd) {
                                    mAppOpenAd = appOpenAd;
                                    isLoadingAd = false;
                                    loadTime = (new Date()).getTime();
                                    Log.d(TAG, "[AppOpen] loaded");
                                    Log.d(TAG, "[AppOpen] ready");
                                    try {
                                        notifyListeners("appOpenLoaded", new JSObject());
                                    } catch (Exception e) {
                                        Log.e(TAG, "Error notifying appOpenLoaded", e);
                                    }
                                }

                                @Override
                                public void onAdFailedToLoad(@NonNull LoadAdError loadAdError) {
                                    isLoadingAd = false;
                                    mAppOpenAd = null;
                                    Log.e(TAG, "[AppOpen] failed to load: " + loadAdError.getMessage());
                                }
                            }
                    );
                } catch (Exception e) {
                    isLoadingAd = false;
                    Log.e(TAG, "Exception while loading AppOpenAd on UI thread", e);
                }
            });
        } catch (Exception e) {
            isLoadingAd = false;
            Log.e(TAG, "Exception in loadAdInternal", e);
        }
    }

    private void showAdInternal(final PluginCall call) {
        try {
            if (!isEnabled) {
                Log.d(TAG, "[AppOpen] skipped reason=disabled");
                if (call != null) {
                    JSObject ret = new JSObject();
                    ret.put("shown", false);
                    ret.put("reason", "disabled");
                    call.resolve(ret);
                }
                return;
            }

            if (isPremium) {
                Log.d(TAG, "[AppOpen] skipped reason=premium");
                if (call != null) {
                    JSObject ret = new JSObject();
                    ret.put("shown", false);
                    ret.put("reason", "premium");
                    call.resolve(ret);
                }
                return;
            }

            if (isShowingAd) {
                Log.d(TAG, "[AppOpen] skipped reason=already_showing");
                if (call != null) {
                    JSObject ret = new JSObject();
                    ret.put("shown", false);
                    ret.put("reason", "already_showing");
                    call.resolve(ret);
                }
                return;
            }

            if (isSharedFullScreenLocked) {
                Log.d(TAG, "[AppOpen] skipped reason=shared_fullscreen_locked");
                if (call != null) {
                    JSObject ret = new JSObject();
                    ret.put("shown", false);
                    ret.put("reason", "shared_fullscreen_locked");
                    call.resolve(ret);
                }
                return;
            }

            boolean ignoreGameplayCheck = call != null && call.getBoolean("ignoreGameplayCheck", false);
            if (!ignoreGameplayCheck && isGameplayActive) {
                Log.d(TAG, "[AppOpen] skipped reason=gameplay_active");
                if (call != null) {
                    JSObject ret = new JSObject();
                    ret.put("shown", false);
                    ret.put("reason", "gameplay_active");
                    call.resolve(ret);
                }
                return;
            }

            if (isPurchaseActive) {
                Log.d(TAG, "[AppOpen] skipped reason=purchase_active");
                if (call != null) {
                    JSObject ret = new JSObject();
                    ret.put("shown", false);
                    ret.put("reason", "purchase_active");
                    call.resolve(ret);
                }
                return;
            }

            if (appOpenShownCount >= sessionCap) {
                Log.d(TAG, "[AppOpen] skipped reason=session_cap_reached (" + appOpenShownCount + "/" + sessionCap + ")");
                if (call != null) {
                    JSObject ret = new JSObject();
                    ret.put("shown", false);
                    ret.put("reason", "session_cap_reached");
                    call.resolve(ret);
                }
                return;
            }

            long now = System.currentTimeMillis();
            if (lastAppOpenShownTimeMs > 0 && (now - lastAppOpenShownTimeMs) < minIntervalMs) {
                long remaining = (minIntervalMs - (now - lastAppOpenShownTimeMs)) / 1000;
                Log.d(TAG, "[AppOpen] skipped reason=interval_cooldown_active (" + remaining + "s remaining)");
                if (call != null) {
                    JSObject ret = new JSObject();
                    ret.put("shown", false);
                    ret.put("reason", "interval_cooldown_active");
                    call.resolve(ret);
                }
                return;
            }

            if (!isAdAvailable()) {
                Log.d(TAG, "[AppOpen] skipped reason=not_ready (triggering preload)");
                loadAdInternal();
                if (call != null) {
                    JSObject ret = new JSObject();
                    ret.put("shown", false);
                    ret.put("reason", "not_ready");
                    call.resolve(ret);
                }
                return;
            }

            final Activity activity = getActivity();
            if (activity == null || activity.isDestroyed() || activity.isFinishing()) {
                if (call != null) {
                    JSObject ret = new JSObject();
                    ret.put("shown", false);
                    ret.put("reason", "invalid_activity");
                    call.resolve(ret);
                }
                return;
            }

            activity.runOnUiThread(() -> {
                try {
                    if (activity.isDestroyed() || activity.isFinishing()) {
                        if (call != null) {
                            JSObject ret = new JSObject();
                            ret.put("shown", false);
                            ret.put("reason", "activity_finishing");
                            call.resolve(ret);
                        }
                        return;
                    }

                    if (mAppOpenAd == null) {
                        if (call != null) {
                            JSObject ret = new JSObject();
                            ret.put("shown", false);
                            ret.put("reason", "ad_null");
                            call.resolve(ret);
                        }
                        return;
                    }

                    mAppOpenAd.setFullScreenContentCallback(new FullScreenContentCallback() {
                        @Override
                        public void onAdDismissedFullScreenContent() {
                            Log.d(TAG, "[AppOpen] dismissed");
                            mAppOpenAd = null;
                            isShowingAd = false;
                            try {
                                notifyListeners("appOpenDismissed", new JSObject());
                            } catch (Exception e) {
                                Log.e(TAG, "Error notifying appOpenDismissed", e);
                            }
                            loadAdInternal(); // preload next
                        }

                        @Override
                        public void onAdFailedToShowFullScreenContent(@NonNull AdError adError) {
                            Log.e(TAG, "[AppOpen] failed to show: " + adError.getMessage());
                            mAppOpenAd = null;
                            isShowingAd = false;
                            try {
                                notifyListeners("appOpenDismissed", new JSObject());
                            } catch (Exception e) {
                                Log.e(TAG, "Error notifying appOpenDismissed on failure", e);
                            }
                            loadAdInternal();
                        }

                        @Override
                        public void onAdShowedFullScreenContent() {
                            Log.d(TAG, "[AppOpen] shown");
                            isShowingAd = true;
                            appOpenShownCount++;
                            lastAppOpenShownTimeMs = System.currentTimeMillis();
                            try {
                                notifyListeners("appOpenShown", new JSObject());
                            } catch (Exception e) {
                                Log.e(TAG, "Error notifying appOpenShown", e);
                            }
                        }
                    });

                    mAppOpenAd.show(activity);
                    if (call != null) {
                        JSObject ret = new JSObject();
                        ret.put("shown", true);
                        call.resolve(ret);
                    }
                } catch (Exception e) {
                    isShowingAd = false;
                    Log.e(TAG, "Exception while showing AppOpenAd on UI thread", e);
                    if (call != null) {
                        JSObject ret = new JSObject();
                        ret.put("shown", false);
                        ret.put("reason", "exception: " + e.getMessage());
                        call.resolve(ret);
                    }
                }
            });
        } catch (Exception e) {
            isShowingAd = false;
            Log.e(TAG, "Exception in showAdInternal", e);
            if (call != null) {
                JSObject ret = new JSObject();
                ret.put("shown", false);
                ret.put("reason", "exception: " + e.getMessage());
                call.resolve(ret);
            }
        }
    }

    private void handleLegacyResume() {
        try {
            long now = System.currentTimeMillis();
            long backgroundDuration = backgroundTimestamp > 0 ? (now - backgroundTimestamp) : 0;
            backgroundTimestamp = 0;

            if (!isEnabled || isPremium || !autoResumeEnabled || isShowingAd) {
                return;
            }

            if (isGameplayActive) {
                Log.d(TAG, "[AppOpen] skipped reason=gameplay_active_on_resume");
                return;
            }

            if (isPurchaseActive) {
                Log.d(TAG, "[AppOpen] skipped reason=purchase_active_on_resume");
                return;
            }

            if (isSharedFullScreenLocked) {
                Log.d(TAG, "[AppOpen] skipped reason=shared_fullscreen_locked_on_resume");
                return;
            }

            if (backgroundDuration < resumeThresholdMs) {
                Log.d(TAG, "[AppOpen] skipped reason=background_duration_under_threshold (" + (backgroundDuration / 1000) + "s < " + (resumeThresholdMs / 1000) + "s)");
                return;
            }

            if (appOpenShownCount >= sessionCap) {
                Log.d(TAG, "[AppOpen] skipped reason=session_cap_reached_on_resume (" + appOpenShownCount + "/" + sessionCap + ")");
                return;
            }

            if (lastAppOpenShownTimeMs > 0 && (now - lastAppOpenShownTimeMs) < minIntervalMs) {
                long remaining = (minIntervalMs - (now - lastAppOpenShownTimeMs)) / 1000;
                Log.d(TAG, "[AppOpen] skipped reason=interval_cooldown_active_on_resume (" + remaining + "s remaining)");
                return;
            }

            Log.d(TAG, "[AppOpen] App resumed after " + (backgroundDuration / 1000) + "s in background. Attempting show...");
            showAdInternal(null);
        } catch (Exception e) {
            Log.e(TAG, "Exception in handleOnResume", e);
        }
    }
}
