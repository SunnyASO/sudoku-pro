const AdMobConfig = {
    IS_PRODUCTION: true,
    ADS_ENABLED: true,
    COOLDOWN_SECONDS: 90,
    STARTING_HINTS: 3,

    // Live Remote Config merged parameters
    REMOTE: {
        ads_enabled: true,
        ad_test_mode_enabled: false,
        is_debug_build: false,
        banner_ads_enabled: true,
        banner_bottom_margin_dp: 0,
        home_banner_enabled: false,
        home_banner_fallback_enabled: false,
        gameplay_banner_enabled: true,
        native_ads_enabled: true,
        home_native_enabled: true,
        home_native_ad_enabled: true,
        gameplay_native_ad_enabled: true,
        gameplay_native_min_height_dp: 720,
        achievements_native_enabled: true,
        daily_challenge_native_enabled: true,
        native_ad_height_dp: 120,
        native_ad_bottom_margin_dp: 16,
        interstitial_ads_enabled: true,
        completion_interstitial_enabled: true,
        new_game_interstitial_enabled: true,
        abandon_interstitial_enabled: true,
        game_over_interstitial_enabled: true,
        game_over_interstitial_session_cap: 8,
        fullscreen_ad_cooldown_seconds: 60,
        completion_interstitial_every: 1,
        completion_interstitial_session_cap: 8,
        rewarded_ads_enabled: true,
        rewarded_hint_enabled: true,
        mistake_rescue_rewarded_enabled: true,
        daily_challenge_rewarded_enabled: true,
        bonus_rewarded_enabled: true,
        app_open_ads_enabled: true,
        app_open_min_interval_seconds: 120,
        app_open_session_cap: 4,
        app_open_background_threshold_seconds: 45,
        push_notifications_enabled: false,
        push_topic_general_enabled: false,
        starting_free_hints: 3,
        pause_native_ad_enabled: true,
        auto_check_rewarded_enabled: true,
        auto_check_per_puzzle_limit: 1,
        theme_rewarded_unlock_enabled: true,
        theme_unlock_duration_hours: 24,
        review_prompt_enabled: true,
        review_min_completed_puzzles: 2,
        review_min_sessions: 2,
        review_first_cooldown_days: 7,
        review_second_cooldown_days: 21,
        review_later_cooldown_days: 45,
        review_max_local_attempts: 5,
        review_trigger_perfect_solve: true,
        review_trigger_daily_challenge: true,
        review_trigger_achievement: true,
        review_trigger_personal_best: true,
        app_update_enabled: true,
        minimum_supported_version_code: 19,
        force_update_below_version_code: 19,
        flexible_update_below_version_code: 20
    },

    applyRemoteConfig(newValues) {
        if (!newValues || typeof newValues !== 'object') return;
        console.log("[RemoteConfig] Applying remote config values:", newValues);
        Object.assign(this.REMOTE, newValues);

        if (this.REMOTE.ads_enabled !== undefined) {
            this.ADS_ENABLED = !!this.REMOTE.ads_enabled;
        }
        if (this.REMOTE.fullscreen_ad_cooldown_seconds !== undefined) {
            this.COOLDOWN_SECONDS = Number(this.REMOTE.fullscreen_ad_cooldown_seconds);
        }
        if (this.REMOTE.starting_free_hints !== undefined) {
            this.STARTING_HINTS = Number(this.REMOTE.starting_free_hints);
        }
    },

    AD_UNITS: {
        HOME_BANNER: {
            TEST: "ca-app-pub-3940256099942544/6300978111",
            PRODUCTION: "ca-app-pub-2070129323138107/9405681916"
        },

        GAMEPLAY_BANNER: {
            TEST: "ca-app-pub-3940256099942544/6300978111",
            PRODUCTION: "ca-app-pub-2070129323138107/9349841592"
        },

        REWARDED_HINT: {
            TEST: "ca-app-pub-3940256099942544/5224354917",
            PRODUCTION: "ca-app-pub-2070129323138107/4849313637"
        },

        REWARDED_MISTAKE_RESCUE: {
            TEST: "ca-app-pub-3940256099942544/5224354917",
            PRODUCTION: "ca-app-pub-2070129323138107/9191883320"
        },

        DAILY_CHALLENGE_REWARDED: {
            TEST: "ca-app-pub-3940256099942544/5224354917",
            PRODUCTION: "ca-app-pub-2070129323138107/4424817979"
        },

        HOME_NATIVE: {
            TEST: "ca-app-pub-3940256099942544/2247696110",
            PRODUCTION: "ca-app-pub-2070129323138107/2374442509"
        },

        ACHIEVEMENTS_NATIVE: {
            TEST: "ca-app-pub-3940256099942544/2247696110",
            PRODUCTION: "ca-app-pub-2070129323138107/9000311636"
        },

        DAILY_CHALLENGE_NATIVE: {
            TEST: "ca-app-pub-3940256099942544/2247696110",
            PRODUCTION: "ca-app-pub-2070129323138107/4698104549"
        },

        BONUS_REWARDED: {
            TEST: "ca-app-pub-3940256099942544/5224354917",
            PRODUCTION: "ca-app-pub-2070129323138107/6396375193"
        },

        COMPLETION_INTERSTITIAL: {
            TEST: "ca-app-pub-3940256099942544/1033173712",
            PRODUCTION: "ca-app-pub-2070129323138107/6126736289"
        },

        NEW_GAME_INTERSTITIAL: {
            TEST: "ca-app-pub-3940256099942544/1033173712",
            PRODUCTION: "ca-app-pub-2070129323138107/1233502251"
        },

        ABANDON_INTERSTITIAL: {
            TEST: "ca-app-pub-3940256099942544/1033173712",
            PRODUCTION: "ca-app-pub-2070129323138107/8364062982"
        },

        GAME_OVER_INTERSTITIAL: {
            TEST: "ca-app-pub-3940256099942544/1033173712",
            PRODUCTION: "ca-app-pub-2070129323138107/8364062982"
        },

        APP_OPEN: {
            TEST: "ca-app-pub-3940256099942544/9257395921",
            PRODUCTION: "ca-app-pub-2070129323138107/4657741942"
        }
    }
};
