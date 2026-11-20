package com.antigravity.sudokupro.ads;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

/**
 * Strongly typed Interstitial placement identities for Sudoku Pro.
 * Modeled on World Clock's ADUnitPlacements pattern.
 */
public enum InterstitialPlacement {
    COMPLETION("completion"),
    NEW_GAME("new_game"),
    ABANDON("abandon"),
    GAME_OVER("game_over");

    private final String key;

    InterstitialPlacement(@NonNull String key) {
        this.key = key;
    }

    @NonNull
    public String getKey() {
        return key;
    }

    @NonNull
    public static InterstitialPlacement fromString(@Nullable String value) {
        if (value == null || value.trim().isEmpty()) {
            return COMPLETION;
        }
        String normalized = value.trim().toUpperCase();
        for (InterstitialPlacement p : values()) {
            if (p.name().equals(normalized) || p.key.equalsIgnoreCase(value.trim())) {
                return p;
            }
        }
        return COMPLETION;
    }
}
