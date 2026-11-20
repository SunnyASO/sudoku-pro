package com.antigravity.sudokupro.ads;

import android.app.Activity;
import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.antigravity.sudokupro.R;
import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdLoader;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.nativead.NativeAd;
import com.google.android.gms.ads.nativead.NativeAdOptions;
import com.google.android.gms.ads.nativead.NativeAdView;
import com.google.firebase.analytics.FirebaseAnalytics;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * NativeAdManager — authoritative native advertising lifecycle manager for Sudoku Pro.
 * Modeled on World Clock's placement-aware NativeAdPair architecture.
 *
 * Key guarantees:
 * 1. Placement ownership: each placement carries dedicated slot & configuration.
 * 2. Screen generation tracking: stale callbacks can NEVER attach after user navigates.
 * 3. Request deduplication: eliminates duplicate in-flight and redundant network loads.
 * 4. AdChoices compliance: SDK-managed overlay positioned via NativeAdOptions.ADCHOICES_TOP_RIGHT.
 * 5. Full lifecycle analytics: requested, loaded, impression, paid, disposal telemetry.
 */
public class NativeAdManager {

    private static final String TAG = "NativeAdManager";
    private static volatile NativeAdManager instance;

    // Google official test native ad unit ID
    public static final String TEST_AD_UNIT_ID = "ca-app-pub-3940256099942544/2247696110";

    public interface ShowCallback {
        void onResult(boolean shown, String message);
    }

    private Context appContext;
    private WeakReference<Activity> currentActivityRef = new WeakReference<>(null);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private boolean isEnabled = true;
    private boolean isPremium = false;
    private boolean canRequestAds = false;
    private boolean isTestMode = false;

    private long globalLoadGeneration = 0L;

    // Placement state slots
    private final Map<NativePlacement, NativeAdSlot> slots = new EnumMap<>(NativePlacement.class);

    // Screen generation tracking per placement: increments whenever user enters/leaves a screen
    private final Map<NativePlacement, Long> screenGenerations = new EnumMap<>(NativePlacement.class);

    // Currently visible screen placement
    private NativePlacement currentScreenPlacement = null;

    // Active displayed view references
    private FrameLayout activeOverlayContainer = null;
    private NativeAdView activeNativeAdView = null;
    private NativePlacement activeDisplayedPlacement = null;

    // Production ad units per placement
    private final Map<NativePlacement, String> adUnitMap = new EnumMap<>(NativePlacement.class);

    // Pending callback queues for in-flight requests (deduplication)
    private final Map<NativePlacement, List<ShowCallback>> pendingCallbacks = new EnumMap<>(NativePlacement.class);

    private NativeAdManager() {
        // Initialize default production ad units
        adUnitMap.put(NativePlacement.HOME, "ca-app-pub-2070129323138107/2374442509");
        adUnitMap.put(NativePlacement.GAMEPLAY, "ca-app-pub-2070129323138107/2374442509");
        adUnitMap.put(NativePlacement.PAUSE, "ca-app-pub-2070129323138107/2374442509");
        adUnitMap.put(NativePlacement.VICTORY, "ca-app-pub-2070129323138107/2374442509");
        adUnitMap.put(NativePlacement.ACHIEVEMENTS, "ca-app-pub-2070129323138107/9000311636");
        adUnitMap.put(NativePlacement.DAILY_CHALLENGE, "ca-app-pub-2070129323138107/4698104549");

        for (NativePlacement p : NativePlacement.values()) {
            screenGenerations.put(p, 1L);
            pendingCallbacks.put(p, new ArrayList<>());
        }
    }

    public static NativeAdManager getInstance() {
        if (instance == null) {
            synchronized (NativeAdManager.class) {
                if (instance == null) {
                    instance = new NativeAdManager();
                }
            }
        }
        return instance;
    }

    public void initialize(@NonNull Context context) {
        this.appContext = context.getApplicationContext();
        Log.d(TAG, "Initialized NativeAdManager with application context.");
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
            mainHandler.post(() -> disposeAllSlots(NativeAdSlot.DisposalReason.PREMIUM));
        } else if (!enabled) {
            mainHandler.post(() -> disposeAllSlots(NativeAdSlot.DisposalReason.REMOTE_CONFIG_DISABLED));
        }
    }

    public void setAdUnitId(@NonNull NativePlacement placement, @Nullable String adUnitId) {
        if (adUnitId != null && !adUnitId.trim().isEmpty()) {
            adUnitMap.put(placement, adUnitId.trim());
        }
    }

    public void setPremium(boolean premium) {
        this.isPremium = premium;
        Log.d(TAG, "setPremium: " + premium);
        if (premium) {
            mainHandler.post(() -> disposeAllSlots(NativeAdSlot.DisposalReason.PREMIUM));
        }
    }

    public void setCanRequestAds(boolean canRequest) {
        this.canRequestAds = canRequest;
        Log.d(TAG, "[NativeAd] setCanRequestAds: " + canRequest);
        if (!canRequest) {
            mainHandler.post(() -> {
                hideActiveOverlay();
                disposeAllSlots(NativeAdSlot.DisposalReason.CONSENT_REVOKED);
            });
        }
    }

    public boolean canRequestAds() {
        return canRequestAds;
    }

    @NonNull
    public String resolveAdUnitId(@NonNull NativePlacement placement, @Nullable String unitOverride) {
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
    //  SCREEN LIFECYCLE & GENERATION TOKEN MANAGEMENT
    // ═══════════════════════════════════════════════

    public synchronized long getScreenGeneration(@NonNull NativePlacement placement) {
        Long gen = screenGenerations.get(placement);
        return gen != null ? gen : 1L;
    }

    public synchronized void notifyScreenEntered(@NonNull NativePlacement placement) {
        long newGen = getScreenGeneration(placement) + 1;
        screenGenerations.put(placement, newGen);
        this.currentScreenPlacement = placement;
        Log.d(TAG, "[NativeAd] notifyScreenEntered: placement=" + placement + ", newScreenGen=" + newGen);

        // If another placement was active, detach it
        if (activeDisplayedPlacement != null && activeDisplayedPlacement != placement) {
            hideActiveOverlay();
        }
    }

    public synchronized void notifyScreenLeft(@NonNull NativePlacement placement) {
        long newGen = getScreenGeneration(placement) + 1;
        screenGenerations.put(placement, newGen);
        Log.d(TAG, "[NativeAd] notifyScreenLeft: placement=" + placement + ", invalidatedScreenGen=" + newGen);

        if (currentScreenPlacement == placement) {
            currentScreenPlacement = null;
        }

        // If this placement was displayed, detach and dispose
        if (activeDisplayedPlacement == placement) {
            hideActiveOverlay();
            disposeSlot(placement, NativeAdSlot.DisposalReason.SCREEN_LEFT);
        } else {
            // Also invalidate any pending/ready slot for this placement
            NativeAdSlot slot = slots.get(placement);
            if (slot != null && slot.getState() == NativeAdSlot.State.LOADING) {
                slot.dispose(NativeAdSlot.DisposalReason.SCREEN_LEFT);
            }
        }
    }

    // ═══════════════════════════════════════════════
    //  READINESS & DEDUPLICATION
    // ═══════════════════════════════════════════════

    public synchronized boolean isReady(@NonNull NativePlacement placement) {
        if (!isEnabled || isPremium || !canRequestAds) return false;
        NativeAdSlot slot = slots.get(placement);
        if (slot == null) return false;

        if (slot.isExpired(NativeAdSlot.NATIVE_CACHE_VALIDITY_MS)) {
            Log.i(TAG, "[NativeAd] Cached native ad expired for placement: " + placement);
            disposeSlot(placement, NativeAdSlot.DisposalReason.CACHE_EXPIRED);
            return false;
        }

        return slot.isLoaded();
    }

    // ═══════════════════════════════════════════════
    //  SHOWING & OPPORTUNITY-DRIVEN LOADING
    // ═══════════════════════════════════════════════

    public void showNativeAd(@NonNull final NativePlacement placement,
                             @Nullable final String adUnitIdOverride,
                             final int heightDp,
                             final int bottomMarginDp,
                             final int horizontalMarginDp,
                             @Nullable final ShowCallback callback) {
        mainHandler.post(() -> {
            try {
                if (!canRequestAds) {
                    Log.d(TAG, "[NativeAd] show skipped: consent not granted (canRequestAds=false) for " + placement);
                    if (callback != null) callback.onResult(false, "consent_blocked");
                    return;
                }

                if (!isEnabled) {
                    Log.d(TAG, "[NativeAd] show skipped: disabled by config for " + placement);
                    if (callback != null) callback.onResult(false, "disabled");
                    return;
                }

                if (isPremium) {
                    Log.d(TAG, "[NativeAd] show skipped: user is premium for " + placement);
                    if (callback != null) callback.onResult(false, "premium");
                    return;
                }

                final Activity activity = getCurrentActivity();
                if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
                    Log.w(TAG, "[NativeAd] show skipped: activity is null or finishing for " + placement);
                    if (callback != null) callback.onResult(false, "invalid_activity");
                    return;
                }

                // Ensure current screen is tracked
                if (currentScreenPlacement != placement) {
                    notifyScreenEntered(placement);
                }

                final long currentScreenGen = getScreenGeneration(placement);
                NativeAdSlot existingSlot = slots.get(placement);

                // Check 1: Expiration check
                if (existingSlot != null && existingSlot.isExpired(NativeAdSlot.NATIVE_CACHE_VALIDITY_MS)) {
                    Log.i(TAG, "[NativeAd] Slot expired for placement " + placement + ". Disposing.");
                    disposeSlot(placement, NativeAdSlot.DisposalReason.CACHE_EXPIRED);
                    existingSlot = null;
                }

                // Check 2: Already RENDERED for this exact screen visit -> Reuse & Deduplicate!
                if (existingSlot != null && existingSlot.getState() == NativeAdSlot.State.RENDERED
                        && existingSlot.getScreenGeneration() == currentScreenGen) {
                    Log.d(TAG, "[NativeAd] Already rendered for placement " + placement + " (screenGen=" + currentScreenGen + "). Reusing.");
                    // Ensure overlay is visible
                    if (activeOverlayContainer != null && activeDisplayedPlacement == placement) {
                        activeOverlayContainer.setVisibility(View.VISIBLE);
                    } else if (existingSlot.getNativeAd() != null) {
                        // Re-attach existing view
                        renderAdView(existingSlot, activity);
                    }
                    if (callback != null) callback.onResult(true, "already_rendered");
                    return;
                }

                // Check 3: Already READY (preloaded) for this exact screen visit -> Render immediately!
                if (existingSlot != null && existingSlot.getState() == NativeAdSlot.State.READY
                        && existingSlot.getScreenGeneration() == currentScreenGen
                        && existingSlot.getNativeAd() != null) {
                    Log.d(TAG, "[NativeAd] Consuming preloaded ad for placement " + placement);
                    renderAdView(existingSlot, activity);
                    if (callback != null) callback.onResult(true, "rendered_cached");
                    return;
                }

                // Check 4: Already LOADING for this exact screen visit -> Deduplicate in-flight request!
                if (existingSlot != null && existingSlot.getState() == NativeAdSlot.State.LOADING
                        && existingSlot.getScreenGeneration() == currentScreenGen) {
                    Log.d(TAG, "[NativeAd] Request already in flight for placement " + placement + " (screenGen=" + currentScreenGen + "). Queuing callback.");
                    if (callback != null) {
                        List<ShowCallback> cbList = pendingCallbacks.get(placement);
                        if (cbList != null) cbList.add(callback);
                    }
                    return;
                }

                // If previous slot belonged to a stale screen visit or different state, dispose it
                if (existingSlot != null) {
                    disposeSlot(placement, NativeAdSlot.DisposalReason.LOAD_REPLACED);
                }

                // Check 5: Start opportunity-driven native load
                final String resolvedUnitId = resolveAdUnitId(placement, adUnitIdOverride);
                final long loadGen = ++globalLoadGeneration;

                final NativeAdSlot newSlot = new NativeAdSlot(
                        placement,
                        resolvedUnitId,
                        loadGen,
                        currentScreenGen,
                        heightDp > 0 ? heightDp : placement.getDefaultHeightDp(),
                        bottomMarginDp >= 0 ? bottomMarginDp : placement.getDefaultBottomMarginDp(),
                        horizontalMarginDp >= 0 ? horizontalMarginDp : placement.getDefaultHorizontalMarginDp()
                );
                slots.put(placement, newSlot);

                if (callback != null) {
                    List<ShowCallback> cbList = pendingCallbacks.get(placement);
                    if (cbList != null) cbList.add(callback);
                }

                // Analytics: native_requested
                Bundle reqBundle = new Bundle();
                reqBundle.putString("placement", placement.getKey());
                reqBundle.putBoolean("test_mode", isTestMode || isTestAdUnit(resolvedUnitId));
                logAnalytics("native_requested", reqBundle);

                Log.d(TAG, "[NativeAd] Requesting native ad: placement=" + placement +
                        ", loadGen=" + loadGen + ", screenGen=" + currentScreenGen + ", unit=" + resolvedUnitId);

                // Configure NativeAdOptions with proper AdChoices placement
                NativeAdOptions adOptions = new NativeAdOptions.Builder()
                        .setAdChoicesPlacement(NativeAdOptions.ADCHOICES_TOP_RIGHT)
                        .setMediaAspectRatio(NativeAdOptions.NATIVE_MEDIA_ASPECT_RATIO_ANY)
                        .build();

                AdLoader adLoader = new AdLoader.Builder(activity, resolvedUnitId)
                        .forNativeAd(nativeAd -> {
                            mainHandler.post(() -> {
                                handleNativeAdLoaded(placement, newSlot, loadGen, currentScreenGen, nativeAd, activity);
                            });
                        })
                        .withAdListener(new AdListener() {
                            @Override
                            public void onAdFailedToLoad(@NonNull LoadAdError loadAdError) {
                                mainHandler.post(() -> {
                                    handleNativeAdFailedToLoad(placement, newSlot, loadGen, currentScreenGen, loadAdError);
                                });
                            }

                            @Override
                            public void onAdImpression() {
                                Log.i(TAG, "[NativeAd] onAdImpression confirmed by SDK for " + placement);
                                Bundle impBundle = new Bundle();
                                impBundle.putString("placement", placement.getKey());
                                logAnalytics("native_impression", impBundle);
                            }

                            @Override
                            public void onAdClicked() {
                                Log.d(TAG, "[NativeAd] onAdClicked for " + placement);
                                Bundle clickBundle = new Bundle();
                                clickBundle.putString("placement", placement.getKey());
                                logAnalytics("native_clicked", clickBundle);
                            }
                        })
                        .withNativeAdOptions(adOptions)
                        .build();

                adLoader.loadAd(new AdRequest.Builder().build());

            } catch (Exception e) {
                Log.e(TAG, "[NativeAd] Exception in showNativeAd for " + placement, e);
                notifyPendingCallbacks(placement, false, "exception: " + e.getMessage());
            }
        });
    }

    // ═══════════════════════════════════════════════
    //  STALE GENERATION & LOAD COMPLETION HANDLING
    // ═══════════════════════════════════════════════

    private void handleNativeAdLoaded(@NonNull NativePlacement placement,
                                      @NonNull NativeAdSlot slot,
                                      long loadGen,
                                      long expectedScreenGen,
                                      @NonNull NativeAd loadedAd,
                                      @NonNull Activity activity) {
        // Strict stale generation check:
        // Has the user navigated away from the screen that initiated this request?
        long liveScreenGen = getScreenGeneration(placement);
        boolean isCurrentScreen = (currentScreenPlacement == placement);

        if (liveScreenGen != expectedScreenGen || !isCurrentScreen) {
            Log.w(TAG, "[NativeAd] STALE GENERATION DETECTED: loadGen=" + loadGen +
                    ", expectedScreenGen=" + expectedScreenGen + ", liveScreenGen=" + liveScreenGen +
                    ", currentScreen=" + currentScreenPlacement + " (placement=" + placement + "). Discarding ad!");

            // Authoritative cleanup: destroy SDK ad object immediately
            try {
                loadedAd.destroy();
            } catch (Exception ignored) {}

            slot.dispose(NativeAdSlot.DisposalReason.STALE_GENERATION);
            logDisposal(placement, NativeAdSlot.DisposalReason.STALE_GENERATION, 0);

            if (slots.get(placement) == slot) {
                slots.remove(placement);
            }

            notifyPendingCallbacks(placement, false, "stale_generation");
            return;
        }

        if (isPremium) {
            Log.i(TAG, "[NativeAd] User became premium during load for " + placement + ". Discarding.");
            loadedAd.destroy();
            slot.dispose(NativeAdSlot.DisposalReason.PREMIUM);
            logDisposal(placement, NativeAdSlot.DisposalReason.PREMIUM, 0);
            if (slots.get(placement) == slot) slots.remove(placement);
            notifyPendingCallbacks(placement, false, "premium");
            return;
        }

        if (!isEnabled) {
            Log.i(TAG, "[NativeAd] Ads disabled during load for " + placement + ". Discarding.");
            loadedAd.destroy();
            slot.dispose(NativeAdSlot.DisposalReason.REMOTE_CONFIG_DISABLED);
            logDisposal(placement, NativeAdSlot.DisposalReason.REMOTE_CONFIG_DISABLED, 0);
            if (slots.get(placement) == slot) slots.remove(placement);
            notifyPendingCallbacks(placement, false, "disabled");
            return;
        }

        // Attach paid event listener to nativeAd
        loadedAd.setOnPaidEventListener(adValue -> {
            try {
                long valueMicros = adValue.getValueMicros();
                String currency = adValue.getCurrencyCode();
                int precision = adValue.getPrecisionType();

                Log.i(TAG, "[NativeAd] onPaidEvent (" + placement + "): " + valueMicros + " " + currency);

                Bundle paidBundle = new Bundle();
                paidBundle.putString("placement", placement.getKey());
                paidBundle.putLong("value_micros", valueMicros);
                paidBundle.putString("currency", currency != null ? currency : "USD");
                paidBundle.putInt("precision", precision);
                logAnalytics("native_paid", paidBundle);
            } catch (Exception e) {
                Log.w(TAG, "Error logging native paid event", e);
            }
        });

        slot.setNativeAd(loadedAd);
        long durationMs = System.currentTimeMillis() - slot.getLoadStartTimestampMs();

        Log.d(TAG, "[NativeAd] onAdLoaded success (placement=" + placement + ", duration=" + durationMs + "ms)");

        Bundle loadedBundle = new Bundle();
        loadedBundle.putString("placement", placement.getKey());
        loadedBundle.putLong("load_duration_ms", durationMs);
        logAnalytics("native_loaded", loadedBundle);

        // Render immediately into container
        boolean rendered = renderAdView(slot, activity);
        notifyPendingCallbacks(placement, rendered, rendered ? "loaded_and_rendered" : "render_failed");
    }

    private void handleNativeAdFailedToLoad(@NonNull NativePlacement placement,
                                            @NonNull NativeAdSlot slot,
                                            long loadGen,
                                            long expectedScreenGen,
                                            @NonNull LoadAdError loadAdError) {
        slot.setState(NativeAdSlot.State.FAILED);

        Log.e(TAG, "[NativeAd] onAdFailedToLoad (placement=" + placement + "): " +
                loadAdError.getMessage() + " (Code: " + loadAdError.getCode() + ")");

        Bundle failBundle = new Bundle();
        failBundle.putString("placement", placement.getKey());
        failBundle.putInt("error_code", loadAdError.getCode());
        failBundle.putString("normalized_reason", normalizeErrorCode(loadAdError.getCode()));
        logAnalytics("native_load_failed", failBundle);

        notifyPendingCallbacks(placement, false, "load_failed: " + loadAdError.getMessage());
    }

    // ═══════════════════════════════════════════════
    //  VIEW INFLATION & RENDERING
    // ═══════════════════════════════════════════════

    private boolean renderAdView(@NonNull NativeAdSlot slot, @NonNull Activity activity) {
        final NativeAd nativeAd = slot.getNativeAd();
        if (nativeAd == null) return false;

        final NativePlacement placement = slot.getPlacement();

        try {
            // Log render attempt
            Bundle renderBundle = new Bundle();
            renderBundle.putString("placement", placement.getKey());
            logAnalytics("native_render_attempt", renderBundle);

            // Hide/remove any previously attached overlay
            hideActiveOverlay();

            // Inflate NativeAdView from native_ad_layout.xml
            NativeAdView adView = (NativeAdView) activity.getLayoutInflater()
                    .inflate(R.layout.native_ad_layout, null);

            // Map views
            TextView headlineView = adView.findViewById(R.id.ad_headline);
            TextView bodyView = adView.findViewById(R.id.ad_body);
            Button ctaView = adView.findViewById(R.id.ad_call_to_action);
            ImageView iconView = adView.findViewById(R.id.ad_app_icon);

            adView.setHeadlineView(headlineView);
            adView.setBodyView(bodyView);
            adView.setCallToActionView(ctaView);
            adView.setIconView(iconView);

            // Populate Headline
            if (headlineView != null) {
                headlineView.setText(nativeAd.getHeadline());
            }

            // Populate Body
            if (bodyView != null) {
                if (nativeAd.getBody() == null) {
                    bodyView.setVisibility(View.INVISIBLE);
                } else {
                    bodyView.setText(nativeAd.getBody());
                    bodyView.setVisibility(View.VISIBLE);
                }
            }

            // Populate Call To Action
            if (ctaView != null) {
                if (nativeAd.getCallToAction() == null) {
                    ctaView.setVisibility(View.INVISIBLE);
                } else {
                    ctaView.setText(nativeAd.getCallToAction());
                    ctaView.setVisibility(View.VISIBLE);
                }
            }

            // Populate Icon
            if (iconView != null) {
                if (nativeAd.getIcon() == null || nativeAd.getIcon().getDrawable() == null) {
                    iconView.setVisibility(View.GONE);
                } else {
                    iconView.setImageDrawable(nativeAd.getIcon().getDrawable());
                    iconView.setVisibility(View.VISIBLE);
                }
            }

            // Register SDK NativeAd
            adView.setNativeAd(nativeAd);

            // Layout Container & Dimensions
            FrameLayout root = activity.findViewById(android.R.id.content);
            if (root == null) {
                Log.w(TAG, "[NativeAd] Root content view is null.");
                return false;
            }

            float density = activity.getResources().getDisplayMetrics().density;
            int heightPx = (int) (slot.getHeightDp() * density);
            int bottomMarginPx = (int) (slot.getBottomMarginDp() * density);
            int horizontalMarginPx = (int) (slot.getHorizontalMarginDp() * density);

            FrameLayout overlayContainer = new FrameLayout(activity);
            FrameLayout.LayoutParams containerParams = new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    heightPx
            );
            containerParams.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
            containerParams.bottomMargin = bottomMarginPx;
            containerParams.leftMargin = horizontalMarginPx;
            containerParams.rightMargin = horizontalMarginPx;

            FrameLayout.LayoutParams viewParams = new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
            );
            overlayContainer.addView(adView, viewParams);

            root.addView(overlayContainer, containerParams);
            root.bringChildToFront(overlayContainer);
            overlayContainer.bringToFront();
            overlayContainer.setVisibility(View.VISIBLE);

            this.activeOverlayContainer = overlayContainer;
            this.activeNativeAdView = adView;
            this.activeDisplayedPlacement = placement;

            slot.markRendered();

            Log.d(TAG, "[NativeAd] Rendered successfully: placement=" + placement +
                    ", height=" + heightPx + "px, bottomMargin=" + bottomMarginPx + "px");

            return true;

        } catch (Exception e) {
            Log.e(TAG, "[NativeAd] Exception rendering native ad for " + placement, e);
            slot.setState(NativeAdSlot.State.FAILED);
            logDisposal(placement, NativeAdSlot.DisposalReason.RENDER_FAILED, slot.getCacheAgeMs());
            return false;
        }
    }

    // ═══════════════════════════════════════════════
    //  HIDING & DISPOSAL
    // ═══════════════════════════════════════════════

    public void hideNativeAd(@Nullable final NativePlacement placement) {
        mainHandler.post(() -> {
            Log.d(TAG, "[NativeAd] hideNativeAd: placement=" + placement + ", active=" + activeDisplayedPlacement);
            hideActiveOverlay();

            if (placement != null) {
                disposeSlot(placement, NativeAdSlot.DisposalReason.SCREEN_LEFT);
            } else if (activeDisplayedPlacement != null) {
                disposeSlot(activeDisplayedPlacement, NativeAdSlot.DisposalReason.SCREEN_LEFT);
            }
        });
    }

    private void hideActiveOverlay() {
        if (activeOverlayContainer != null) {
            ViewGroup parent = (ViewGroup) activeOverlayContainer.getParent();
            if (parent != null) {
                parent.removeView(activeOverlayContainer);
            }
            activeOverlayContainer = null;
        }
        if (activeNativeAdView != null) {
            ViewGroup parent = (ViewGroup) activeNativeAdView.getParent();
            if (parent != null) {
                parent.removeView(activeNativeAdView);
            }
            activeNativeAdView = null;
        }
        activeDisplayedPlacement = null;
    }

    public synchronized void disposeSlot(@NonNull NativePlacement placement, @NonNull NativeAdSlot.DisposalReason reason) {
        NativeAdSlot slot = slots.get(placement);
        if (slot != null) {
            long cacheAgeMs = slot.getCacheAgeMs();
            slot.dispose(reason);
            slots.remove(placement);
            logDisposal(placement, reason, cacheAgeMs);
        }
    }

    public synchronized void disposeAllSlots(@NonNull NativeAdSlot.DisposalReason reason) {
        hideActiveOverlay();
        for (NativePlacement p : NativePlacement.values()) {
            disposeSlot(p, reason);
        }
    }

    // ═══════════════════════════════════════════════
    //  CALLBACK DISPATCH
    // ═══════════════════════════════════════════════

    private synchronized void notifyPendingCallbacks(@NonNull NativePlacement placement, boolean success, String message) {
        List<ShowCallback> cbList = pendingCallbacks.get(placement);
        if (cbList != null && !cbList.isEmpty()) {
            List<ShowCallback> copy = new ArrayList<>(cbList);
            cbList.clear();
            for (ShowCallback cb : copy) {
                try {
                    cb.onResult(success, message);
                } catch (Exception e) {
                    Log.w(TAG, "Error executing native callback: " + e.getMessage());
                }
            }
        }
    }

    // ═══════════════════════════════════════════════
    //  ANALYTICS & HELPERS
    // ═══════════════════════════════════════════════

    private void logDisposal(@NonNull NativePlacement placement,
                             @NonNull NativeAdSlot.DisposalReason reason,
                             long cacheAgeMs) {
        Bundle bundle = new Bundle();
        bundle.putString("placement", placement.getKey());
        bundle.putString("disposal_reason", reason.name().toLowerCase());
        bundle.putLong("cache_age_ms", cacheAgeMs);
        logAnalytics("native_inventory_disposed", bundle);
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
            Log.w(TAG, "Failed logging native analytics: " + eventName, e);
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
