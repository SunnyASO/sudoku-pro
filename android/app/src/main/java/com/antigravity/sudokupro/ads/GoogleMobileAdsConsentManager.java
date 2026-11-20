package com.antigravity.sudokupro.ads;

import android.app.Activity;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.android.gms.ads.MobileAds;
import com.google.android.ump.ConsentDebugSettings;
import com.google.android.ump.ConsentForm;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.FormError;
import com.google.android.ump.UserMessagingPlatform;
import com.google.firebase.analytics.FirebaseAnalytics;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Authoritative Google Mobile Ads Consent Manager backed by Google User Messaging Platform (UMP) 4.0.0.
 *
 * Enforces:
 * 1. Authoritative consent lifecycle: gatherConsent() on startup before any ad requests.
 * 2. canRequestAds() gating across App Open, Rewarded, Native, Interstitial, and Banner.
 * 3. Privacy Options requirement tracking and on-demand form presentation.
 * 4. Idempotent MobileAds.initialize() execution once consent allows.
 * 5. Debug geography containment strictly to BuildConfig.DEBUG or explicit test calls.
 * 6. Non-blocking error handling (fail-open for app UX, respecting disk-cached consent).
 * 7. Comprehensive privacy-safe Firebase Analytics telemetry.
 */
public class GoogleMobileAdsConsentManager {

    private static final String TAG = "ConsentManager";
    private static volatile GoogleMobileAdsConsentManager instance;

    private final Context appContext;
    private final ConsentInformation consentInformation;
    private final AtomicBoolean isMobileAdsInitialized = new AtomicBoolean(false);

    private int debugGeography = ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_DISABLED;
    private String testDeviceId = null;

    public interface OnConsentGatheredListener {
        void onConsentGathered(@Nullable FormError error);
    }

    public static GoogleMobileAdsConsentManager getInstance(@NonNull Context context) {
        if (instance == null) {
            synchronized (GoogleMobileAdsConsentManager.class) {
                if (instance == null) {
                    instance = new GoogleMobileAdsConsentManager(context.getApplicationContext());
                }
            }
        }
        return instance;
    }

    private GoogleMobileAdsConsentManager(@NonNull Context context) {
        this.appContext = context;
        this.consentInformation = UserMessagingPlatform.getConsentInformation(context);
    }

    private boolean isDebuggable() {
        return (appContext.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    public void setDebugGeography(int geography) {
        this.debugGeography = geography;
    }

    public void setTestDeviceId(@Nullable String id) {
        this.testDeviceId = id;
    }

    /**
     * Authoritative check whether the Google Mobile Ads SDK may request ads under current consent state.
     */
    public boolean canRequestAds() {
        return consentInformation != null && consentInformation.canRequestAds();
    }

    /**
     * Determines whether the user must have access to Privacy Options (e.g. EEA / GDPR users).
     */
    public boolean isPrivacyOptionsRequired() {
        return consentInformation != null &&
                consentInformation.getPrivacyOptionsRequirementStatus() ==
                        ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
    }

    /**
     * Returns string representation of current UMP consent status.
     */
    public String getConsentStatus() {
        if (consentInformation == null) return "UNKNOWN";
        switch (consentInformation.getConsentStatus()) {
            case ConsentInformation.ConsentStatus.NOT_REQUIRED:
                return "NOT_REQUIRED";
            case ConsentInformation.ConsentStatus.REQUIRED:
                return "REQUIRED";
            case ConsentInformation.ConsentStatus.OBTAINED:
                return "OBTAINED";
            case ConsentInformation.ConsentStatus.UNKNOWN:
            default:
                return "UNKNOWN";
        }
    }

    /**
     * Returns string representation of Privacy Options requirement status.
     */
    public String getPrivacyOptionsRequirementStatus() {
        if (consentInformation == null) return "UNKNOWN";
        switch (consentInformation.getPrivacyOptionsRequirementStatus()) {
            case ConsentInformation.PrivacyOptionsRequirementStatus.NOT_REQUIRED:
                return "NOT_REQUIRED";
            case ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED:
                return "REQUIRED";
            case ConsentInformation.PrivacyOptionsRequirementStatus.UNKNOWN:
            default:
                return "UNKNOWN";
        }
    }

    /**
     * Central entry point to gather consent at application launch.
     */
    public void gatherConsent(@NonNull final Activity activity, @NonNull final OnConsentGatheredListener listener) {
        Bundle startBundle = new Bundle();
        logAnalytics("consent_info_update_started", startBundle);
        Log.d(TAG, "[UMP] Requesting consent info update...");

        ConsentRequestParameters.Builder paramsBuilder = new ConsentRequestParameters.Builder();

        // Restrict debug settings strictly to debuggable builds
        if (isDebuggable()) {
            ConsentDebugSettings.Builder debugBuilder = new ConsentDebugSettings.Builder(appContext);
            if (debugGeography != ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_DISABLED) {
                debugBuilder.setDebugGeography(debugGeography);
            }
            if (testDeviceId != null && !testDeviceId.trim().isEmpty()) {
                debugBuilder.addTestDeviceHashedId(testDeviceId.trim());
            }
            paramsBuilder.setConsentDebugSettings(debugBuilder.build());
        }

        ConsentRequestParameters params = paramsBuilder.build();

        consentInformation.requestConsentInfoUpdate(
                activity,
                params,
                () -> {
                    Log.d(TAG, "[UMP] Consent info update succeeded. Status=" + getConsentStatus() +
                            ", canRequestAds=" + canRequestAds() +
                            ", privacyOptionsRequired=" + isPrivacyOptionsRequired());

                    Bundle compBundle = new Bundle();
                    compBundle.putString("consent_status", getConsentStatus());
                    compBundle.putBoolean("can_request_ads", canRequestAds());
                    compBundle.putBoolean("privacy_options_required", isPrivacyOptionsRequired());
                    logAnalytics("consent_info_update_completed", compBundle);

                    // Check if prior-session consent permits ad requests immediately upon update success
                    if (canRequestAds()) {
                        initializeMobileAds(appContext);
                        updateAdManagersConsent(true);
                    }

                    UserMessagingPlatform.loadAndShowConsentFormIfRequired(
                            activity,
                            formError -> {
                                if (formError != null) {
                                    Log.w(TAG, "[UMP] Consent form dismissed with error: " +
                                            formError.getMessage() + " (Code: " + formError.getErrorCode() + ")");
                                    Bundle errBundle = new Bundle();
                                    errBundle.putInt("error_code", formError.getErrorCode());
                                    errBundle.putString("error_message", formError.getMessage());
                                    logAnalytics("consent_form_dismissed", errBundle);
                                } else {
                                    Log.d(TAG, "[UMP] Consent form completed/not required. Status=" +
                                            getConsentStatus() + ", canRequestAds=" + canRequestAds());
                                    Bundle okBundle = new Bundle();
                                    okBundle.putString("consent_status", getConsentStatus());
                                    okBundle.putBoolean("can_request_ads", canRequestAds());
                                    logAnalytics("consent_form_dismissed", okBundle);
                                }

                                boolean canRequest = canRequestAds();
                                if (canRequest) {
                                    initializeMobileAds(appContext);
                                    logAnalytics("consent_ads_allowed", new Bundle());
                                } else {
                                    logAnalytics("consent_ads_blocked", new Bundle());
                                }
                                updateAdManagersConsent(canRequest);

                                listener.onConsentGathered(formError);
                            }
                    );
                },
                requestConsentError -> {
                    Log.w(TAG, "[UMP] Consent info update failed: " +
                            requestConsentError.getMessage() + " (Code: " + requestConsentError.getErrorCode() + ")");
                    Bundle failBundle = new Bundle();
                    failBundle.putInt("error_code", requestConsentError.getErrorCode());
                    failBundle.putString("error_message", requestConsentError.getMessage());
                    logAnalytics("consent_info_update_failed", failBundle);

                    // Under Google UMP guidance, if request fails (e.g. offline/network),
                    // evaluate canRequestAds() from previously persisted disk state.
                    boolean canRequest = canRequestAds();
                    if (canRequest) {
                        initializeMobileAds(appContext);
                        logAnalytics("consent_ads_allowed", new Bundle());
                    } else {
                        logAnalytics("consent_ads_blocked", new Bundle());
                    }
                    updateAdManagersConsent(canRequest);

                    listener.onConsentGathered(requestConsentError);
                }
        );
    }

    /**
     * Presents the Privacy Options form on demand (e.g. from app Settings).
     */
    public void showPrivacyOptionsForm(@NonNull final Activity activity,
                                       @NonNull final ConsentForm.OnConsentFormDismissedListener listener) {
        Bundle openBundle = new Bundle();
        logAnalytics("privacy_options_opened", openBundle);
        Log.d(TAG, "[UMP] Presenting privacy options form...");

        UserMessagingPlatform.showPrivacyOptionsForm(activity, formError -> {
            if (formError != null) {
                Log.w(TAG, "[UMP] Privacy options form error: " +
                        formError.getMessage() + " (Code: " + formError.getErrorCode() + ")");
            }
            boolean canRequest = canRequestAds();
            if (canRequest) {
                initializeMobileAds(appContext);
                logAnalytics("consent_ads_allowed", new Bundle());
            } else {
                logAnalytics("consent_ads_blocked", new Bundle());
            }
            updateAdManagersConsent(canRequest);

            listener.onConsentFormDismissed(formError);
        });
    }

    /**
     * Resets consent state to UNKNOWN. Intended for development and debug testing only.
     */
    public void resetConsent() {
        if (consentInformation != null) {
            consentInformation.reset();
            Log.i(TAG, "[UMP] Consent state reset to UNKNOWN.");
            updateAdManagersConsent(false);
        }
    }

    /**
     * Propagates authoritative canRequestAds state into all native ad format managers.
     */
    public void updateAdManagersConsent(boolean canRequest) {
        Log.i(TAG, "[UMP] Propagating canRequestAds=" + canRequest + " to all native ad managers.");
        try {
            SudokuAppOpenManager.getInstance().setCanRequestAds(canRequest);
        } catch (Exception e) {
            Log.w(TAG, "Error updating AppOpenManager consent", e);
        }
        try {
            RewardedAdManager.getInstance().setCanRequestAds(canRequest);
        } catch (Exception e) {
            Log.w(TAG, "Error updating RewardedAdManager consent", e);
        }
        try {
            NativeAdManager.getInstance().setCanRequestAds(canRequest);
        } catch (Exception e) {
            Log.w(TAG, "Error updating NativeAdManager consent", e);
        }
        try {
            InterstitialAdManager.getInstance().setCanRequestAds(canRequest);
        } catch (Exception e) {
            Log.w(TAG, "Error updating InterstitialAdManager consent", e);
        }
    }

    /**
     * Idempotent initialization of MobileAds SDK.
     */
    public void initializeMobileAds(@NonNull Context context) {
        if (isMobileAdsInitialized.compareAndSet(false, true)) {
            Log.i(TAG, "[UMP] Initializing MobileAds SDK (canRequestAds=true)...");
            MobileAds.initialize(context, initializationStatus -> {
                Log.i(TAG, "[UMP] MobileAds SDK initialization completed: " + initializationStatus);
            });
            logAnalytics("mobile_ads_initialized", new Bundle());
        }
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
}
