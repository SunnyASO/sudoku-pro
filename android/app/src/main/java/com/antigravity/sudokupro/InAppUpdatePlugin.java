package com.antigravity.sudokupro;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.tasks.Task;
import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.InstallStateUpdatedListener;
import com.google.android.play.core.install.model.ActivityResult;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.InstallStatus;
import com.google.android.play.core.install.model.UpdateAvailability;

@CapacitorPlugin(name = "InAppUpdate")
public class InAppUpdatePlugin extends Plugin {
    private static final String TAG = "InAppUpdatePlugin";
    private static final int REQUEST_CODE_IMMEDIATE_UPDATE = 9101;
    private static final int REQUEST_CODE_FLEXIBLE_UPDATE = 9102;

    private AppUpdateManager appUpdateManager;
    private AppUpdateInfo cachedAppUpdateInfo;
    private InstallStateUpdatedListener installStateListener;

    @Override
    public void load() {
        super.load();
        try {
            appUpdateManager = AppUpdateManagerFactory.create(getContext());
            Log.d(TAG, "AppUpdateManager initialized.");
        } catch (Exception e) {
            Log.w(TAG, "Failed to initialize AppUpdateManager in load()", e);
        }
    }

    private long getInstalledVersionCode() {
        try {
            Context ctx = getContext();
            if (ctx != null) {
                PackageInfo pInfo = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    return pInfo.getLongVersionCode();
                } else {
                    return pInfo.versionCode;
                }
            }
        } catch (Exception ignored) {}
        return 20;
    }

    private AppUpdateManager getManager() {
        if (appUpdateManager == null) {
            try {
                Context ctx = getActivity() != null ? getActivity() : getContext();
                if (ctx != null) {
                    appUpdateManager = AppUpdateManagerFactory.create(ctx);
                }
            } catch (Exception e) {
                Log.w(TAG, "Error creating AppUpdateManager", e);
            }
        }
        return appUpdateManager;
    }

    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        AppUpdateManager manager = getManager();
        long installedCode = getInstalledVersionCode();

        if (manager == null) {
            JSObject res = new JSObject();
            res.put("updateAvailable", false);
            res.put("availableVersionCode", installedCode);
            res.put("installedVersionCode", installedCode);
            res.put("immediateAllowed", false);
            res.put("flexibleAllowed", false);
            res.put("installStatus", 0);
            res.put("updatePriority", 0);
            res.put("clientVersionStalenessDays", -1);
            res.put("status", "manager_null");
            call.resolve(res);
            return;
        }

        try {
            Task<AppUpdateInfo> task = manager.getAppUpdateInfo();
            task.addOnSuccessListener(appUpdateInfo -> {
                cachedAppUpdateInfo = appUpdateInfo;

                int availability = appUpdateInfo.updateAvailability();
                boolean isAvailable = (availability == UpdateAvailability.UPDATE_AVAILABLE);
                boolean inProgress = (availability == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS);
                boolean immediateAllowed = appUpdateInfo.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE);
                boolean flexibleAllowed = appUpdateInfo.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE);
                int availableCode = appUpdateInfo.availableVersionCode();
                int installStatus = appUpdateInfo.installStatus();
                int priority = appUpdateInfo.updatePriority();
                Integer staleness = appUpdateInfo.clientVersionStalenessDays();

                Log.d(TAG, "[Update] Check success - available: " + isAvailable +
                        ", availableVersionCode: " + availableCode +
                        ", installedVersionCode: " + installedCode +
                        ", immediateAllowed: " + immediateAllowed +
                        ", flexibleAllowed: " + flexibleAllowed +
                        ", inProgress: " + inProgress);

                JSObject res = new JSObject();
                res.put("updateAvailable", isAvailable);
                res.put("updateInProgress", inProgress);
                res.put("availableVersionCode", availableCode);
                res.put("installedVersionCode", installedCode);
                res.put("immediateAllowed", immediateAllowed);
                res.put("flexibleAllowed", flexibleAllowed);
                res.put("installStatus", installStatus);
                res.put("updatePriority", priority);
                res.put("clientVersionStalenessDays", staleness != null ? staleness : -1);
                res.put("status", isAvailable ? "available" : (inProgress ? "in_progress" : "not_available"));
                call.resolve(res);
            }).addOnFailureListener(e -> {
                Log.d(TAG, "[Update] Play In-App Update unavailable (expected for debug/sideload): " + e.getMessage());
                JSObject res = new JSObject();
                res.put("updateAvailable", false);
                res.put("updateInProgress", false);
                res.put("availableVersionCode", installedCode);
                res.put("installedVersionCode", installedCode);
                res.put("immediateAllowed", false);
                res.put("flexibleAllowed", false);
                res.put("installStatus", 0);
                res.put("updatePriority", 0);
                res.put("clientVersionStalenessDays", -1);
                res.put("status", "unavailable");
                res.put("error", e.getMessage() != null ? e.getMessage() : "Unknown");
                call.resolve(res);
            });
        } catch (Exception e) {
            Log.e(TAG, "[Update] Exception checking for update", e);
            JSObject res = new JSObject();
            res.put("updateAvailable", false);
            res.put("availableVersionCode", installedCode);
            res.put("installedVersionCode", installedCode);
            res.put("immediateAllowed", false);
            res.put("flexibleAllowed", false);
            res.put("installStatus", 0);
            res.put("updatePriority", 0);
            res.put("clientVersionStalenessDays", -1);
            res.put("status", "exception");
            call.resolve(res);
        }
    }

    @PluginMethod
    public void startImmediateUpdate(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("status", "activity_unavailable");
            call.resolve(res);
            return;
        }

        AppUpdateManager manager = getManager();
        if (manager == null) {
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("status", "manager_null");
            call.resolve(res);
            return;
        }

        // If we have cached info and immediate is allowed, start directly
        if (cachedAppUpdateInfo != null && cachedAppUpdateInfo.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
            launchImmediateFlow(manager, cachedAppUpdateInfo, activity, call);
            return;
        }

        // Otherwise refresh info first
        manager.getAppUpdateInfo().addOnSuccessListener(appUpdateInfo -> {
            cachedAppUpdateInfo = appUpdateInfo;
            if (appUpdateInfo.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE) ||
                appUpdateInfo.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) {
                launchImmediateFlow(manager, appUpdateInfo, activity, call);
            } else {
                Log.w(TAG, "[Update] Immediate update not allowed for current update state.");
                JSObject res = new JSObject();
                res.put("success", false);
                res.put("status", "immediate_not_allowed");
                call.resolve(res);
            }
        }).addOnFailureListener(e -> {
            Log.w(TAG, "[Update] Failed fetching update info for immediate flow", e);
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("status", "fetch_failed");
            res.put("error", e.getMessage());
            call.resolve(res);
        });
    }

    private void launchImmediateFlow(AppUpdateManager manager, AppUpdateInfo info, Activity activity, PluginCall call) {
        try {
            AppUpdateOptions options = AppUpdateOptions.defaultOptions(AppUpdateType.IMMEDIATE);
            manager.startUpdateFlowForResult(info, activity, options, REQUEST_CODE_IMMEDIATE_UPDATE);
            Log.d(TAG, "[Update] Immediate update flow launched.");
            JSObject res = new JSObject();
            res.put("success", true);
            res.put("status", "started");
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "[Update] Failed to start immediate update flow", e);
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("status", "launch_exception");
            res.put("error", e.getMessage());
            call.resolve(res);
        }
    }

    @PluginMethod
    public void startFlexibleUpdate(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("status", "activity_unavailable");
            call.resolve(res);
            return;
        }

        AppUpdateManager manager = getManager();
        if (manager == null) {
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("status", "manager_null");
            call.resolve(res);
            return;
        }

        ensureInstallStateListener(manager);

        if (cachedAppUpdateInfo != null && cachedAppUpdateInfo.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) {
            launchFlexibleFlow(manager, cachedAppUpdateInfo, activity, call);
            return;
        }

        manager.getAppUpdateInfo().addOnSuccessListener(appUpdateInfo -> {
            cachedAppUpdateInfo = appUpdateInfo;
            if (appUpdateInfo.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) {
                launchFlexibleFlow(manager, appUpdateInfo, activity, call);
            } else {
                Log.w(TAG, "[Update] Flexible update not allowed.");
                JSObject res = new JSObject();
                res.put("success", false);
                res.put("status", "flexible_not_allowed");
                call.resolve(res);
            }
        }).addOnFailureListener(e -> {
            Log.w(TAG, "[Update] Failed fetching update info for flexible flow", e);
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("status", "fetch_failed");
            res.put("error", e.getMessage());
            call.resolve(res);
        });
    }

    private void launchFlexibleFlow(AppUpdateManager manager, AppUpdateInfo info, Activity activity, PluginCall call) {
        try {
            AppUpdateOptions options = AppUpdateOptions.defaultOptions(AppUpdateType.FLEXIBLE);
            manager.startUpdateFlowForResult(info, activity, options, REQUEST_CODE_FLEXIBLE_UPDATE);
            Log.d(TAG, "[Update] Flexible update flow launched.");
            JSObject res = new JSObject();
            res.put("success", true);
            res.put("status", "started");
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "[Update] Failed to start flexible update flow", e);
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("status", "launch_exception");
            res.put("error", e.getMessage());
            call.resolve(res);
        }
    }

    private void ensureInstallStateListener(AppUpdateManager manager) {
        if (installStateListener != null) return;
        installStateListener = state -> {
            int status = state.installStatus();
            long bytes = state.bytesDownloaded();
            long total = state.totalBytesToDownload();
            int err = state.installErrorCode();

            JSObject data = new JSObject();
            data.put("installStatus", status);
            data.put("bytesDownloaded", bytes);
            data.put("totalBytesToDownload", total);
            data.put("installErrorCode", err);

            if (status == InstallStatus.DOWNLOADED) {
                data.put("status", "DOWNLOADED");
            } else if (status == InstallStatus.DOWNLOADING) {
                data.put("status", "DOWNLOADING");
            } else if (status == InstallStatus.FAILED) {
                data.put("status", "FAILED");
            } else if (status == InstallStatus.CANCELED) {
                data.put("status", "CANCELED");
            } else if (status == InstallStatus.PENDING) {
                data.put("status", "PENDING");
            }

            Log.d(TAG, "[Update] Flexible install state update: status=" + status + ", bytes=" + bytes + "/" + total);
            notifyListeners("onFlexibleUpdateStateChange", data);
        };
        manager.registerListener(installStateListener);
    }

    @PluginMethod
    public void completeFlexibleUpdate(PluginCall call) {
        AppUpdateManager manager = getManager();
        if (manager == null) {
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("status", "manager_null");
            call.resolve(res);
            return;
        }

        try {
            Log.d(TAG, "[Update] Completing flexible update (triggering restart)...");
            Task<Void> completeTask = manager.completeUpdate();
            completeTask.addOnSuccessListener(unused -> {
                JSObject res = new JSObject();
                res.put("success", true);
                res.put("status", "restarting");
                call.resolve(res);
            }).addOnFailureListener(e -> {
                Log.e(TAG, "[Update] Failed to complete flexible update", e);
                JSObject res = new JSObject();
                res.put("success", false);
                res.put("status", "complete_failed");
                res.put("error", e.getMessage());
                call.resolve(res);
            });
        } catch (Exception e) {
            Log.e(TAG, "[Update] Exception in completeUpdate", e);
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("status", "exception");
            res.put("error", e.getMessage());
            call.resolve(res);
        }
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        AppUpdateManager manager = getManager();
        if (manager == null) return;

        try {
            manager.getAppUpdateInfo().addOnSuccessListener(info -> {
                // Resume immediate update if in progress
                if (info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) {
                    Activity activity = getActivity();
                    if (activity != null && !activity.isFinishing() && !activity.isDestroyed()) {
                        try {
                            manager.startUpdateFlowForResult(
                                    info,
                                    activity,
                                    AppUpdateOptions.defaultOptions(AppUpdateType.IMMEDIATE),
                                    REQUEST_CODE_IMMEDIATE_UPDATE
                            );
                        } catch (Exception e) {
                            Log.w(TAG, "[Update] Failed resuming immediate update in onResume", e);
                        }
                    }
                }

                // Check if flexible update completed download while app was backgrounded
                if (info.installStatus() == InstallStatus.DOWNLOADED) {
                    JSObject data = new JSObject();
                    data.put("installStatus", InstallStatus.DOWNLOADED);
                    data.put("status", "DOWNLOADED");
                    notifyListeners("onFlexibleUpdateStateChange", data);
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "[Update] Error in handleOnResume update check", e);
        }
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);

        if (requestCode == REQUEST_CODE_IMMEDIATE_UPDATE) {
            JSObject res = new JSObject();
            res.put("requestCode", requestCode);
            res.put("resultCode", resultCode);

            if (resultCode == Activity.RESULT_OK) {
                res.put("status", "OK");
                res.put("success", true);
                Log.d(TAG, "[Update] Immediate update result: OK");
            } else if (resultCode == Activity.RESULT_CANCELED) {
                res.put("status", "CANCELED");
                res.put("success", false);
                Log.d(TAG, "[Update] Immediate update result: CANCELED by user");
            } else if (resultCode == ActivityResult.RESULT_IN_APP_UPDATE_FAILED) {
                res.put("status", "FAILED");
                res.put("success", false);
                Log.w(TAG, "[Update] Immediate update result: RESULT_IN_APP_UPDATE_FAILED");
            } else {
                res.put("status", "OTHER_" + resultCode);
                res.put("success", false);
                Log.w(TAG, "[Update] Immediate update result other: " + resultCode);
            }
            notifyListeners("onImmediateUpdateResult", res);
        } else if (requestCode == REQUEST_CODE_FLEXIBLE_UPDATE) {
            JSObject res = new JSObject();
            res.put("requestCode", requestCode);
            res.put("resultCode", resultCode);

            if (resultCode == Activity.RESULT_OK) {
                res.put("status", "OK");
                res.put("success", true);
                Log.d(TAG, "[Update] Flexible update dialog result: OK (starting download)");
            } else if (resultCode == Activity.RESULT_CANCELED) {
                res.put("status", "CANCELED");
                res.put("success", false);
                Log.d(TAG, "[Update] Flexible update dialog result: CANCELED by user");
            } else {
                res.put("status", "FAILED");
                res.put("success", false);
                Log.w(TAG, "[Update] Flexible update dialog result failed: " + resultCode);
            }
            notifyListeners("onFlexibleUpdateResult", res);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (appUpdateManager != null && installStateListener != null) {
            try {
                appUpdateManager.unregisterListener(installStateListener);
            } catch (Exception ignored) {}
        }
        super.handleOnDestroy();
    }
}
