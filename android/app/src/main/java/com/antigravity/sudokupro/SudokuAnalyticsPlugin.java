package com.antigravity.sudokupro;

import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.analytics.FirebaseAnalytics;
import java.util.Iterator;

@CapacitorPlugin(name = "SudokuAnalytics")
public class SudokuAnalyticsPlugin extends Plugin {
    private FirebaseAnalytics mFirebaseAnalytics;
    private static final String TAG = "SudokuAnalytics";

    @Override
    public void load() {
        mFirebaseAnalytics = FirebaseAnalytics.getInstance(getContext());
    }

    private String sanitizeName(String name) {
        if (name == null) return "unknown";
        String sanitized = name.toLowerCase().replaceAll("[^a-z0-9_]", "_");
        if (sanitized.length() > 40) {
            sanitized = sanitized.substring(0, 40);
        }
        if (sanitized.length() > 0 && !Character.isLetter(sanitized.charAt(0))) {
            sanitized = "sudoku_" + sanitized;
        }
        if (sanitized.length() > 40) {
            sanitized = sanitized.substring(0, 40);
        }
        return sanitized;
    }

    @PluginMethod
    public void logEvent(PluginCall call) {
        try {
            String name = call.getString("name");
            if (name == null) {
                call.reject("Must provide an event name");
                return;
            }
            name = sanitizeName(name);

            JSObject params = call.getObject("params");
            Bundle bundle = new Bundle();

            if (params != null) {
                Iterator<String> keys = params.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    String sanitizedKey = sanitizeName(key);
                    Object value = params.get(key);
                    
                    if (value instanceof String) {
                        bundle.putString(sanitizedKey, (String) value);
                    } else if (value instanceof Integer) {
                        bundle.putInt(sanitizedKey, (Integer) value);
                    } else if (value instanceof Double) {
                        bundle.putDouble(sanitizedKey, (Double) value);
                    } else if (value instanceof Boolean) {
                        bundle.putBoolean(sanitizedKey, (Boolean) value);
                    } else if (value != null) {
                        bundle.putString(sanitizedKey, value.toString());
                    }
                }
            }

            mFirebaseAnalytics.logEvent(name, bundle);
            call.resolve();
        } catch (Exception e) {
            Log.w(TAG, "Failed to log event", e);
            call.reject("Failed to log event", e);
        }
    }

    @PluginMethod
    public void setUserProperty(PluginCall call) {
        try {
            String name = call.getString("name");
            String value = call.getString("value");
            if (name == null) {
                call.reject("Must provide a property name");
                return;
            }
            name = sanitizeName(name);
            mFirebaseAnalytics.setUserProperty(name, value);
            call.resolve();
        } catch (Exception e) {
            Log.w(TAG, "Failed to set user property", e);
            call.reject("Failed to set user property", e);
        }
    }
}
