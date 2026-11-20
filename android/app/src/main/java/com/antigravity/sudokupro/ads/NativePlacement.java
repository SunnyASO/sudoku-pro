package com.antigravity.sudokupro.ads;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

/**
 * Strongly typed Native placement identities for Sudoku Pro.
 * Modeled on World Clock's ADUnitPlacements pattern.
 */
public enum NativePlacement {
    HOME("home", 110, 16, 16),
    GAMEPLAY("gameplay", 105, 12, 12),
    PAUSE("pause", 120, 16, 16),
    VICTORY("victory", 120, 16, 16),
    ACHIEVEMENTS("achievements", 120, 16, 16),
    DAILY_CHALLENGE("daily_challenge", 120, 16, 16);

    private final String key;
    private final int defaultHeightDp;
    private final int defaultBottomMarginDp;
    private final int defaultHorizontalMarginDp;

    NativePlacement(@NonNull String key, int defaultHeightDp, int defaultBottomMarginDp, int defaultHorizontalMarginDp) {
        this.key = key;
        this.defaultHeightDp = defaultHeightDp;
        this.defaultBottomMarginDp = defaultBottomMarginDp;
        this.defaultHorizontalMarginDp = defaultHorizontalMarginDp;
    }

    @NonNull
    public String getKey() {
        return key;
    }

    public int getDefaultHeightDp() {
        return defaultHeightDp;
    }

    public int getDefaultBottomMarginDp() {
        return defaultBottomMarginDp;
    }

    public int getDefaultHorizontalMarginDp() {
        return defaultHorizontalMarginDp;
    }

    @NonNull
    public static NativePlacement fromString(@Nullable String value) {
        if (value == null || value.trim().isEmpty()) {
            return HOME;
        }
        String normalized = value.trim().toUpperCase();
        for (NativePlacement p : values()) {
            if (p.name().equals(normalized) || p.key.equalsIgnoreCase(value.trim())) {
                return p;
            }
        }
        return HOME;
    }
}
