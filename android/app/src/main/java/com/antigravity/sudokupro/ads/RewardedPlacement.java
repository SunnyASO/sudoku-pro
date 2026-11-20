package com.antigravity.sudokupro.ads;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

/**
 * Strongly typed rewarded ad placement identities.
 * Ensures cached rewarded ad inventory cannot be cross-consumed by different placements.
 */
public enum RewardedPlacement {
    HINT("rewarded_hint"),
    MISTAKE_RESCUE("rewarded_mistake_rescue"),
    DAILY_CHALLENGE("daily_challenge_rewarded"),
    VICTORY_BONUS("bonus_rewarded"),
    THEME_UNLOCK("theme_unlock_rewarded"),
    AUTO_CHECK("auto_check_rewarded");

    private final String key;

    RewardedPlacement(String key) {
        this.key = key;
    }

    public String getKey() {
        return key;
    }

    @NonNull
    public static RewardedPlacement fromString(@Nullable String name) {
        if (name == null) return HINT;
        String normalized = name.trim().toUpperCase().replace("-", "_");
        switch (normalized) {
            case "MISTAKE_RESCUE":
            case "REWARDED_MISTAKE_RESCUE":
            case "RESCUE":
                return MISTAKE_RESCUE;
            case "DAILY_CHALLENGE":
            case "DAILY_CHALLENGE_REWARDED":
            case "DAILY":
                return DAILY_CHALLENGE;
            case "VICTORY_BONUS":
            case "BONUS_REWARDED":
            case "BONUS":
                return VICTORY_BONUS;
            case "THEME_UNLOCK":
            case "THEME_UNLOCK_REWARDED":
            case "THEME":
                return THEME_UNLOCK;
            case "AUTO_CHECK":
            case "AUTO_CHECK_REWARDED":
                return AUTO_CHECK;
            case "HINT":
            case "REWARDED_HINT":
            default:
                return HINT;
        }
    }
}
