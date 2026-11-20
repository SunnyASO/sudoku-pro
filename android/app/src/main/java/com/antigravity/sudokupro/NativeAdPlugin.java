package com.antigravity.sudokupro;

import android.app.Activity;
import android.util.Log;

import androidx.annotation.NonNull;

import com.antigravity.sudokupro.ads.NativeAdManager;
import com.antigravity.sudokupro.ads.NativeAdSlot;
import com.antigravity.sudokupro.ads.NativePlacement;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * NativeAdPlugin — Capacitor bridge delegating directly to NativeAdManager.
 * Modeled on World Clock's placement-aware NativeAdPair architecture.
 */
@CapacitorPlugin(name = "NativeAd")
public class NativeAdPlugin extends Plugin {

    private static final String TAG = "NativeAdPlugin";
    private NativeAdManager mManager;

    @Override
    public void load() {
        super.load();
        mManager = NativeAdManager.getInstance();
        if (getContext() != null) {
            mManager.initialize(getContext());
        }
        if (getActivity() != null) {
            mManager.updateCurrentActivity(getActivity());
        }
        Log.d(TAG, "NativeAdPlugin loaded successfully.");
    }

    @PluginMethod
    public void showNativeAd(PluginCall call) {
        try {
            String placementStr = call.getString("placement");
            if (placementStr == null || placementStr.isEmpty()) {
                placementStr = call.getString("screenName", "home");
            }
            NativePlacement placement = NativePlacement.fromString(placementStr);

            String adUnitId = call.getString("adUnitId");
            int heightDp = call.getInt("heightDp", placement.getDefaultHeightDp());
            int bottomMarginDp = call.getInt("bottomMarginDp", placement.getDefaultBottomMarginDp());
            int horizontalMarginDp = call.getInt("horizontalMarginDp", placement.getDefaultHorizontalMarginDp());

            if (getActivity() != null) {
                mManager.updateCurrentActivity(getActivity());
            }

            mManager.showNativeAd(placement, adUnitId, heightDp, bottomMarginDp, horizontalMarginDp, (shown, message) -> {
                if (shown) {
                    JSObject ret = new JSObject();
                    ret.put("shown", true);
                    ret.put("placement", placement.name());
                    ret.put("message", message);
                    call.resolve(ret);
                } else {
                    Log.w(TAG, "[NativeAd] showNativeAd failed for " + placement + ": " + message);
                    call.reject("Native ad show failed: " + message);
                }
            });

        } catch (Exception e) {
            Log.e(TAG, "Exception in showNativeAd", e);
            call.reject("showNativeAd exception: " + e.getMessage());
        }
    }

    @PluginMethod
    public void hideNativeAd(PluginCall call) {
        try {
            String placementStr = call.getString("placement");
            NativePlacement placement = placementStr != null && !placementStr.isEmpty()
                    ? NativePlacement.fromString(placementStr)
                    : null;

            if (getActivity() != null) {
                mManager.updateCurrentActivity(getActivity());
            }

            mManager.hideNativeAd(placement);

            JSObject ret = new JSObject();
            ret.put("hidden", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Exception in hideNativeAd", e);
            call.reject("hideNativeAd exception: " + e.getMessage());
        }
    }

    @PluginMethod
    public void enterScreen(PluginCall call) {
        try {
            String placementStr = call.getString("placement");
            if (placementStr == null || placementStr.isEmpty()) {
                placementStr = call.getString("screenName", "home");
            }
            NativePlacement placement = NativePlacement.fromString(placementStr);

            if (getActivity() != null) {
                mManager.updateCurrentActivity(getActivity());
            }

            mManager.notifyScreenEntered(placement);

            JSObject ret = new JSObject();
            ret.put("entered", placement.name());
            ret.put("screenGeneration", mManager.getScreenGeneration(placement));
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Exception in enterScreen", e);
            call.reject("enterScreen exception: " + e.getMessage());
        }
    }

    @PluginMethod
    public void leaveScreen(PluginCall call) {
        try {
            String placementStr = call.getString("placement");
            if (placementStr == null || placementStr.isEmpty()) {
                placementStr = call.getString("screenName", "home");
            }
            NativePlacement placement = NativePlacement.fromString(placementStr);

            mManager.notifyScreenLeft(placement);

            JSObject ret = new JSObject();
            ret.put("left", placement.name());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Exception in leaveScreen", e);
            call.reject("leaveScreen exception: " + e.getMessage());
        }
    }

    @PluginMethod
    public void isReady(PluginCall call) {
        try {
            String placementStr = call.getString("placement");
            NativePlacement placement = NativePlacement.fromString(placementStr);
            boolean ready = mManager.isReady(placement);

            JSObject ret = new JSObject();
            ret.put("ready", ready);
            ret.put("placement", placement.name());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Exception in isReady", e);
            call.reject("isReady exception: " + e.getMessage());
        }
    }

    @PluginMethod
    public void configure(PluginCall call) {
        try {
            boolean enabled = call.getBoolean("enabled", true);
            boolean premium = call.getBoolean("isPremium", false);
            boolean testMode = call.getBoolean("testMode", false);

            if (getActivity() != null) {
                mManager.updateCurrentActivity(getActivity());
            }

            mManager.configure(enabled, premium, testMode);

            JSObject ret = new JSObject();
            ret.put("configured", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Exception in configure", e);
            call.reject("configure exception: " + e.getMessage());
        }
    }

    @PluginMethod
    public void configureUnits(PluginCall call) {
        try {
            JSObject units = call.getObject("units");
            if (units != null) {
                for (NativePlacement p : NativePlacement.values()) {
                    String unitId = units.getString(p.name());
                    if (unitId != null && !unitId.isEmpty()) {
                        mManager.setAdUnitId(p, unitId);
                    }
                }
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Exception in configureUnits", e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void setPremium(PluginCall call) {
        try {
            boolean premium = call.getBoolean("isPremium", false);
            mManager.setPremium(premium);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Exception in setPremium", e);
            call.reject(e.getMessage());
        }
    }
}
