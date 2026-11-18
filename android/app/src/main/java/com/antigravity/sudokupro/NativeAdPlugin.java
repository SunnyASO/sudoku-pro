package com.antigravity.sudokupro;

import android.app.Activity;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdLoader;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.nativead.NativeAd;
import com.google.android.gms.ads.nativead.NativeAdView;

@CapacitorPlugin(name = "NativeAd")
public class NativeAdPlugin extends Plugin {

    private static final String TAG = "NativeAdPlugin";
    private NativeAd currentNativeAd;
    private NativeAdView currentNativeAdView;
    private FrameLayout nativeAdOverlayContainer;

    @PluginMethod
    public void showNativeAd(PluginCall call) {
        String adUnitId = call.getString("adUnitId");
        if (adUnitId == null || adUnitId.isEmpty()) {
            call.reject("adUnitId is required");
            return;
        }

        int heightDp = call.getInt("heightDp", 120);
        int bottomMarginDp = call.getInt("bottomMarginDp", 16);
        int horizontalMarginDp = call.getInt("horizontalMarginDp", 16);

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity is null");
            return;
        }

        activity.runOnUiThread(() -> {
            // First hide any existing ad
            hideExistingAd();

            AdLoader adLoader = new AdLoader.Builder(activity, adUnitId)
                    .forNativeAd(nativeAd -> {
                        if (activity.isDestroyed()) {
                            nativeAd.destroy();
                            return;
                        }
                        currentNativeAd = nativeAd;
                        displayNativeAd(nativeAd, heightDp, bottomMarginDp, horizontalMarginDp);
                    })
                    .withAdListener(new AdListener() {
                        @Override
                        public void onAdFailedToLoad(LoadAdError adError) {
                            Log.e(TAG, "Failed to load native ad: " + adError.getMessage());
                            call.reject("Ad failed to load: " + adError.getMessage());
                        }

                        @Override
                        public void onAdLoaded() {
                            call.resolve();
                        }
                    })
                    .build();

            adLoader.loadAd(new AdRequest.Builder().build());
        });
    }

    @PluginMethod
    public void hideNativeAd(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity is null");
            return;
        }

        activity.runOnUiThread(() -> {
            hideExistingAd();
            call.resolve();
        });
    }

    private void displayNativeAd(NativeAd nativeAd, int heightDp, int bottomMarginDp, int horizontalMarginDp) {
        Activity activity = getActivity();
        if (activity == null) return;

        currentNativeAdView = (NativeAdView) activity.getLayoutInflater()
                .inflate(R.layout.native_ad_layout, null);

        // Map views
        currentNativeAdView.setHeadlineView(currentNativeAdView.findViewById(R.id.ad_headline));
        currentNativeAdView.setBodyView(currentNativeAdView.findViewById(R.id.ad_body));
        currentNativeAdView.setCallToActionView(currentNativeAdView.findViewById(R.id.ad_call_to_action));
        currentNativeAdView.setIconView(currentNativeAdView.findViewById(R.id.ad_app_icon));

        // Populate views
        ((TextView) currentNativeAdView.getHeadlineView()).setText(nativeAd.getHeadline());

        if (nativeAd.getBody() == null) {
            currentNativeAdView.getBodyView().setVisibility(View.INVISIBLE);
        } else {
            currentNativeAdView.getBodyView().setVisibility(View.VISIBLE);
            ((TextView) currentNativeAdView.getBodyView()).setText(nativeAd.getBody());
        }

        if (nativeAd.getCallToAction() == null) {
            currentNativeAdView.getCallToActionView().setVisibility(View.INVISIBLE);
        } else {
            currentNativeAdView.getCallToActionView().setVisibility(View.VISIBLE);
            ((Button) currentNativeAdView.getCallToActionView()).setText(nativeAd.getCallToAction());
        }

        if (nativeAd.getIcon() == null) {
            currentNativeAdView.getIconView().setVisibility(View.GONE);
        } else {
            ((ImageView) currentNativeAdView.getIconView()).setImageDrawable(
                    nativeAd.getIcon().getDrawable());
            currentNativeAdView.getIconView().setVisibility(View.VISIBLE);
        }

        currentNativeAdView.setNativeAd(nativeAd);

        // Add to parent view at the bottom
        FrameLayout root = activity.findViewById(android.R.id.content);
        nativeAdOverlayContainer = new FrameLayout(activity);
        
        float density = activity.getResources().getDisplayMetrics().density;
        FrameLayout.LayoutParams containerParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                (int) (heightDp * density)
        );
        containerParams.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        containerParams.bottomMargin = (int) (bottomMarginDp * density);
        containerParams.leftMargin = (int) (horizontalMarginDp * density);
        containerParams.rightMargin = (int) (horizontalMarginDp * density);
        
        FrameLayout.LayoutParams viewParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        );
        nativeAdOverlayContainer.addView(currentNativeAdView, viewParams);
        
        root.addView(nativeAdOverlayContainer, containerParams);
        root.bringChildToFront(nativeAdOverlayContainer);
        nativeAdOverlayContainer.bringToFront();
        nativeAdOverlayContainer.setVisibility(View.VISIBLE);

        nativeAdOverlayContainer.post(() -> Log.d(TAG, "[NativeAd] visible on screen y=" + nativeAdOverlayContainer.getY() + " height=" + nativeAdOverlayContainer.getHeight()));
    }

    private void hideExistingAd() {
        if (nativeAdOverlayContainer != null) {
            ViewGroup parent = (ViewGroup) nativeAdOverlayContainer.getParent();
            if (parent != null) {
                parent.removeView(nativeAdOverlayContainer);
            }
            nativeAdOverlayContainer = null;
        }
        if (currentNativeAdView != null) {
            ViewGroup parent = (ViewGroup) currentNativeAdView.getParent();
            if (parent != null) {
                parent.removeView(currentNativeAdView);
            }
            currentNativeAdView = null;
        }
        if (currentNativeAd != null) {
            currentNativeAd.destroy();
            currentNativeAd = null;
        }
    }
}
