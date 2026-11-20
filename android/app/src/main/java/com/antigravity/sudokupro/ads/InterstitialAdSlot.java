package com.antigravity.sudokupro.ads;

import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.android.gms.ads.interstitial.InterstitialAd;

/**
 * Encapsulates an active interstitial ad slot carrying strict placement identity,
 * generation tokens, SDK ad reference, and timestamp tracking.
 * Modeled on World Clock's InterAdPair pattern.
 */
public class InterstitialAdSlot {

    private static final String TAG = "InterstitialAdSlot";

    // Google AdMob recommended cache validity for interstitial ads (1 hour = 60 * 60 * 1000 ms)
    public static final long INTERSTITIAL_CACHE_VALIDITY_MS = 60 * 60 * 1000L;

    public enum State {
        EMPTY,
        LOADING,
        READY,
        SHOWING,
        CONSUMED,
        FAILED,
        EXPIRED,
        INVALIDATED,
        DISPOSED
    }

    public enum DisposalReason {
        OPPORTUNITY_LEFT,
        PLACEMENT_REPLACED,
        STALE_GENERATION,
        CACHE_EXPIRED,
        PREMIUM,
        REMOTE_CONFIG_DISABLED,
        COOLDOWN,
        SESSION_CAP,
        FULLSCREEN_BUSY,
        BILLING_ACTIVE,
        ACTIVITY_INVALID,
        SHOW_FAILED,
        CONSENT_BLOCKED,
        CONSENT_REVOKED,
        INVALIDATED
    }

    private final InterstitialPlacement placement;
    private final String adUnitId;
    private final long loadGeneration;
    private InterstitialAd interstitialAd;
    private volatile State state;
    private final long loadStartTimestampMs;
    private long loadedTimestampMs;

    public InterstitialAdSlot(@NonNull InterstitialPlacement placement,
                              @NonNull String adUnitId,
                              long loadGeneration) {
        this.placement = placement;
        this.adUnitId = adUnitId;
        this.loadGeneration = loadGeneration;
        this.state = State.LOADING;
        this.loadStartTimestampMs = System.currentTimeMillis();
        this.loadedTimestampMs = 0L;
        this.interstitialAd = null;
    }

    @NonNull
    public InterstitialPlacement getPlacement() {
        return placement;
    }

    @NonNull
    public String getAdUnitId() {
        return adUnitId;
    }

    public long getLoadGeneration() {
        return loadGeneration;
    }

    public State getState() {
        return state;
    }

    public void setState(State state) {
        this.state = state;
    }

    @Nullable
    public InterstitialAd getInterstitialAd() {
        return interstitialAd;
    }

    public void setInterstitialAd(@NonNull InterstitialAd ad) {
        this.interstitialAd = ad;
        this.loadedTimestampMs = System.currentTimeMillis();
        this.state = State.READY;
    }

    public long getLoadStartTimestampMs() {
        return loadStartTimestampMs;
    }

    public long getLoadedTimestampMs() {
        return loadedTimestampMs;
    }

    public long getCacheAgeMs() {
        return loadedTimestampMs > 0 ? (System.currentTimeMillis() - loadedTimestampMs) : 0;
    }

    public boolean isLoaded() {
        return state == State.READY && interstitialAd != null;
    }

    public boolean isExpired() {
        return isExpired(INTERSTITIAL_CACHE_VALIDITY_MS);
    }

    public boolean isExpired(long ttlMs) {
        if (!isLoaded()) return false;
        return (System.currentTimeMillis() - loadedTimestampMs) >= ttlMs;
    }

    public void dispose(@NonNull DisposalReason reason) {
        if (interstitialAd != null) {
            try {
                interstitialAd.setFullScreenContentCallback(null);
                interstitialAd.setOnPaidEventListener(null);
            } catch (Exception ignored) {}
            interstitialAd = null;
        }
        if (state != State.SHOWING) {
            if (reason == DisposalReason.CACHE_EXPIRED) {
                state = State.EXPIRED;
            } else if (reason == DisposalReason.STALE_GENERATION) {
                state = State.INVALIDATED;
            } else {
                state = State.DISPOSED;
            }
        }
        Log.d(TAG, "[InterstitialAdSlot] Disposed slot for placement=" + placement +
                ", gen=" + loadGeneration + ", reason=" + reason);
    }
}
