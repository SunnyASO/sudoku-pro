package com.antigravity.sudokupro.ads;

import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.android.gms.ads.rewarded.RewardedAd;

/**
 * Encapsulates an active rewarded ad slot carrying strict placement identity,
 * generation tokens, SDK ad reference, and timestamp tracking.
 */
public class RewardedAdSlot {

    private static final String TAG = "RewardedAdSlot";

    public enum State {
        EMPTY,
        LOADING,
        READY,
        SHOWING,
        CONSUMED,
        FAILED,
        EXPIRED,
        INVALIDATED
    }

    public enum DisposalReason {
        OPPORTUNITY_LEFT,
        PLACEMENT_REPLACED,
        CACHE_EXPIRED,
        PREMIUM,
        REMOTE_CONFIG_DISABLED,
        FULLSCREEN_BUSY,
        BILLING_ACTIVE,
        STALE_GENERATION,
        ACTIVITY_INVALID,
        SHOW_FAILED,
        CONSENT_BLOCKED,
        CONSENT_REVOKED,
        INVALIDATED
    }

    private final RewardedPlacement placement;
    private final String adUnitId;
    private final long loadGeneration;
    private RewardedAd rewardedAd;
    private volatile State state;
    private final long loadStartTimestampMs;
    private long loadedTimestampMs;

    public RewardedAdSlot(@NonNull RewardedPlacement placement, @NonNull String adUnitId, long loadGeneration) {
        this.placement = placement;
        this.adUnitId = adUnitId;
        this.loadGeneration = loadGeneration;
        this.state = State.LOADING;
        this.loadStartTimestampMs = System.currentTimeMillis();
        this.loadedTimestampMs = 0L;
        this.rewardedAd = null;
    }

    @NonNull
    public RewardedPlacement getPlacement() {
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
    public RewardedAd getRewardedAd() {
        return rewardedAd;
    }

    public void setRewardedAd(@NonNull RewardedAd ad) {
        this.rewardedAd = ad;
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

    // Google AdMob recommended cache validity for rewarded ads (1 hour = 60 * 60 * 1000 ms)
    public static final long REWARDED_CACHE_VALIDITY_MS = 60 * 60 * 1000L;

    public boolean isLoaded() {
        return state == State.READY && rewardedAd != null;
    }

    public boolean isExpired() {
        return isExpired(REWARDED_CACHE_VALIDITY_MS);
    }

    public boolean isExpired(long ttlMs) {
        if (!isLoaded()) return false;
        return (System.currentTimeMillis() - loadedTimestampMs) >= ttlMs;
    }

    public void dispose(@NonNull DisposalReason reason) {
        if (rewardedAd != null) {
            try {
                rewardedAd.setFullScreenContentCallback(null);
                rewardedAd.setOnPaidEventListener(null);
            } catch (Exception ignored) {}
            rewardedAd = null;
        }
        if (state != State.SHOWING) {
            if (reason == DisposalReason.CACHE_EXPIRED) {
                state = State.EXPIRED;
            } else {
                state = State.EMPTY;
            }
        }
        Log.d(TAG, "[RewardedAdSlot] Disposed slot for placement=" + placement + ", reason=" + reason);
    }
}
