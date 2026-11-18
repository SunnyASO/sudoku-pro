package com.antigravity.sudokupro;

import android.app.Activity;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.content.pm.PackageInfoCompat;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "Billing")
public class BillingPlugin extends Plugin {
    private static final String TAG = "BillingPlugin";
    private static final String PRODUCT_REMOVE_ADS = "remove_ads_lifetime";
    private static final String PREFS_NAME = "sudoku_billing_prefs";
    private static final String KEY_IS_PREMIUM = "is_remove_ads_purchased";
    private static final long CONNECTION_TIMEOUT_MS = 15000L;

    private enum ConnectionState {
        DISCONNECTED,
        CONNECTING,
        CONNECTED
    }

    private static class QueuedOperation {
        final PluginCall call;
        final String operationName;
        final Runnable action;
        final Runnable onFailure;

        QueuedOperation(PluginCall call, String operationName, Runnable action, Runnable onFailure) {
            this.call = call;
            this.operationName = operationName;
            this.action = action;
            this.onFailure = onFailure;
        }
    }

    private final Object connectionLock = new Object();
    private ConnectionState connectionState = ConnectionState.DISCONNECTED;
    private long connectionAttemptId = 0L;
    private final List<QueuedOperation> pendingOperations = new ArrayList<>();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable connectionTimeoutRunnable = null;

    private BillingClient billingClient;
    private volatile boolean isPremium = false;
    private final AtomicBoolean isPurchaseFlowActive = new AtomicBoolean(false);

    private final PurchasesUpdatedListener purchasesUpdatedListener = (billingResult, purchases) -> {
        int responseCode = billingResult.getResponseCode();
        String debugMessage = billingResult.getDebugMessage();
        Log.d(TAG, "PurchasesUpdatedListener result: " + responseCode + " (" + debugMessage + ")");

        isPurchaseFlowActive.set(false);

        if (responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (Purchase purchase : purchases) {
                handlePurchase(purchase);
            }
        } else if (responseCode == BillingClient.BillingResponseCode.USER_CANCELED) {
            Log.i(TAG, "User canceled purchase flow");
        } else {
            Log.e(TAG, "Purchase error: " + debugMessage + " (Code: " + responseCode + ")");
        }
    };

    private void logEnvironmentDiagnostics(String contextTag) {
        Context ctx = getContext();
        if (ctx == null) return;
        try {
            String pkg = ctx.getPackageName();
            PackageInfo pInfo = ctx.getPackageManager().getPackageInfo(pkg, 0);
            long vCode = PackageInfoCompat.getLongVersionCode(pInfo);
            String vName = pInfo.versionName;
            String installer = ctx.getPackageManager().getInstallerPackageName(pkg);
            boolean isDebug = (ctx.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;

            Log.i(TAG, "[" + contextTag + " Diagnostics] Package: " + pkg + ", VersionCode: " + vCode + ", VersionName: " + vName);
            Log.i(TAG, "[" + contextTag + " Diagnostics] Installer: " + (installer != null ? installer : "null (sideloaded/ADB)") + ", Debuggable: " + isDebug);
            Log.i(TAG, "[" + contextTag + " Diagnostics] Target Product ID: " + PRODUCT_REMOVE_ADS + " (Type: INAPP)");
        } catch (Exception e) {
            Log.w(TAG, "Error logging environment diagnostics: " + e.getMessage());
        }
    }

    @Override
    public void load() {
        Log.d(TAG, "BillingPlugin loaded");
        logEnvironmentDiagnostics("PluginLoad");
        try {
            Context ctx = getContext();
            if (ctx != null) {
                isPremium = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        .getBoolean(KEY_IS_PREMIUM, false);
                Log.d(TAG, "Initial persisted isPremium state: " + isPremium);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to load initial premium state", e);
        }

        billingClient = BillingClient.newBuilder(getContext())
                .setListener(purchasesUpdatedListener)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .build();
    }

    private void executeWhenReady(PluginCall call, String operationName, Runnable action, Runnable onFailure) {
        boolean runImmediately = false;

        synchronized (connectionLock) {
            if (connectionState == ConnectionState.CONNECTED) {
                if (billingClient != null && billingClient.isReady()) {
                    runImmediately = true;
                } else {
                    Log.w(TAG, "Connection state is CONNECTED but billingClient.isReady() is false. Resetting to DISCONNECTED.");
                    connectionState = ConnectionState.DISCONNECTED;
                }
            }

            if (!runImmediately) {
                Log.d(TAG, "Queueing operation: " + operationName + " (Current state: " + connectionState + ")");
                pendingOperations.add(new QueuedOperation(call, operationName, action, onFailure));

                if (connectionState == ConnectionState.CONNECTING) {
                    Log.d(TAG, "Already connecting to billing service. Waiting for connection result.");
                    return;
                }

                startBillingConnectionLocked();
                return;
            }
        }

        if (runImmediately) {
            Log.d(TAG, "BillingClient already connected. Executing immediately: " + operationName);
            try {
                action.run();
            } catch (Exception e) {
                Log.e(TAG, "Error executing " + operationName, e);
                if (onFailure != null) {
                    try { onFailure.run(); } catch (Exception ignored) {}
                }
                safeReject(call, "Error executing " + operationName + ": " + e.getMessage());
            }
        }
    }

    private void startBillingConnectionLocked() {
        if (billingClient == null) {
            Log.e(TAG, "startBillingConnection: billingClient is null");
            return;
        }

        final long currentAttemptId = ++connectionAttemptId;
        connectionState = ConnectionState.CONNECTING;
        Log.i(TAG, "Billing connection started (State: CONNECTING, attempt: " + currentAttemptId + ")");
        scheduleConnectionTimeoutLocked(currentAttemptId);

        try {
            billingClient.startConnection(new BillingClientStateListener() {
                @Override
                public void onBillingSetupFinished(@NonNull BillingResult billingResult) {
                    int responseCode = billingResult.getResponseCode();
                    String debugMessage = billingResult.getDebugMessage();
                    Log.d(TAG, "onBillingSetupFinished [attempt " + currentAttemptId + "]: " + responseCode + " (" + debugMessage + ")");

                    List<QueuedOperation> operationsToRun = new ArrayList<>();
                    List<QueuedOperation> operationsToFail = new ArrayList<>();

                    synchronized (connectionLock) {
                        if (currentAttemptId != connectionAttemptId) {
                            Log.w(TAG, "Stale onBillingSetupFinished received for attempt " + currentAttemptId + " (current is " + connectionAttemptId + ") - ignoring.");
                            return;
                        }

                        cancelConnectionTimeoutLocked();

                        if (connectionState != ConnectionState.CONNECTING) {
                            Log.w(TAG, "onBillingSetupFinished received but current state is " + connectionState + " (ignored)");
                            return;
                        }

                        if (responseCode == BillingClient.BillingResponseCode.OK) {
                            connectionState = ConnectionState.CONNECTED;
                            Log.i(TAG, "Billing connection successful (State: CONNECTED). Draining " + pendingOperations.size() + " queued operations.");
                            operationsToRun.addAll(pendingOperations);
                            pendingOperations.clear();
                        } else {
                            connectionState = ConnectionState.DISCONNECTED;
                            Log.e(TAG, "Billing connection failed: " + debugMessage + " (Code: " + responseCode + ")");
                            operationsToFail.addAll(pendingOperations);
                            pendingOperations.clear();
                        }
                    }

                    for (QueuedOperation op : operationsToRun) {
                        try {
                            Log.d(TAG, "Executing queued operation: " + op.operationName);
                            op.action.run();
                        } catch (Exception e) {
                            Log.e(TAG, "Error executing queued operation " + op.operationName, e);
                            if (op.onFailure != null) {
                                try { op.onFailure.run(); } catch (Exception ignored) {}
                            }
                            safeReject(op.call, "Error executing " + op.operationName + ": " + e.getMessage());
                        }
                    }

                    for (QueuedOperation op : operationsToFail) {
                        if (op.onFailure != null) {
                            try { op.onFailure.run(); } catch (Exception ignored) {}
                        }
                        safeReject(op.call, "Billing setup failed: " + debugMessage + " (Code: " + responseCode + ")");
                    }
                }

                @Override
                public void onBillingServiceDisconnected() {
                    Log.w(TAG, "Billing service disconnected [attempt " + currentAttemptId + "]. State set to DISCONNECTED.");
                    List<QueuedOperation> operationsToFail = new ArrayList<>();

                    synchronized (connectionLock) {
                        if (currentAttemptId != connectionAttemptId) {
                            Log.w(TAG, "Stale onBillingServiceDisconnected received for attempt " + currentAttemptId + " (current is " + connectionAttemptId + ") - ignoring.");
                            return;
                        }

                        cancelConnectionTimeoutLocked();
                        connectionState = ConnectionState.DISCONNECTED;
                        operationsToFail.addAll(pendingOperations);
                        pendingOperations.clear();
                    }

                    for (QueuedOperation op : operationsToFail) {
                        if (op.onFailure != null) {
                            try { op.onFailure.run(); } catch (Exception ignored) {}
                        }
                        safeReject(op.call, "Billing service disconnected before operation could complete.");
                    }
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Exception starting billing connection for attempt " + currentAttemptId, e);
            List<QueuedOperation> operationsToFail = new ArrayList<>();
            synchronized (connectionLock) {
                if (currentAttemptId == connectionAttemptId) {
                    cancelConnectionTimeoutLocked();
                    connectionState = ConnectionState.DISCONNECTED;
                    operationsToFail.addAll(pendingOperations);
                    pendingOperations.clear();
                }
            }
            for (QueuedOperation op : operationsToFail) {
                if (op.onFailure != null) {
                    try { op.onFailure.run(); } catch (Exception ignored) {}
                }
                safeReject(op.call, "Exception starting billing connection: " + e.getMessage());
            }
        }
    }

    private void scheduleConnectionTimeoutLocked(final long timeoutAttemptId) {
        cancelConnectionTimeoutLocked();
        connectionTimeoutRunnable = () -> {
            List<QueuedOperation> operationsToFail = new ArrayList<>();
            synchronized (connectionLock) {
                if (timeoutAttemptId != connectionAttemptId || connectionState != ConnectionState.CONNECTING) {
                    return;
                }
                Log.e(TAG, "Billing connection timed out after " + CONNECTION_TIMEOUT_MS + "ms [attempt " + timeoutAttemptId + "].");
                connectionState = ConnectionState.DISCONNECTED;
                operationsToFail.addAll(pendingOperations);
                pendingOperations.clear();
            }
            for (QueuedOperation op : operationsToFail) {
                if (op.onFailure != null) {
                    try { op.onFailure.run(); } catch (Exception ignored) {}
                }
                safeReject(op.call, "Billing connection timed out. Please try again.");
            }
        };
        mainHandler.postDelayed(connectionTimeoutRunnable, CONNECTION_TIMEOUT_MS);
    }

    private void cancelConnectionTimeoutLocked() {
        if (connectionTimeoutRunnable != null) {
            mainHandler.removeCallbacks(connectionTimeoutRunnable);
            connectionTimeoutRunnable = null;
        }
    }

    private void safeResolve(PluginCall call, JSObject data) {
        if (call != null) {
            try {
                if (data != null) {
                    call.resolve(data);
                } else {
                    call.resolve();
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to resolve call (already settled): " + e.getMessage());
            }
        }
    }

    private void safeReject(PluginCall call, String message) {
        if (call != null) {
            try {
                call.reject(message);
            } catch (Exception e) {
                Log.w(TAG, "Failed to reject call (already settled): " + e.getMessage());
            }
        }
    }

    private void setPremium(boolean premium) {
        this.isPremium = premium;
        try {
            Context ctx = getContext();
            if (ctx != null) {
                ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        .edit()
                        .putBoolean(KEY_IS_PREMIUM, premium)
                        .apply();
                Log.d(TAG, "Persisted premium state: " + premium);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to persist premium state", e);
        }
    }

    private void handlePurchase(Purchase purchase) {
        if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
            if (purchase.getProducts().contains(PRODUCT_REMOVE_ADS)) {
                Log.i(TAG, "Verified purchase state: PURCHASED. Granting premium.");
                setPremium(true);
                notifyListeners("purchaseSuccessful", new JSObject());
            }
            if (!purchase.isAcknowledged()) {
                Log.d(TAG, "Acknowledging purchase for products: " + purchase.getProducts());
                AcknowledgePurchaseParams acknowledgePurchaseParams =
                    AcknowledgePurchaseParams.newBuilder()
                        .setPurchaseToken(purchase.getPurchaseToken())
                        .build();
                billingClient.acknowledgePurchase(acknowledgePurchaseParams, billingResult -> {
                    Log.d(TAG, "acknowledgePurchase result: " + billingResult.getResponseCode() + " (" + billingResult.getDebugMessage() + ")");
                });
            }
        } else if (purchase.getPurchaseState() == Purchase.PurchaseState.PENDING) {
            Log.i(TAG, "handlePurchase: Purchase is pending payment. Premium will activate once payment settles.");
        } else {
            Log.w(TAG, "handlePurchase: Unhandled purchase state: " + purchase.getPurchaseState());
        }
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        Log.d(TAG, "initialize called");
        executeWhenReady(call, "initialize", () -> {
            queryExistingPurchases(call);
        }, null);
    }

    private void queryExistingPurchases(PluginCall call) {
        Log.d(TAG, "queryExistingPurchases called");
        if (billingClient == null || !billingClient.isReady()) {
            Log.w(TAG, "queryExistingPurchases: BillingClient is not ready.");
            safeResolve(call, null);
            return;
        }

        billingClient.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
            (billingResult, purchases) -> {
                int responseCode = billingResult.getResponseCode();
                String debugMessage = billingResult.getDebugMessage();
                Log.d(TAG, "queryPurchasesAsync result: " + responseCode + " (" + debugMessage + ")");

                if (responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
                    boolean foundPremium = false;
                    for (Purchase purchase : purchases) {
                        if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                            if (purchase.getProducts().contains(PRODUCT_REMOVE_ADS)) {
                                foundPremium = true;
                                setPremium(true);
                                if (!purchase.isAcknowledged()) {
                                    handlePurchase(purchase);
                                }
                            }
                        } else if (purchase.getPurchaseState() == Purchase.PurchaseState.PENDING) {
                            Log.i(TAG, "Pending purchase detected for " + purchase.getProducts());
                        }
                    }
                    if (!foundPremium) {
                        Log.d(TAG, "No active remove_ads purchase found in Google Play. Resetting premium state to false.");
                        setPremium(false);
                    }
                } else {
                    Log.w(TAG, "queryPurchasesAsync non-OK response: " + responseCode);
                }
                safeResolve(call, null);
            }
        );
    }

    @PluginMethod
    public void queryProducts(PluginCall call) {
        Log.d(TAG, "queryProducts called");
        executeWhenReady(call, "queryProducts", () -> {
            List<QueryProductDetailsParams.Product> productList = new ArrayList<>();
            productList.add(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(PRODUCT_REMOVE_ADS)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            );
            QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(productList)
                .build();

            billingClient.queryProductDetailsAsync(params, (billingResult, productDetailsResult) -> {
                int responseCode = billingResult.getResponseCode();
                String debugMessage = billingResult.getDebugMessage();
                Log.d(TAG, "queryProductDetailsAsync result: " + responseCode + " (" + debugMessage + ")");

                if (responseCode == BillingClient.BillingResponseCode.OK && productDetailsResult != null) {
                    safeResolve(call, new JSObject());
                } else {
                    safeReject(call, "Query failed: " + debugMessage + " (Code: " + responseCode + ")");
                }
            });
        }, null);
    }

    @PluginMethod
    public void purchaseProduct(PluginCall call) {
        purchaseRemoveAds(call);
    }

    @PluginMethod
    public void purchaseRemoveAds(PluginCall call) {
        Log.d(TAG, "purchaseRemoveAds called");
        logEnvironmentDiagnostics("PurchaseRequest");

        if (isPremium) {
            Log.i(TAG, "purchaseRemoveAds: User is already premium.");
            JSObject ret = new JSObject();
            ret.put("alreadyPurchased", true);
            safeResolve(call, ret);
            return;
        }

        if (!isPurchaseFlowActive.compareAndSet(false, true)) {
            Log.w(TAG, "purchaseRemoveAds rejected: A purchase flow is already in progress.");
            safeReject(call, "A purchase is already in progress. Please wait.");
            return;
        }

        executeWhenReady(call, "purchaseRemoveAds", () -> {
            List<QueryProductDetailsParams.Product> productList = new ArrayList<>();
            productList.add(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(PRODUCT_REMOVE_ADS)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            );

            QueryProductDetailsParams queryParams = QueryProductDetailsParams.newBuilder()
                .setProductList(productList)
                .build();

            billingClient.queryProductDetailsAsync(queryParams, (billingResult, productDetailsResult) -> {
                int responseCode = billingResult.getResponseCode();
                String debugMessage = billingResult.getDebugMessage();
                Log.d(TAG, "purchase queryProductDetailsAsync result: " + responseCode + " (" + debugMessage + ")");

                try {
                    List<ProductDetails> productDetailsList = (productDetailsResult != null)
                            ? productDetailsResult.getProductDetailsList()
                            : null;

                    if (responseCode == BillingClient.BillingResponseCode.OK && productDetailsList != null && !productDetailsList.isEmpty()) {
                        Log.i(TAG, "[BillingDiagnostic] Successfully retrieved ProductDetails for '" + PRODUCT_REMOVE_ADS + "': " + productDetailsList.get(0).getTitle());
                        Activity activity = getActivity();
                        if (activity == null) {
                            isPurchaseFlowActive.set(false);
                            safeReject(call, "No active activity to launch billing flow");
                            return;
                        }

                        List<BillingFlowParams.ProductDetailsParams> productDetailsParamsList = new ArrayList<>();
                        productDetailsParamsList.add(
                            BillingFlowParams.ProductDetailsParams.newBuilder()
                                .setProductDetails(productDetailsList.get(0))
                                .build()
                        );

                        BillingFlowParams billingFlowParams = BillingFlowParams.newBuilder()
                            .setProductDetailsParamsList(productDetailsParamsList)
                            .build();

                        activity.runOnUiThread(() -> {
                            try {
                                BillingResult flowResult = billingClient.launchBillingFlow(activity, billingFlowParams);
                                int flowResponse = flowResult.getResponseCode();
                                Log.i(TAG, "Purchase flow launched for " + PRODUCT_REMOVE_ADS + " result: " + flowResponse + " (" + flowResult.getDebugMessage() + ")");
                                if (flowResponse == BillingClient.BillingResponseCode.OK) {
                                    safeResolve(call, null);
                                } else {
                                    isPurchaseFlowActive.set(false);
                                    Log.e(TAG, "[BillingDiagnostic] launchBillingFlow non-OK: " + flowResponse + " (" + flowResult.getDebugMessage() + ")");
                                    safeReject(call, "Failed to launch billing flow: " + flowResult.getDebugMessage() + " (Code: " + flowResponse + ")");
                                }
                            } catch (Exception e) {
                                isPurchaseFlowActive.set(false);
                                Log.e(TAG, "Exception in launchBillingFlow", e);
                                safeReject(call, "Failed to launch billing flow: " + e.getMessage());
                            }
                        });
                    } else {
                        isPurchaseFlowActive.set(false);
                        Log.e(TAG, "[BillingDiagnostic] Product details unavailable for " + PRODUCT_REMOVE_ADS + ": " + debugMessage + " (Code: " + responseCode + ")");
                        Log.e(TAG, "[BillingDiagnostic] Root Cause Diagnostic Checklist:");
                        Log.e(TAG, "[BillingDiagnostic] 1. Google Play Console: Ensure '" + PRODUCT_REMOVE_ADS + "' exists in In-app products with status 'Active'.");
                        Log.e(TAG, "[BillingDiagnostic] 2. Sideloading/Signing: If running app-debug.apk via ADB, Google Play rejects billing with 'This version of the application is not configured for billing through Google Play'. Build must match upload key or be installed via Play Store Internal Testing.");
                        Log.e(TAG, "[BillingDiagnostic] 3. Account: Ensure device Google account is added under Google Play Console -> Setup -> License testing.");
                        Log.e(TAG, "[BillingDiagnostic] 4. Publishing: Ensure this versionCode is uploaded to an active Internal Testing track in Google Play Console.");
                        safeReject(call, "Product not found: " + debugMessage + " (Code: " + responseCode + ")");
                    }
                } catch (Exception ex) {
                    isPurchaseFlowActive.set(false);
                    Log.e(TAG, "Error in queryProductDetailsAsync callback", ex);
                    safeReject(call, "Error in queryProductDetails: " + ex.getMessage());
                }
            });
        }, () -> {
            isPurchaseFlowActive.set(false);
        });
    }

    @PluginMethod
    public void restorePurchases(PluginCall call) {
        Log.d(TAG, "restorePurchases called");
        executeWhenReady(call, "restorePurchases", () -> {
            billingClient.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
                (billingResult, purchases) -> {
                    int responseCode = billingResult.getResponseCode();
                    String debugMessage = billingResult.getDebugMessage();
                    Log.d(TAG, "restore queryPurchasesAsync result: " + responseCode + " (" + debugMessage + ")");

                    if (responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
                        for (Purchase purchase : purchases) {
                            if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                                if (purchase.getProducts().contains(PRODUCT_REMOVE_ADS)) {
                                    setPremium(true);
                                    if (!purchase.isAcknowledged()) {
                                        handlePurchase(purchase);
                                    }
                                }
                            }
                        }
                        JSObject ret = new JSObject();
                        ret.put("isPurchased", isPremium);
                        safeResolve(call, ret);
                    } else {
                        safeReject(call, "Restore failed: " + debugMessage + " (Code: " + responseCode + ")");
                    }
                }
            );
        }, null);
    }

    @PluginMethod
    public void isRemoveAdsPurchased(PluginCall call) {
        Log.d(TAG, "isRemoveAdsPurchased called, isPremium=" + isPremium);
        JSObject ret = new JSObject();
        ret.put("isPurchased", isPremium);
        safeResolve(call, ret);
    }

    @PluginMethod
    public void resetPremiumForTesting(PluginCall call) {
        Log.i(TAG, "resetPremiumForTesting called");
        setPremium(false);
        JSObject ret = new JSObject();
        ret.put("isPurchased", false);
        safeResolve(call, ret);
    }

    @PluginMethod
    public void getBillingDiagnostics(PluginCall call) {
        JSObject ret = new JSObject();
        Context ctx = getContext();
        if (ctx != null) {
            try {
                String pkg = ctx.getPackageName();
                PackageInfo pInfo = ctx.getPackageManager().getPackageInfo(pkg, 0);
                long vCode = PackageInfoCompat.getLongVersionCode(pInfo);
                String installer = ctx.getPackageManager().getInstallerPackageName(pkg);
                boolean isDebug = (ctx.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;

                ret.put("packageName", pkg);
                ret.put("versionCode", vCode);
                ret.put("versionName", pInfo.versionName);
                ret.put("installerPackage", installer != null ? installer : "sideloaded");
                ret.put("isDebuggable", isDebug);
            } catch (Exception e) {
                ret.put("error", e.getMessage());
            }
        }
        ret.put("productId", PRODUCT_REMOVE_ADS);
        ret.put("isPremium", isPremium);
        ret.put("connectionState", connectionState.name());
        ret.put("isBillingClientReady", billingClient != null && billingClient.isReady());
        safeResolve(call, ret);
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        Log.d(TAG, "BillingPlugin handleOnDestroy");
        synchronized (connectionLock) {
            cancelConnectionTimeoutLocked();
            connectionState = ConnectionState.DISCONNECTED;
            pendingOperations.clear();
        }
        if (billingClient != null && billingClient.isReady()) {
            try {
                billingClient.endConnection();
            } catch (Exception e) {
                Log.w(TAG, "Error ending billingClient connection", e);
            }
        }
    }
}
