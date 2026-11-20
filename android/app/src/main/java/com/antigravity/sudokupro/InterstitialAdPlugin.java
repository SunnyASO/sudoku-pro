package com.antigravity.sudokupro;

import android.app.Activity;
import android.util.Log;

import androidx.annotation.NonNull;

import com.antigravity.sudokupro.ads.InterstitialAdManager;
import com.antigravity.sudokupro.ads.InterstitialAdSlot;
import com.antigravity.sudokupro.ads.InterstitialPlacement;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * InterstitialAdPlugin — Capacitor bridge delegating directly to InterstitialAdManager.
 * Modeled on World Clock's placement-aware InterAdPair architecture.
 */
@CapacitorPlugin(name = "InterstitialAd")
public class InterstitialAdPlugin extends Plugin {

    private static final String TAG = "InterstitialAdPlugin";
    private InterstitialAdManager mManager;

    @Override
    public void load() {
        super.load();
        mManager = InterstitialAdManager.getInstance();
        if (getContext() != null) {
            mManager.initialize(getContext());
        }
        if (getActivity() != null) {
            mManager.updateCurrentActivity(getActivity());
        }
        Log.d(TAG, "InterstitialAdPlugin loaded successfully.");
    }

    @PluginMethod
    public void init(PluginCall call) {
        try {
            boolean enabled = call.getBoolean("enabled", true);
            boolean premium = call.getBoolean("isPremium", false);
            boolean testMode = call.getBoolean("testMode", false);

            if (getActivity() != null) {
                mManager.updateCurrentActivity(getActivity());
            }

            mManager.configure(enabled, premium, testMode);

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
    public void configureUnits(PluginCall call) {
        try {
            JSObject units = call.getObject("units");
            if (units != null) {
                for (InterstitialPlacement p : InterstitialPlacement.values()) {
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
    public void configurePolicies(PluginCall call) {
        try {
            long cooldownSeconds = call.getInt("cooldownSeconds", 45);
            int completionCap = call.getInt("completionCap", 8);
            int gameOverCap = call.getInt("gameOverCap", 8);

            mManager.configurePolicies(cooldownSeconds, completionCap, gameOverCap);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Exception in configurePolicies", e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void prepare(PluginCall call) {
        try {
            String placementStr = call.getString("placement");
            String adUnitId = call.getString("adUnitId");
            InterstitialPlacement placement = InterstitialPlacement.fromString(placementStr);

            if (getActivity() != null) {
                mManager.updateCurrentActivity(getActivity());
            }

            mManager.prepareInterstitial(placement, adUnitId, (prepared, message) -> {
                JSObject ret = new JSObject();
                ret.put("prepared", prepared);
                ret.put("placement", placement.name());
                ret.put("message", message);
                call.resolve(ret);
            });
        } catch (Exception e) {
            Log.e(TAG, "Exception in prepare", e);
            call.reject("Prepare failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void show(PluginCall call) {
        try {
            String placementStr = call.getString("placement");
            InterstitialPlacement placement = InterstitialPlacement.fromString(placementStr);
            Activity activity = getActivity();

            mManager.showInterstitial(placement, activity, (shown, dismissed, reason) -> {
                JSObject ret = new JSObject();
                ret.put("shown", shown);
                ret.put("dismissed", dismissed);
                ret.put("reason", reason != null ? reason : "");
                ret.put("placement", placement.name());
                call.resolve(ret);
            });
        } catch (Exception e) {
            Log.e(TAG, "Exception in show", e);
            call.reject("Show failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void isReady(PluginCall call) {
        try {
            String placementStr = call.getString("placement");
            InterstitialPlacement placement = InterstitialPlacement.fromString(placementStr);
            boolean ready = mManager.isReady(placement);

            JSObject ret = new JSObject();
            ret.put("ready", ready);
            ret.put("placement", placement.name());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Exception in isReady", e);
            call.reject("isReady failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void isEligible(PluginCall call) {
        try {
            String placementStr = call.getString("placement");
            InterstitialPlacement placement = InterstitialPlacement.fromString(placementStr);
            boolean eligible = mManager.isEligible(placement);

            JSObject ret = new JSObject();
            ret.put("eligible", eligible);
            ret.put("placement", placement.name());
            ret.put("remainingCooldownMs", mManager.getRemainingCooldownMs());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Exception in isEligible", e);
            call.reject("isEligible failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void dispose(PluginCall call) {
        try {
            String reasonStr = call.getString("reason");
            InterstitialAdSlot.DisposalReason reason = InterstitialAdSlot.DisposalReason.OPPORTUNITY_LEFT;
            if (reasonStr != null) {
                try {
                    reason = InterstitialAdSlot.DisposalReason.valueOf(reasonStr.toUpperCase());
                } catch (IllegalArgumentException ignored) {}
            }

            mManager.disposeCurrentSlot(reason);
            JSObject ret = new JSObject();
            ret.put("disposed", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Exception in dispose", e);
            call.reject("Dispose failed: " + e.getMessage());
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

    @PluginMethod
    public void configurePlacementFlags(PluginCall call) {
        try {
            JSObject flags = call.getObject("flags");
            if (flags != null) {
                for (InterstitialPlacement p : InterstitialPlacement.values()) {
                    if (flags.has(p.name())) {
                        boolean enabled = flags.optBoolean(p.name(), true);
                        mManager.setPlacementEnabled(p, enabled);
                    }
                }
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Exception in configurePlacementFlags", e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void setPurchaseActive(PluginCall call) {
        try {
            boolean active = call.getBoolean("active", false);
            mManager.setPurchaseActive(active);
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
            mManager.setSharedFullScreenLocked(locked);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Exception in setSharedFullScreenLocked", e);
            call.reject(e.getMessage());
        }
    }
}
