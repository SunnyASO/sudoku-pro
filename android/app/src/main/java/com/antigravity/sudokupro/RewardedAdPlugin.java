package com.antigravity.sudokupro;

import android.app.Activity;
import android.util.Log;

import androidx.annotation.NonNull;

import com.antigravity.sudokupro.ads.RewardedAdManager;
import com.antigravity.sudokupro.ads.RewardedAdSlot;
import com.antigravity.sudokupro.ads.RewardedPlacement;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RewardedAd")
public class RewardedAdPlugin extends Plugin {

    private static final String TAG = "RewardedAdPlugin";
    private RewardedAdManager mManager;

    @Override
    public void load() {
        super.load();
        mManager = RewardedAdManager.getInstance();
        if (getContext() != null) {
            mManager.initialize(getContext());
        }
        if (getActivity() != null) {
            mManager.updateCurrentActivity(getActivity());
        }
        Log.d(TAG, "RewardedAdPlugin loaded successfully.");
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
                for (RewardedPlacement p : RewardedPlacement.values()) {
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
    public void prepare(PluginCall call) {
        try {
            String placementStr = call.getString("placement");
            String adUnitId = call.getString("adUnitId");
            RewardedPlacement placement = RewardedPlacement.fromString(placementStr);

            if (getActivity() != null) {
                mManager.updateCurrentActivity(getActivity());
            }

            mManager.prepareRewarded(placement, adUnitId, (prepared, message) -> {
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
    public void isReady(PluginCall call) {
        try {
            String placementStr = call.getString("placement");
            RewardedPlacement placement = RewardedPlacement.fromString(placementStr);
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
    public void show(PluginCall call) {
        try {
            String placementStr = call.getString("placement");
            RewardedPlacement placement = RewardedPlacement.fromString(placementStr);
            Activity activity = getActivity();

            mManager.showRewarded(placement, activity, (shown, rewardEarned, rewardType, rewardAmount, reason) -> {
                JSObject ret = new JSObject();
                ret.put("shown", shown);
                ret.put("rewardEarned", rewardEarned);
                ret.put("rewardType", rewardType != null ? rewardType : "");
                ret.put("rewardAmount", rewardAmount);
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
    public void dispose(PluginCall call) {
        try {
            String reasonStr = call.getString("reason");
            RewardedAdSlot.DisposalReason reason = RewardedAdSlot.DisposalReason.OPPORTUNITY_LEFT;
            if (reasonStr != null) {
                try {
                    reason = RewardedAdSlot.DisposalReason.valueOf(reasonStr.toUpperCase());
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
