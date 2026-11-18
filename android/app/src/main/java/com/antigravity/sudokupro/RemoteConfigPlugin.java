package com.antigravity.sudokupro;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.firebase.remoteconfig.FirebaseRemoteConfig;
import com.google.firebase.remoteconfig.FirebaseRemoteConfigSettings;
import com.google.firebase.remoteconfig.FirebaseRemoteConfigValue;

import java.util.HashMap;
import java.util.Map;

@CapacitorPlugin(name = "RemoteConfig")
public class RemoteConfigPlugin extends Plugin {

    private static final String TAG = "RemoteConfigPlugin";
    private FirebaseRemoteConfig mFirebaseRemoteConfig;

    @Override
    public void load() {
        super.load();
        try {
            mFirebaseRemoteConfig = FirebaseRemoteConfig.getInstance();

            FirebaseRemoteConfigSettings configSettings = new FirebaseRemoteConfigSettings.Builder()
                    .setMinimumFetchIntervalInSeconds(60) // 60s allows fast testing and live updates
                    .build();
            mFirebaseRemoteConfig.setConfigSettingsAsync(configSettings);

            boolean isDebug = false;
            try {
                if (getContext() != null) {
                    isDebug = (getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
                }
            } catch (Exception ignored) {}

            // In-app defaults matching Firebase Console keys
            Map<String, Object> defaults = new HashMap<>();
            defaults.put("ads_enabled", true);
            defaults.put("ad_test_mode_enabled", isDebug);
            defaults.put("banner_ads_enabled", true);
            defaults.put("home_banner_enabled", false);
            defaults.put("home_banner_fallback_enabled", true);
            defaults.put("gameplay_banner_enabled", true);
            defaults.put("native_ads_enabled", true);
            defaults.put("home_native_enabled", true);
            defaults.put("home_native_ad_enabled", true);
            defaults.put("gameplay_native_ad_enabled", true);
            defaults.put("gameplay_native_min_height_dp", 720);
            defaults.put("achievements_native_enabled", true);
            defaults.put("daily_challenge_native_enabled", true);
            defaults.put("native_ad_height_dp", 120);
            defaults.put("native_ad_bottom_margin_dp", 16);
            defaults.put("interstitial_ads_enabled", true);
            defaults.put("completion_interstitial_enabled", true);
            defaults.put("new_game_interstitial_enabled", true);
            defaults.put("abandon_interstitial_enabled", true);
            defaults.put("game_over_interstitial_enabled", true);
            defaults.put("game_over_interstitial_session_cap", 5);
            defaults.put("fullscreen_ad_cooldown_seconds", 90);
            defaults.put("completion_interstitial_every", 1);
            defaults.put("completion_interstitial_session_cap", 5);
            defaults.put("rewarded_ads_enabled", true);
            defaults.put("rewarded_hint_enabled", true);
            defaults.put("mistake_rescue_rewarded_enabled", true);
            defaults.put("daily_challenge_rewarded_enabled", true);
            defaults.put("bonus_rewarded_enabled", true);
            defaults.put("app_open_ads_enabled", true);
            defaults.put("app_open_min_interval_seconds", 120);
            defaults.put("app_open_session_cap", 4);
            defaults.put("app_open_background_threshold_seconds", 45);
            defaults.put("push_notifications_enabled", false);
            defaults.put("push_topic_general_enabled", false);
            defaults.put("starting_free_hints", 3);
            defaults.put("pause_native_ad_enabled", true);
            defaults.put("auto_check_rewarded_enabled", true);
            defaults.put("auto_check_per_puzzle_limit", 1);
            defaults.put("theme_rewarded_unlock_enabled", true);
            defaults.put("theme_unlock_duration_hours", 24);
            defaults.put("review_prompt_enabled", true);
            defaults.put("review_min_completed_puzzles", 2);
            defaults.put("review_min_sessions", 2);
            defaults.put("review_first_cooldown_days", 7);
            defaults.put("review_second_cooldown_days", 21);
            defaults.put("review_later_cooldown_days", 45);
            defaults.put("review_max_local_attempts", 5);
            defaults.put("review_trigger_perfect_solve", true);
            defaults.put("review_trigger_daily_challenge", true);
            defaults.put("review_trigger_achievement", true);
            defaults.put("review_trigger_personal_best", true);
            defaults.put("app_update_enabled", true);
            defaults.put("minimum_supported_version_code", 19);
            defaults.put("force_update_below_version_code", 19);
            defaults.put("flexible_update_below_version_code", 20);

            mFirebaseRemoteConfig.setDefaultsAsync(defaults);
            Log.d(TAG, "Firebase Remote Config initialized with safe defaults.");
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize Firebase Remote Config", e);
        }
    }

    private boolean isDebugBuild() {
        try {
            if (getContext() != null) {
                return (getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
            }
        } catch (Exception ignored) {}
        return false;
    }

    private JSObject getAllConfigAsJSObject() {
        JSObject obj = new JSObject();
        boolean isDebug = isDebugBuild();
        obj.put("is_debug_build", isDebug);
        if (mFirebaseRemoteConfig == null) {
            if (isDebug) {
                obj.put("ad_test_mode_enabled", true);
            }
            return obj;
        }

        try {
            Map<String, FirebaseRemoteConfigValue> all = mFirebaseRemoteConfig.getAll();
            for (Map.Entry<String, FirebaseRemoteConfigValue> entry : all.entrySet()) {
                String key = entry.getKey();
                FirebaseRemoteConfigValue val = entry.getValue();
                String stringVal = val.asString();

                if ("true".equalsIgnoreCase(stringVal) || "false".equalsIgnoreCase(stringVal)) {
                    obj.put(key, val.asBoolean());
                } else {
                    try {
                        long longVal = val.asLong();
                        // check if it was truly a number
                        if (stringVal.matches("-?\\d+")) {
                            obj.put(key, longVal);
                        } else {
                            obj.put(key, stringVal);
                        }
                    } catch (Exception notLong) {
                        try {
                            double doubleVal = val.asDouble();
                            obj.put(key, doubleVal);
                        } catch (Exception notDouble) {
                            obj.put(key, stringVal);
                        }
                    }
                }
            }

            // Enforce test mode protection on debug APKs: Remote Config can NEVER accidentally switch debug build to production ad units
            if (isDebug) {
                obj.put("ad_test_mode_enabled", true);
            }
        } catch (Exception e) {
            Log.w(TAG, "Error building config JSObject", e);
        }
        return obj;
    }

    @PluginMethod
    public void fetchAndActivate(PluginCall call) {
        if (mFirebaseRemoteConfig == null) {
            call.reject("Remote Config not initialized");
            return;
        }

        mFirebaseRemoteConfig.fetchAndActivate()
                .addOnCompleteListener(task -> {
                    boolean success = task.isSuccessful();
                    boolean updated = success && Boolean.TRUE.equals(task.getResult());
                    Log.d(TAG, "Remote Config fetch completed. Success: " + success + ", Updated: " + updated);

                    JSObject ret = new JSObject();
                    ret.put("success", success);
                    ret.put("updated", updated);
                    ret.put("values", getAllConfigAsJSObject());
                    call.resolve(ret);
                });
    }

    @PluginMethod
    public void getConfig(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("values", getAllConfigAsJSObject());
        call.resolve(ret);
    }
}
