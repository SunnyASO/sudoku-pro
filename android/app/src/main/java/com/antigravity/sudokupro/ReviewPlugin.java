package com.antigravity.sudokupro;

import android.app.Activity;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.tasks.Task;
import com.google.android.play.core.review.ReviewInfo;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

@CapacitorPlugin(name = "Review")
public class ReviewPlugin extends Plugin {
    private static final String TAG = "ReviewPlugin";
    private ReviewManager reviewManager;

    @Override
    public void load() {
        super.load();
        try {
            reviewManager = ReviewManagerFactory.create(getContext());
        } catch (Exception e) {
            Log.w(TAG, "Failed to initialize ReviewManager in load()", e);
        }
    }

    @PluginMethod
    public void requestReview(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("status", "activity_unavailable");
            call.resolve(res);
            return;
        }

        if (reviewManager == null) {
            try {
                reviewManager = ReviewManagerFactory.create(activity);
            } catch (Exception e) {
                Log.w(TAG, "ReviewManager creation error", e);
                JSObject res = new JSObject();
                res.put("success", false);
                res.put("status", "manager_init_failed");
                call.resolve(res);
                return;
            }
        }

        try {
            Task<ReviewInfo> requestTask = reviewManager.requestReviewFlow();
            requestTask.addOnCompleteListener(task -> {
                if (task.isSuccessful()) {
                    ReviewInfo reviewInfo = task.getResult();
                    if (reviewInfo == null) {
                        JSObject res = new JSObject();
                        res.put("success", false);
                        res.put("status", "review_info_null");
                        call.resolve(res);
                        return;
                    }

                    Activity currentActivity = getActivity();
                    if (currentActivity == null || currentActivity.isFinishing() || currentActivity.isDestroyed()) {
                        JSObject res = new JSObject();
                        res.put("success", false);
                        res.put("status", "activity_destroyed_before_launch");
                        call.resolve(res);
                        return;
                    }

                    Task<Void> flowTask = reviewManager.launchReviewFlow(currentActivity, reviewInfo);
                    flowTask.addOnCompleteListener(flowResult -> {
                        // The flow has finished. The Google Play API does not disclose
                        // whether the dialog was shown or whether the user submitted a review.
                        // We record that the flow request completed and continue cleanly.
                        Log.d(TAG, "In-App Review launch flow completed. isSuccessful=" + flowResult.isSuccessful());
                        JSObject res = new JSObject();
                        res.put("success", flowResult.isSuccessful());
                        res.put("status", "flow_completed");
                        call.resolve(res);
                    });
                } else {
                    Exception e = task.getException();
                    Log.w(TAG, "In-App Review requestReviewFlow failed", e);
                    JSObject res = new JSObject();
                    res.put("success", false);
                    res.put("status", "request_failed");
                    res.put("error", e != null ? e.getMessage() : "unknown");
                    call.resolve(res);
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Exception in requestReview", e);
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("status", "exception");
            res.put("error", e.getMessage());
            call.resolve(res);
        }
    }
}
