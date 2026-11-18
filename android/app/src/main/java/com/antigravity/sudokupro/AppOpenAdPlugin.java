package com.antigravity.sudokupro;

import android.app.Activity;
import android.util.Log;

import androidx.annotation.NonNull;

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

    // Configurable thresholds & limits (Optimized for higher show rate)
    private long resumeThresholdMs = 45 * 1000L;  // 45 seconds in background (down from 180s)
    private long minIntervalMs = 120 * 1000L;     // 120 seconds minimum interval (down from 240s)
    private int sessionCap = 4;                   // 4 App Open ads per session (up from 2)

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
    private String currentAdUnitId = "ca-app-pub-3940256099942544/9257395921"; // default Google test unit

    @Override
    public void load() {
        super.load();
        Log.d(TAG, "AppOpenAdPlugin loaded.");
    }

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

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        backgroundTimestamp = System.currentTimeMillis();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
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

    @PluginMethod
    public void init(PluginCall call) {
        try {
            String unitId = call.getString("adUnitId");
            if (unitId != null && !unitId.isEmpty()) {
                this.currentAdUnitId = unitId;
            }
            this.isEnabled = call.getBoolean("enabled", false);
            this.isPremium = call.getBoolean("isPremium", false);
            this.autoResumeEnabled = call.getBoolean("autoResume", false);

            if (isEnabled && !isPremium) {
                loadAdInternal();
            }

            JSObject ret = new JSObject();
            ret.put("initialized", true);
            ret.put("enabled", isEnabled);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Exception in init", e);
            call.reject("Init failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void configureLimits(PluginCall call) {
        try {
            if (call.hasOption("minIntervalSeconds")) {
                this.minIntervalMs = call.getInt("minIntervalSeconds", 240) * 1000L;
            }
            if (call.hasOption("sessionCap")) {
                this.sessionCap = call.getInt("sessionCap", 2);
            }
            if (call.hasOption("backgroundThresholdSeconds")) {
                this.resumeThresholdMs = call.getInt("backgroundThresholdSeconds", 180) * 1000L;
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
            this.isGameplayActive = call.getBoolean("active", false);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Exception in setGameplayActive", e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void setPurchaseActive(PluginCall call) {
        try {
            this.isPurchaseActive = call.getBoolean("active", false);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Exception in setPurchaseActive", e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void setSharedFullScreenLocked(PluginCall call) {
        try {
            this.isSharedFullScreenLocked = call.getBoolean("locked", false);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Exception in setSharedFullScreenLocked", e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void setPremium(PluginCall call) {
        try {
            this.isPremium = call.getBoolean("isPremium", false);
            if (this.isPremium && mAppOpenAd != null) {
                mAppOpenAd = null;
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
            if (unitId != null && !unitId.isEmpty()) {
                this.currentAdUnitId = unitId;
            }
            loadAdInternal();
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
        showAdInternal(call);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        try {
            JSObject ret = new JSObject();
            ret.put("available", isAdAvailable());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Exception in isAvailable", e);
            call.reject(e.getMessage());
        }
    }
}
