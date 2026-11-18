package com.antigravity.sudokupro;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;
import android.view.HapticFeedbackConstants;
import android.view.View;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Haptics")
public class HapticsPlugin extends Plugin {
    private static final String TAG = "HapticsPlugin";
    private Vibrator vibrator;

    @Override
    public void load() {
        super.load();
        try {
            Context context = getContext();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vibratorManager = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                if (vibratorManager != null) {
                    vibrator = vibratorManager.getDefaultVibrator();
                }
            }
            if (vibrator == null) {
                vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            }
        } catch (Exception e) {
            Log.w(TAG, "Error initializing Vibrator", e);
        }
    }

    private void performViewHaptic(int feedbackConstant) {
        try {
            if (getActivity() != null && getActivity().getWindow() != null) {
                View decorView = getActivity().getWindow().getDecorView();
                if (decorView != null) {
                    decorView.performHapticFeedback(feedbackConstant, HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING);
                }
            }
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void impact(PluginCall call) {
        String style = call.getString("style", "LIGHT").toUpperCase();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && vibrator != null && vibrator.hasVibrator()) {
                int effectId = VibrationEffect.EFFECT_CLICK;
                if ("HEAVY".equals(style)) {
                    effectId = VibrationEffect.EFFECT_HEAVY_CLICK;
                } else if ("MEDIUM".equals(style)) {
                    effectId = VibrationEffect.EFFECT_DOUBLE_CLICK;
                }
                vibrator.vibrate(VibrationEffect.createPredefined(effectId));
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && vibrator != null && vibrator.hasVibrator()) {
                long duration = "HEAVY".equals(style) ? 40 : ("MEDIUM".equals(style) ? 25 : 12);
                int amplitude = "HEAVY".equals(style) ? 255 : ("MEDIUM".equals(style) ? 180 : 100);
                vibrator.vibrate(VibrationEffect.createOneShot(duration, amplitude));
            } else {
                performViewHaptic(HapticFeedbackConstants.KEYBOARD_TAP);
            }
        } catch (Exception e) {
            performViewHaptic(HapticFeedbackConstants.KEYBOARD_TAP);
        }
        call.resolve();
    }

    @PluginMethod
    public void notification(PluginCall call) {
        String type = call.getString("type", "SUCCESS").toUpperCase();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && vibrator != null && vibrator.hasVibrator()) {
                if ("ERROR".equals(type) || "WARNING".equals(type)) {
                    // Warning / Error pattern: [delay, on, delay, on]
                    long[] timings = new long[]{0, 50, 60, 100};
                    int[] amplitudes = new int[]{0, 200, 0, 255};
                    vibrator.vibrate(VibrationEffect.createWaveform(timings, amplitudes, -1));
                } else {
                    // Success pattern: subtle ascending pulse
                    long[] timings = new long[]{0, 30, 40, 50};
                    int[] amplitudes = new int[]{0, 120, 0, 220};
                    vibrator.vibrate(VibrationEffect.createWaveform(timings, amplitudes, -1));
                }
            } else {
                performViewHaptic(HapticFeedbackConstants.CONFIRM);
            }
        } catch (Exception e) {
            performViewHaptic(HapticFeedbackConstants.CONFIRM);
        }
        call.resolve();
    }

    @PluginMethod
    public void vibrate(PluginCall call) {
        int duration = call.getInt("duration", 200);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && vibrator != null && vibrator.hasVibrator()) {
                vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
            } else if (vibrator != null) {
                vibrator.vibrate(duration);
            }
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void selectionStart(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void selectionChanged(PluginCall call) {
        performViewHaptic(HapticFeedbackConstants.KEYBOARD_TAP);
        call.resolve();
    }

    @PluginMethod
    public void selectionEnd(PluginCall call) {
        call.resolve();
    }
}
