package com.antigravity.sudokupro;

import android.app.Activity;
import android.util.Log;

import androidx.annotation.Nullable;

import com.antigravity.sudokupro.ads.GoogleMobileAdsConsentManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.ump.ConsentDebugSettings;
import com.google.android.ump.FormError;

/**
 * Capacitor Plugin bridging Google Mobile Ads Consent Manager (UMP 4.0.0) to JavaScript.
 */
@CapacitorPlugin(name = "Consent")
public class ConsentPlugin extends Plugin {

    private static final String TAG = "ConsentPlugin";
    private GoogleMobileAdsConsentManager mConsentManager;

    @Override
    public void load() {
        super.load();
        if (getContext() != null) {
            mConsentManager = GoogleMobileAdsConsentManager.getInstance(getContext());
        }
    }

    private GoogleMobileAdsConsentManager getConsentManager() {
        if (mConsentManager == null && getContext() != null) {
            mConsentManager = GoogleMobileAdsConsentManager.getInstance(getContext());
        }
        return mConsentManager;
    }

    @PluginMethod
    public void initializeConsent(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            call.reject("Activity is not available");
            return;
        }

        final GoogleMobileAdsConsentManager manager = getConsentManager();
        if (manager == null) {
            call.reject("ConsentManager is not initialized");
            return;
        }

        // Optional debug overrides passed from JS during testing
        String debugGeoStr = call.getString("debugGeography", null);
        if (debugGeoStr != null) {
            if ("EEA".equalsIgnoreCase(debugGeoStr)) {
                manager.setDebugGeography(ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_EEA);
            } else if ("NOT_EEA".equalsIgnoreCase(debugGeoStr)) {
                manager.setDebugGeography(ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_NOT_EEA);
            } else if ("DISABLED".equalsIgnoreCase(debugGeoStr)) {
                manager.setDebugGeography(ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_DISABLED);
            }
        }
        String testDeviceId = call.getString("testDeviceId", null);
        if (testDeviceId != null) {
            manager.setTestDeviceId(testDeviceId);
        }

        activity.runOnUiThread(() -> {
            manager.gatherConsent(activity, formError -> {
                JSObject ret = new JSObject();
                ret.put("canRequestAds", manager.canRequestAds());
                ret.put("isPrivacyOptionsRequired", manager.isPrivacyOptionsRequired());
                ret.put("consentStatus", manager.getConsentStatus());
                ret.put("privacyRequirementStatus", manager.getPrivacyOptionsRequirementStatus());
                if (formError != null) {
                    ret.put("errorCode", formError.getErrorCode());
                    ret.put("errorMessage", formError.getMessage());
                }
                call.resolve(ret);
            });
        });
    }

    @PluginMethod
    public void getConsentStatus(final PluginCall call) {
        final GoogleMobileAdsConsentManager manager = getConsentManager();
        if (manager == null) {
            call.reject("ConsentManager is not initialized");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("canRequestAds", manager.canRequestAds());
        ret.put("isPrivacyOptionsRequired", manager.isPrivacyOptionsRequired());
        ret.put("consentStatus", manager.getConsentStatus());
        ret.put("privacyRequirementStatus", manager.getPrivacyOptionsRequirementStatus());
        call.resolve(ret);
    }

    @PluginMethod
    public void canRequestAds(final PluginCall call) {
        final GoogleMobileAdsConsentManager manager = getConsentManager();
        JSObject ret = new JSObject();
        ret.put("canRequestAds", manager != null && manager.canRequestAds());
        call.resolve(ret);
    }

    @PluginMethod
    public void isPrivacyOptionsRequired(final PluginCall call) {
        final GoogleMobileAdsConsentManager manager = getConsentManager();
        JSObject ret = new JSObject();
        ret.put("required", manager != null && manager.isPrivacyOptionsRequired());
        call.resolve(ret);
    }

    @PluginMethod
    public void showPrivacyOptions(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            call.reject("Activity is not available");
            return;
        }

        final GoogleMobileAdsConsentManager manager = getConsentManager();
        if (manager == null) {
            call.reject("ConsentManager is not initialized");
            return;
        }

        activity.runOnUiThread(() -> {
            manager.showPrivacyOptionsForm(activity, formError -> {
                JSObject ret = new JSObject();
                ret.put("success", formError == null);
                ret.put("canRequestAds", manager.canRequestAds());
                ret.put("isPrivacyOptionsRequired", manager.isPrivacyOptionsRequired());
                if (formError != null) {
                    ret.put("errorCode", formError.getErrorCode());
                    ret.put("errorMessage", formError.getMessage());
                }
                call.resolve(ret);
            });
        });
    }

    @PluginMethod
    public void resetConsent(final PluginCall call) {
        final GoogleMobileAdsConsentManager manager = getConsentManager();
        if (manager != null) {
            manager.resetConsent();
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("canRequestAds", false);
            call.resolve(ret);
        } else {
            call.reject("ConsentManager is null");
        }
    }
}
