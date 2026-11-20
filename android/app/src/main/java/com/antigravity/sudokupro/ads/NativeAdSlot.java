package com.antigravity.sudokupro.ads;

import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.android.gms.ads.nativead.NativeAd;

/**
 * Encapsulates an active Native Ad slot carrying strict placement identity,
 * generation tokens, screen generation, SDK ad reference, and timestamp tracking.
 * Modeled on World Clock's NativeAdPair pattern.
 */
public class NativeAdSlot {

    private static final String TAG = "NativeAdSlot";

    // Google AdMob recommended cache validity for Native ad creative/assets (1 hour)
    public static final long NATIVE_CACHE_VALIDITY_MS = 60 * 60 * 1000L;

    public enum State {
        EMPTY,
        LOADING,
        READY,
        RENDERED,
        FAILED,
        EXPIRED,
        INVALIDATED,
        DISPOSED
    }

    public enum DisposalReason {
        SCREEN_LEFT,
        STALE_GENERATION,
        PREMIUM,
        REMOTE_CONFIG_DISABLED,
        ACTIVITY_INVALID,
        CACHE_EXPIRED,
        PLACEMENT_REPLACED,
        LOAD_REPLACED,
        RENDER_FAILED,
        APP_DESTROYED,
        CONSENT_BLOCKED,
        CONSENT_REVOKED,
        INVALIDATED
    }

    private final NativePlacement placement;
    private final String adUnitId;
    private final long loadGeneration;
    private final long screenGeneration;
    private NativeAd nativeAd;
    private volatile State state;
    private final long loadStartTimestampMs;
    private long loadedTimestampMs;
    private long renderedTimestampMs;

    private int heightDp;
    private int bottomMarginDp;
    private int horizontalMarginDp;

    public NativeAdSlot(@NonNull NativePlacement placement,
                        @NonNull String adUnitId,
                        long loadGeneration,
                        long screenGeneration,
                        int heightDp,
                        int bottomMarginDp,
                        int horizontalMarginDp) {
        this.placement = placement;
        this.adUnitId = adUnitId;
        this.loadGeneration = loadGeneration;
        this.screenGeneration = screenGeneration;
        this.state = State.LOADING;
        this.loadStartTimestampMs = System.currentTimeMillis();
        this.loadedTimestampMs = 0L;
        this.renderedTimestampMs = 0L;
        this.nativeAd = null;
        this.heightDp = heightDp;
        this.bottomMarginDp = bottomMarginDp;
        this.horizontalMarginDp = horizontalMarginDp;
    }

    @NonNull
    public NativePlacement getPlacement() {
        return placement;
    }

    @NonNull
    public String getAdUnitId() {
        return adUnitId;
    }

    public long getLoadGeneration() {
        return loadGeneration;
    }

    public long getScreenGeneration() {
        return screenGeneration;
    }

    public State getState() {
        return state;
    }

    public void setState(State state) {
        this.state = state;
    }

    @Nullable
    public NativeAd getNativeAd() {
        return nativeAd;
    }

    public void setNativeAd(@NonNull NativeAd ad) {
        this.nativeAd = ad;
        this.loadedTimestampMs = System.currentTimeMillis();
        this.state = State.READY;
    }

    public void markRendered() {
        this.renderedTimestampMs = System.currentTimeMillis();
        this.state = State.RENDERED;
    }

    public long getLoadStartTimestampMs() {
        return loadStartTimestampMs;
    }

    public long getLoadedTimestampMs() {
        return loadedTimestampMs;
    }

    public long getRenderedTimestampMs() {
        return renderedTimestampMs;
    }

    public long getCacheAgeMs() {
        return loadedTimestampMs > 0 ? (System.currentTimeMillis() - loadedTimestampMs) : 0;
    }

    public int getHeightDp() {
        return heightDp;
    }

    public int getBottomMarginDp() {
        return bottomMarginDp;
    }

    public int getHorizontalMarginDp() {
        return horizontalMarginDp;
    }

    public void updateDimensions(int heightDp, int bottomMarginDp, int horizontalMarginDp) {
        this.heightDp = heightDp;
        this.bottomMarginDp = bottomMarginDp;
        this.horizontalMarginDp = horizontalMarginDp;
    }

    public boolean isLoaded() {
        return (state == State.READY || state == State.RENDERED) && nativeAd != null;
    }

    public boolean isExpired() {
        return isExpired(NATIVE_CACHE_VALIDITY_MS);
    }

    public boolean isExpired(long ttlMs) {
        if (!isLoaded()) return false;
        return (System.currentTimeMillis() - loadedTimestampMs) >= ttlMs;
    }

    public void dispose(@NonNull DisposalReason reason) {
        if (nativeAd != null) {
            try {
                nativeAd.destroy();
            } catch (Exception e) {
                Log.w(TAG, "Exception destroying NativeAd: " + e.getMessage());
            }
            nativeAd = null;
        }
        if (reason == DisposalReason.CACHE_EXPIRED) {
            state = State.EXPIRED;
        } else if (reason == DisposalReason.STALE_GENERATION) {
            state = State.INVALIDATED;
        } else {
            state = State.DISPOSED;
        }
        Log.d(TAG, "[NativeAdSlot] Disposed slot for placement=" + placement +
                ", gen=" + loadGeneration + ", screenGen=" + screenGeneration + ", reason=" + reason);
    }
}
