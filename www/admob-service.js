const AdMobService = {

    trackAdEvent(eventName, params = {}) {
        try {
            console.log("Ad Analytics:", eventName, params);
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SudokuAnalytics) {
                window.Capacitor.Plugins.SudokuAnalytics.logEvent({ name: eventName, params }).catch(e => {});
            }
        } catch (e) {}
    },

    logAdState(contextTag = "") {
        const isPremium = !!window.isPremium;
        const adsEnabled = !!(AdMobConfig.ADS_ENABLED && this.isFeatureEnabled('ads_enabled'));
        const testMode = this.isTestModeEnabled();
        const homeNativeEnabled = this.isFeatureEnabled('home_native_enabled');
        const gameplayNativeEnabled = this.isFeatureEnabled('gameplay_native_ad_enabled');
        const bannerEnabled = this.isFeatureEnabled('banner_ads_enabled') && this.isFeatureEnabled('gameplay_banner_enabled');
        const pauseNativeEnabled = this.isFeatureEnabled('pause_native_ad_enabled');
        const nativeActive = !!this.isNativeAdShowing;
        const bannerActive = !!this.isGameplayBannerShowing;
        const fullscreenBusy = this.isAnyFullScreenBusy();
        const initialized = !!this.isInitialized;
        const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
        const canRequest = !!this.canRequestAds();
        const consentStatus = this.consentStatus;
        const privacyRequired = !!this.privacyOptionsRequired;

        console.log(`[AdState]${contextTag ? ' (' + contextTag + ')' : ''} premium: ${isPremium}`);
        console.log(`[AdState] ads_enabled: ${adsEnabled}`);
        console.log(`[AdState] can_request_ads: ${canRequest} (status: ${consentStatus}, privacy_required: ${privacyRequired})`);
        console.log(`[AdState] test_mode: ${testMode}`);
        console.log(`[AdState] home_native_enabled: ${homeNativeEnabled}`);
        console.log(`[AdState] gameplay_native_enabled: ${gameplayNativeEnabled}`);
        console.log(`[AdState] banner_enabled: ${bannerEnabled}`);
        console.log(`[AdState] pause_native_enabled: ${pauseNativeEnabled}`);
        console.log(`[AdState] native_active: ${nativeActive}`);
        console.log(`[AdState] banner_active: ${bannerActive}`);
        console.log(`[AdState] fullscreen_busy: ${fullscreenBusy}`);
        console.log(`[AdState] initialized: ${initialized}`);
        console.log(`[AdState] screen_height: ${screenHeight}`);
    },
    
    isInitialized: false,
    canRequestAdsState: false,
    consentStatus: 'UNKNOWN',
    privacyOptionsRequired: false,
    isConsentGathering: false,

    isRewardedHintLoading: false,
    isRewardedHintShowing: false,

    isMistakeRescueLoading: false,
    isMistakeRescueShowing: false,
    
    isRewardedAdReady: false,
    isRewardedPreloading: false,
    currentPreloadedRewardedKey: null,
    
    isDailyChallengeRewardedLoading: false,
    isDailyChallengeRewardedShowing: false,

    isBonusRewardedLoading: false,
    isBonusRewardedShowing: false,

    isGenericRewardedLoading: false,
    isGenericRewardedShowing: false,

    isCompletionInterstitialLoading: false,
    isCompletionInterstitialShowing: false,

    isNewGameInterstitialLoading: false,
    isNewGameInterstitialShowing: false,

    isAbandonInterstitialLoading: false,
    isAbandonInterstitialShowing: false,

    isGameOverInterstitialLoading: false,
    isGameOverInterstitialShowing: false,

    isGameplayBannerShowing: false,
    isGameplayBannerLoading: false,
    isNativeAdShowing: false,
    isHomeNativeLoading: false,
    currentNativeAdScreen: null,
    _initPromise: null,
    currentBannerHeight: 0,
    hasBannerListeners: false,
    _bannerSizeChangedHandle: null,
    _bannerFailedHandle: null,

    isAppOpenShowing: false,
    hasAppOpenListeners: false,
    isAppOpenInitialized: false,

    completionInterstitialsShownThisSession: 0,
    gameOverInterstitialsShownThisSession: 0,
    lastAdShownAtMs: 0,

    getRemoteValue(key, fallback) {
        if (typeof AdMobConfig !== 'undefined' && AdMobConfig.REMOTE && AdMobConfig.REMOTE[key] !== undefined) {
            return AdMobConfig.REMOTE[key];
        }
        return fallback;
    },

    getNativeAdPlugin() {
        if (typeof window !== 'undefined' && window.Capacitor) {
            if (typeof window.Capacitor.registerPlugin === 'function') {
                return window.Capacitor.registerPlugin('NativeAd');
            }
            return window.Capacitor.Plugins ? window.Capacitor.Plugins.NativeAd : null;
        }
        return null;
    },

    getAppOpenAdPlugin() {
        if (typeof window !== 'undefined' && window.Capacitor) {
            if (typeof window.Capacitor.registerPlugin === 'function') {
                return window.Capacitor.registerPlugin('AppOpenAd');
            }
            return window.Capacitor.Plugins ? window.Capacitor.Plugins.AppOpenAd : null;
        }
        return null;
    },

    getRewardedAdPlugin() {
        if (typeof window !== 'undefined' && window.Capacitor) {
            if (typeof window.Capacitor.registerPlugin === 'function') {
                return window.Capacitor.registerPlugin('RewardedAd');
            }
            return window.Capacitor.Plugins ? window.Capacitor.Plugins.RewardedAd : null;
        }
        return null;
    },

    getInterstitialAdPlugin() {
        if (typeof window !== 'undefined' && window.Capacitor) {
            if (typeof window.Capacitor.registerPlugin === 'function') {
                return window.Capacitor.registerPlugin('InterstitialAd');
            }
            return window.Capacitor.Plugins ? window.Capacitor.Plugins.InterstitialAd : null;
        }
        return null;
    },

    getConsentPlugin() {
        if (typeof window !== 'undefined' && window.Capacitor) {
            if (typeof window.Capacitor.registerPlugin === 'function') {
                return window.Capacitor.registerPlugin('Consent');
            }
            return window.Capacitor.Plugins ? window.Capacitor.Plugins.Consent : null;
        }
        return null;
    },

    /**
     * Authoritative Google UMP consent gathering entrypoint.
     * Must be awaited on application startup before requesting any ads.
     */
    async gatherConsent(options = {}) {
        if (!window.Capacitor || !window.Capacitor.isNativePlatform()) {
            console.log("[AdMobService] Non-native platform: UMP consent marked NOT_REQUIRED.");
            this.canRequestAdsState = true;
            this.consentStatus = 'NOT_REQUIRED';
            this.privacyOptionsRequired = false;
            return { canRequestAds: true, consentStatus: 'NOT_REQUIRED', isPrivacyOptionsRequired: false };
        }

        const Consent = this.getConsentPlugin();
        if (!Consent || typeof Consent.initializeConsent !== 'function') {
            console.warn("[AdMobService] Consent plugin not available. Defaulting canRequestAds to true.");
            this.canRequestAdsState = true;
            return { canRequestAds: true, consentStatus: 'NOT_REQUIRED', isPrivacyOptionsRequired: false };
        }

        try {
            this.isConsentGathering = true;
            console.log("[AdMobService] Requesting UMP consent gathering...", options);
            const res = await Consent.initializeConsent(options);
            this.canRequestAdsState = !!(res && res.canRequestAds);
            this.consentStatus = (res && res.consentStatus) || 'UNKNOWN';
            this.privacyOptionsRequired = !!(res && res.isPrivacyOptionsRequired);
            console.log(`[AdMobService] UMP consent gathered: canRequestAds=${this.canRequestAdsState}, status=${this.consentStatus}, privacyOptionsRequired=${this.privacyOptionsRequired}`);
            return res;
        } catch (err) {
            console.warn("[AdMobService] Error gathering UMP consent (querying disk state):", err);
            try {
                const statusRes = await Consent.getConsentStatus();
                this.canRequestAdsState = !!(statusRes && statusRes.canRequestAds);
                this.consentStatus = (statusRes && statusRes.consentStatus) || 'UNKNOWN';
                this.privacyOptionsRequired = !!(statusRes && statusRes.isPrivacyOptionsRequired);
                return statusRes;
            } catch (e2) {
                this.canRequestAdsState = false;
                return { canRequestAds: false, error: err };
            }
        } finally {
            this.isConsentGathering = false;
        }
    },

    canRequestAds() {
        return !!this.canRequestAdsState;
    },

    isPrivacyOptionsRequired() {
        return !!this.privacyOptionsRequired;
    },

    getConsentStatus() {
        return this.consentStatus;
    },

    /**
     * Opens Google UMP Privacy Options on demand (e.g. from app Settings).
     */
    async showPrivacyOptions() {
        if (!window.Capacitor || !window.Capacitor.isNativePlatform()) {
            console.log("[AdMobService] showPrivacyOptions: Not native platform.");
            return { success: false, reason: 'not_native' };
        }
        const Consent = this.getConsentPlugin();
        if (!Consent || typeof Consent.showPrivacyOptions !== 'function') {
            console.warn("[AdMobService] showPrivacyOptions: Consent plugin unavailable.");
            return { success: false, reason: 'plugin_unavailable' };
        }

        try {
            console.log("[AdMobService] Presenting UMP Privacy Options...");
            const res = await Consent.showPrivacyOptions();
            this.canRequestAdsState = !!(res && res.canRequestAds);
            this.privacyOptionsRequired = !!(res && res.isPrivacyOptionsRequired);
            console.log(`[AdMobService] Privacy options dismissed: canRequestAds=${this.canRequestAdsState}`);

            if (!this.canRequestAdsState) {
                console.log("[AdMobService] Consent revoked via Privacy Options. Hiding all ads.");
                this.hideGameplayBannerAd();
                this.hideHomeBannerAd();
                this.hideNativeAd('home');
                this.hideNativeAd('gameplay');
                this.hideNativeAd('pause');
            } else if (!this.isInitialized) {
                await this.initialize();
            }
            return res;
        } catch (err) {
            console.error("[AdMobService] Error presenting Privacy Options:", err);
            return { success: false, error: err };
        }
    },

    async resetConsent() {
        const Consent = this.getConsentPlugin();
        if (Consent && typeof Consent.resetConsent === 'function') {
            await Consent.resetConsent();
            this.canRequestAdsState = false;
            this.consentStatus = 'UNKNOWN';
            this.privacyOptionsRequired = false;
            this.isAppOpenInitialized = false;
            this.hideGameplayBannerAd();
            this.hideHomeBannerAd();
            this.hideNativeAd('home');
            this.hideNativeAd('gameplay');
            this.hideNativeAd('pause');
            console.log("[AdMobService] Consent reset to UNKNOWN.");
        }
    },

    setSharedFullScreenLocked(locked) {
        try {
            const AppOpenAd = this.getAppOpenAdPlugin();
            if (AppOpenAd && AppOpenAd.setSharedFullScreenLocked) {
                AppOpenAd.setSharedFullScreenLocked({ locked: !!locked });
            }
        } catch (e) {}
        try {
            const RewardedAd = this.getRewardedAdPlugin();
            if (RewardedAd && RewardedAd.setSharedFullScreenLocked) {
                RewardedAd.setSharedFullScreenLocked({ locked: !!locked });
            }
        } catch (e) {}
        try {
            const InterstitialAd = this.getInterstitialAdPlugin();
            if (InterstitialAd && InterstitialAd.setSharedFullScreenLocked) {
                InterstitialAd.setSharedFullScreenLocked({ locked: !!locked });
            }
        } catch (e) {}
    },

    setGameplayActive(active) {
        try {
            const AppOpenAd = this.getAppOpenAdPlugin();
            if (AppOpenAd && AppOpenAd.setGameplayActive) {
                AppOpenAd.setGameplayActive({ active: !!active });
            }
        } catch (e) {}
    },

    setPurchaseActive(active) {
        try {
            const AppOpenAd = this.getAppOpenAdPlugin();
            if (AppOpenAd && AppOpenAd.setPurchaseActive) {
                AppOpenAd.setPurchaseActive({ active: !!active });
            }
        } catch (e) {}
        try {
            const RewardedAd = this.getRewardedAdPlugin();
            if (RewardedAd && RewardedAd.setPurchaseActive) {
                RewardedAd.setPurchaseActive({ active: !!active });
            }
        } catch (e) {}
        try {
            const InterstitialAd = this.getInterstitialAdPlugin();
            if (InterstitialAd && InterstitialAd.setPurchaseActive) {
                InterstitialAd.setPurchaseActive({ active: !!active });
            }
        } catch (e) {}
    },

    async showAdLoadingOverlay(options = {}) {
        const overlay = document.getElementById('ad-loading-overlay');
        if (!overlay) return;
        const iconEl = document.getElementById('ad-loading-icon');
        const titleEl = document.getElementById('ad-loading-title');
        const msgEl = document.getElementById('ad-loading-message');

        if (iconEl && options.icon) iconEl.textContent = options.icon;
        if (titleEl) titleEl.textContent = options.title || "Preparing Advertisement";
        if (msgEl) msgEl.textContent = options.message || "Your puzzle will continue after the ad.";

        overlay.classList.remove('hidden');

        if (this._overlayTimeoutId) {
            clearTimeout(this._overlayTimeoutId);
        }
        this._overlayTimeoutId = setTimeout(() => {
            this.hideAdLoadingOverlay();
        }, 12000);

        // Force browser / WebView to paint the overlay frame before proceeding
        await new Promise((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
            });
        });
    },

    hideAdLoadingOverlay() {
        if (this._overlayTimeoutId) {
            clearTimeout(this._overlayTimeoutId);
            this._overlayTimeoutId = null;
        }
        const overlay = document.getElementById('ad-loading-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    },

    async initialize() {
        if (!AdMobConfig.ADS_ENABLED) {
            console.log("AdMob initialization skipped: ADS_ENABLED is false.");
            return false;
        }

        if (!this.canRequestAds()) {
            const Consent = this.getConsentPlugin();
            if (Consent && typeof Consent.canRequestAds === 'function') {
                try {
                    const check = await Consent.canRequestAds();
                    this.canRequestAdsState = !!(check && check.canRequestAds);
                } catch (e) {}
            }
            if (!this.canRequestAds()) {
                console.log("[AdMobService] initialize skipped: UMP canRequestAds is false.");
                return false;
            }
        }

        if (this.isInitialized) {
            return true;
        }

        if (this._initPromise) {
            return this._initPromise;
        }

        this._initPromise = (async () => {
            try {
                if (!window.Capacitor || !window.Capacitor.isNativePlatform()) {
                    console.log("AdMob initialization skipped: Not running on a native platform.");
                    return false;
                }

                const AdMob = window.Capacitor.Plugins.AdMob;
                if (!AdMob) {
                    console.warn("AdMob plugin not found in window.Capacitor.Plugins.");
                    return false;
                }

                const testMode = this.isTestModeEnabled();
                console.log(`[AdMobService] Initializing AdMob SDK (testMode=${testMode})...`);
                await AdMob.initialize({
                    requestTrackingAuthorization: true,
                    initializeForTesting: testMode,
                });

                this.isInitialized = true;
                console.log("AdMob initialized successfully.");
                await this.initRewardedAd();
                await this.initNativeAd();
                await this.initInterstitialAd();
                return true;
            } catch (error) {
                console.error("Failed to initialize AdMob:", error);
                return false;
            } finally {
                this._initPromise = null;
            }
        })();

        return this._initPromise;
    },

    isTestModeEnabled() {
        try {
            if (typeof AdMobConfig !== 'undefined' && AdMobConfig.REMOTE) {
                // If debug build is detected via RemoteConfigPlugin, enforce test mode to protect debug testing
                if (AdMobConfig.REMOTE.is_debug_build === true) {
                    return true;
                }
                if (AdMobConfig.REMOTE.ad_test_mode_enabled === true) {
                    return true;
                }
            }
            if (typeof localStorage !== 'undefined' && localStorage.getItem('sudoku-ad-test-mode') === 'true') {
                return true;
            }
        } catch (e) {}
        return !AdMobConfig.IS_PRODUCTION;
    },

    getEffectiveViewportHeightDp() {
        let vh = 0, ch = 0, sh = 0, dpr = 1, screenDp = 0;
        if (typeof window !== 'undefined') {
            vh = window.innerHeight || 0;
            ch = (document.documentElement && document.documentElement.clientHeight) || 0;
            sh = (window.screen && window.screen.height) || 0;
            dpr = window.devicePixelRatio || 1;
            screenDp = sh > 0 ? (sh / dpr) : 0;
        }
        const effectiveHeight = vh > 0 ? vh : (ch > 0 ? ch : (screenDp > 0 ? screenDp : 800));
        console.log(`[ViewportCheck] innerHeight=${vh}px, clientHeight=${ch}px, screenHeight=${sh}px, dpr=${dpr}, screenDp=${Math.round(screenDp)}dp => effectiveHeight=${Math.round(effectiveHeight)}dp`);
        return Math.round(effectiveHeight);
    },

    getAdUnitId(placementName) {
        const placement = AdMobConfig.AD_UNITS[placementName];

        if (!placement) {
            console.warn("AdMob placement not found:", placementName);
            return null;
        }

        const useTest = this.isTestModeEnabled();
        return useTest ? placement.TEST : placement.PRODUCTION;
    },

    markAdShown() {
        this.lastAdShownAtMs = Date.now();
    },

    getCooldownRemainingSeconds() {
        const cooldownSeconds = (typeof AdMobConfig !== 'undefined' && AdMobConfig.COOLDOWN_SECONDS != null) 
            ? AdMobConfig.COOLDOWN_SECONDS 
            : 90;
        const cooldownMs = cooldownSeconds * 1000;
        const now = Date.now();

        if (this.lastAdShownAtMs && (now - this.lastAdShownAtMs) < cooldownMs) {
            return Math.max(0, Math.ceil((cooldownMs - (now - this.lastAdShownAtMs)) / 1000));
        }

        return 0;
    },

    isFeatureEnabled(featureKey) {
        if (!AdMobConfig.ADS_ENABLED) return false;
        if (typeof AdMobConfig !== 'undefined' && AdMobConfig.REMOTE) {
            const masterVal = AdMobConfig.REMOTE.ads_enabled;
            if (masterVal === false || masterVal === "false" || masterVal === 0 || masterVal === "0") return false;

            if (featureKey === 'home_native_enabled' || featureKey === 'home_native_ad_enabled') {
                const v1 = AdMobConfig.REMOTE.home_native_enabled;
                const v2 = AdMobConfig.REMOTE.home_native_ad_enabled;
                if (v1 === false || v1 === "false" || v2 === false || v2 === "false") return false;
                return true;
            }

            if (featureKey && AdMobConfig.REMOTE[featureKey] !== undefined) {
                const val = AdMobConfig.REMOTE[featureKey];
                if (val === false || val === "false" || val === 0 || val === "0") return false;
                return true;
            }
        }
        return true;
    },

    isAnyInterstitialBusy() {
        return (
            this.isCompletionInterstitialLoading ||
            this.isCompletionInterstitialShowing ||
            this.isNewGameInterstitialLoading ||
            this.isNewGameInterstitialShowing ||
            this.isAbandonInterstitialLoading ||
            this.isAbandonInterstitialShowing ||
            this.isGameOverInterstitialLoading ||
            this.isGameOverInterstitialShowing
        );
    },

    isAnyFullScreenBusy() {
        return (
            this.isAnyInterstitialBusy() ||
            this.isRewardedHintLoading ||
            this.isRewardedHintShowing ||
            this.isMistakeRescueLoading ||
            this.isMistakeRescueShowing ||
            this.isDailyChallengeRewardedLoading ||
            this.isDailyChallengeRewardedShowing ||
            this.isBonusRewardedLoading ||
            this.isBonusRewardedShowing ||
            this.isGenericRewardedLoading ||
            this.isGenericRewardedShowing ||
            this.isAppOpenShowing
        );
    },

    isCooldownActive(label) {
        const remaining = this.getCooldownRemainingSeconds();
        if (remaining > 0) {
            console.log(`${label} skipped: cooldown active (${remaining}s remaining).`);
            return true;
        }

        return false;
    },

    canShowCompletionInterstitial() {
        if (typeof AdMobConfig !== 'undefined' && AdMobConfig.REMOTE) {
            if (AdMobConfig.REMOTE.interstitial_ads_enabled === false || AdMobConfig.REMOTE.completion_interstitial_enabled === false) {
                console.log("Completion Interstitial skipped: disabled by Remote Config.");
                return false;
            }

            const sessionCap = AdMobConfig.REMOTE.completion_interstitial_session_cap != null
                ? Number(AdMobConfig.REMOTE.completion_interstitial_session_cap)
                : 5;
            if (this.completionInterstitialsShownThisSession >= sessionCap) {
                console.log("Completion Interstitial skipped: session cap reached (" + sessionCap + ").");
                return false;
            }
        }

        if (this.isAnyFullScreenBusy()) {
            console.log("Completion Interstitial skipped: another full-screen ad is busy.");
            return false;
        }

        if (this.isCooldownActive("Completion Interstitial")) {
            return false;
        }

        return true;
    },

    async initRewardedAd() {
        try {
            const RewardedAd = this.getRewardedAdPlugin();
            if (RewardedAd && RewardedAd.init) {
                const enabled = this.isFeatureEnabled('rewarded_ads_enabled');
                const premium = !!window.isPremium;
                const testMode = this.isTestModeEnabled();
                await RewardedAd.init({
                    enabled,
                    isPremium: premium,
                    testMode
                });
                if (RewardedAd.configureUnits) {
                    await RewardedAd.configureUnits({
                        units: {
                            HINT: this.getAdUnitId("REWARDED_HINT") || "",
                            MISTAKE_RESCUE: this.getAdUnitId("REWARDED_MISTAKE_RESCUE") || "",
                            DAILY_CHALLENGE: this.getAdUnitId("DAILY_CHALLENGE_REWARDED") || "",
                            VICTORY_BONUS: this.getAdUnitId("BONUS_REWARDED") || "",
                            THEME_UNLOCK: this.getAdUnitId("BONUS_REWARDED") || "",
                            AUTO_CHECK: this.getAdUnitId("REWARDED_HINT") || ""
                        }
                    });
                }
                console.log("[AdMobService] RewardedAd native plugin initialized successfully.");
            }
        } catch (e) {
            console.warn("[AdMobService] initRewardedAd failed:", e);
        }
    },

    async initNativeAd() {
        try {
            const NativeAd = this.getNativeAdPlugin();
            if (NativeAd && NativeAd.configure) {
                const enabled = this.isFeatureEnabled('native_ads_enabled');
                const premium = !!window.isPremium;
                const testMode = this.isTestModeEnabled();
                await NativeAd.configure({
                    enabled,
                    isPremium: premium,
                    testMode
                });
                if (NativeAd.configureUnits) {
                    await NativeAd.configureUnits({
                        units: {
                            HOME: this.getAdUnitId("HOME_NATIVE") || "",
                            GAMEPLAY: this.getAdUnitId("HOME_NATIVE") || "",
                            PAUSE: this.getAdUnitId("HOME_NATIVE") || "",
                            VICTORY: this.getAdUnitId("HOME_NATIVE") || "",
                            ACHIEVEMENTS: this.getAdUnitId("ACHIEVEMENTS_NATIVE") || "",
                            DAILY_CHALLENGE: this.getAdUnitId("DAILY_CHALLENGE_NATIVE") || ""
                        }
                    });
                }
                console.log("[AdMobService] NativeAd native plugin initialized successfully.");
            }
        } catch (e) {
            console.warn("[AdMobService] initNativeAd failed:", e);
        }
    },

    async initInterstitialAd() {
        try {
            const InterstitialAd = this.getInterstitialAdPlugin();
            if (InterstitialAd && InterstitialAd.init) {
                const enabled = this.isFeatureEnabled('interstitial_ads_enabled');
                const premium = !!window.isPremium;
                const testMode = this.isTestModeEnabled();
                await InterstitialAd.init({
                    enabled,
                    isPremium: premium,
                    testMode
                });
                if (InterstitialAd.configureUnits) {
                    await InterstitialAd.configureUnits({
                        units: {
                            COMPLETION: this.getAdUnitId("COMPLETION_INTERSTITIAL") || "",
                            NEW_GAME: this.getAdUnitId("NEW_GAME_INTERSTITIAL") || "",
                            ABANDON: this.getAdUnitId("ABANDON_INTERSTITIAL") || "",
                            GAME_OVER: this.getAdUnitId("GAME_OVER_INTERSTITIAL") || this.getAdUnitId("ABANDON_INTERSTITIAL") || ""
                        }
                    });
                }
                if (InterstitialAd.configurePlacementFlags) {
                    await InterstitialAd.configurePlacementFlags({
                        flags: {
                            COMPLETION: this.isFeatureEnabled('completion_interstitial_enabled'),
                            NEW_GAME: this.isFeatureEnabled('new_game_interstitial_enabled'),
                            ABANDON: this.isFeatureEnabled('abandon_interstitial_enabled'),
                            GAME_OVER: this.isFeatureEnabled('game_over_interstitial_enabled')
                        }
                    });
                }
                if (InterstitialAd.configurePolicies) {
                    const cooldown = (typeof AdMobConfig !== 'undefined' && AdMobConfig.REMOTE && AdMobConfig.REMOTE.fullscreen_ad_cooldown_seconds != null)
                        ? Number(AdMobConfig.REMOTE.fullscreen_ad_cooldown_seconds)
                        : ((typeof AdMobConfig !== 'undefined' && AdMobConfig.COOLDOWN_SECONDS != null) ? AdMobConfig.COOLDOWN_SECONDS : 60);
                    const completionCap = (typeof AdMobConfig !== 'undefined' && AdMobConfig.REMOTE && AdMobConfig.REMOTE.completion_interstitial_session_cap != null)
                        ? Number(AdMobConfig.REMOTE.completion_interstitial_session_cap)
                        : 8;
                    const gameOverCap = (typeof AdMobConfig !== 'undefined' && AdMobConfig.REMOTE && AdMobConfig.REMOTE.game_over_interstitial_session_cap != null)
                        ? Number(AdMobConfig.REMOTE.game_over_interstitial_session_cap)
                        : 8;
                    await InterstitialAd.configurePolicies({
                        cooldownSeconds: cooldown,
                        completionCap: completionCap,
                        gameOverCap: gameOverCap
                    });
                }
                console.log("[AdMobService] InterstitialAd native plugin initialized successfully.");
            }
        } catch (e) {
            console.warn("[AdMobService] initInterstitialAd failed:", e);
        }
    },

    async prepareInterstitial(placement, adUnitKey = null) {
        if (window.isPremium || !AdMobConfig.ADS_ENABLED) return false;
        if (!this.isFeatureEnabled('interstitial_ads_enabled')) return false;

        // Pre-network placement-specific enable check
        if (placement === 'COMPLETION' && !this.isFeatureEnabled('completion_interstitial_enabled')) return false;
        if (placement === 'NEW_GAME' && !this.isFeatureEnabled('new_game_interstitial_enabled')) return false;
        if (placement === 'ABANDON' && !this.isFeatureEnabled('abandon_interstitial_enabled')) return false;
        if (placement === 'GAME_OVER' && !this.isFeatureEnabled('game_over_interstitial_enabled')) return false;

        const InterstitialAd = this.getInterstitialAdPlugin();
        if (InterstitialAd && InterstitialAd.prepare) {
            try {
                const adId = adUnitKey ? this.getAdUnitId(adUnitKey) : undefined;
                const res = await InterstitialAd.prepare({
                    placement: placement,
                    adUnitId: adId
                });
                return !!(res && res.prepared);
            } catch (e) {
                console.warn(`[AdMobService] prepareInterstitial (${placement}) failed:`, e);
                return false;
            }
        }
        return false;
    },

    async isInterstitialReady(placement) {
        if (window.isPremium || !AdMobConfig.ADS_ENABLED) return false;
        const InterstitialAd = this.getInterstitialAdPlugin();
        if (InterstitialAd && InterstitialAd.isReady) {
            try {
                const res = await InterstitialAd.isReady({ placement });
                return !!(res && res.ready);
            } catch (e) {
                return false;
            }
        }
        return false;
    },

    async isInterstitialEligible(placement) {
        if (window.isPremium || !AdMobConfig.ADS_ENABLED) return false;
        const InterstitialAd = this.getInterstitialAdPlugin();
        if (InterstitialAd && InterstitialAd.isEligible) {
            try {
                const res = await InterstitialAd.isEligible({ placement });
                return !!(res && res.eligible);
            } catch (e) {
                return false;
            }
        }
        return true;
    },

    async disposeInterstitial(placement = null, reason = 'OPPORTUNITY_LEFT') {
        const InterstitialAd = this.getInterstitialAdPlugin();
        if (InterstitialAd && InterstitialAd.dispose) {
            try {
                await InterstitialAd.dispose({ placement, reason });
            } catch (e) {}
        }
    },

    async prepareRewarded(placement, adUnitKey = null) {
        if (window.isPremium || !AdMobConfig.ADS_ENABLED) return false;
        if (!this.isFeatureEnabled('rewarded_ads_enabled')) return false;

        const RewardedAd = this.getRewardedAdPlugin();
        if (RewardedAd && RewardedAd.prepare) {
            try {
                const adId = adUnitKey ? this.getAdUnitId(adUnitKey) : undefined;
                const res = await RewardedAd.prepare({
                    placement: placement,
                    adUnitId: adId
                });
                return !!(res && res.prepared);
            } catch (e) {
                console.warn(`[AdMobService] prepareRewarded (${placement}) failed:`, e);
                return false;
            }
        }
        return false;
    },

    async isRewardedReady(placement) {
        if (window.isPremium || !AdMobConfig.ADS_ENABLED) return false;
        const RewardedAd = this.getRewardedAdPlugin();
        if (RewardedAd && RewardedAd.isReady) {
            try {
                const res = await RewardedAd.isReady({ placement });
                return !!(res && res.ready);
            } catch (e) {
                return false;
            }
        }
        return this.isRewardedAdReady;
    },

    async disposeRewarded(placement = null, reason = 'OPPORTUNITY_LEFT') {
        const RewardedAd = this.getRewardedAdPlugin();
        if (RewardedAd && RewardedAd.dispose) {
            try {
                await RewardedAd.dispose({ placement, reason });
            } catch (e) {}
        }
        this.isRewardedAdReady = false;
        this.currentPreloadedRewardedKey = null;
    },

    async preloadRewardedAd(adUnitKey = "REWARDED_MISTAKE_RESCUE") {
        // Speculative startup/dismissal preload removed in favor of intent-proximate prepareRewarded()
        console.log(`[AdMobService] Legacy preloadRewardedAd ignored for ${adUnitKey} (replaced by native intent-proximate preparation).`);
        return false;
    },

    async showRewardedHintAd() {
        if (window.isPremium) {
            this.hideAdLoadingOverlay();
            this.trackAdEvent('ad_skipped', { reason: 'premium_reward_auto_grant', placement: 'rewarded_hint' });
            return true;
        }
        if (!AdMobConfig.ADS_ENABLED) {
            this.hideAdLoadingOverlay();
            console.log("Rewarded Hint skipped: ADS_ENABLED is false.");
            return false;
        }

        if (typeof AdMobConfig !== 'undefined' && AdMobConfig.REMOTE) {
            if (AdMobConfig.REMOTE.rewarded_ads_enabled === false || AdMobConfig.REMOTE.rewarded_hint_enabled === false) {
                this.hideAdLoadingOverlay();
                console.log("Rewarded Hint skipped: disabled by Remote Config.");
                return false;
            }
        }

        if (this.isRewardedHintLoading || this.isRewardedHintShowing) {
            this.hideAdLoadingOverlay();
            console.log("Rewarded Hint skipped: ad already loading or showing.");
            return false;
        }

        const initialized = await this.initialize();
        if (!initialized) {
            this.hideAdLoadingOverlay();
            console.log("Rewarded Hint skipped: AdMob not initialized.");
            return false;
        }

        const RewardedAd = this.getRewardedAdPlugin();
        if (RewardedAd && RewardedAd.show) {
            try {
                this.isRewardedHintLoading = true;
                const isReady = await this.isRewardedReady('HINT');
                if (!isReady) {
                    await this.showAdLoadingOverlay({
                        icon: "lightbulb",
                        title: "Preparing Advertisement",
                        message: "Preparing your hint advertisement."
                    });
                    await this.prepareRewarded('HINT', 'REWARDED_HINT');
                }
                this.isRewardedHintLoading = false;
                this.isRewardedHintShowing = true;
                this.trackAdEvent('ad_show_attempt', { placement: 'rewarded_hint', ad_type: 'rewarded' });

                const res = await RewardedAd.show({ placement: 'HINT' });
                this.hideAdLoadingOverlay();
                this.isRewardedHintShowing = false;
                this.markAdShown();

                if (res && res.shown) {
                    this.trackAdEvent('ad_shown', { placement: 'rewarded_hint', ad_type: 'rewarded' });
                    return !!res.rewardEarned;
                }
                return false;
            } catch (e) {
                this.hideAdLoadingOverlay();
                this.isRewardedHintLoading = false;
                this.isRewardedHintShowing = false;
                console.error("Rewarded Hint native show error:", e);
                return false;
            }
        }

        const adId = this.getAdUnitId("REWARDED_HINT");
        if (!adId) {
            this.hideAdLoadingOverlay();
            console.log("Rewarded Hint skipped: missing ad unit ID.");
            return false;
        }

        let showedHandle = null;
        try {
            const AdMob = window.Capacitor.Plugins.AdMob;

            if (!AdMob) {
                this.hideAdLoadingOverlay();
                console.warn("Rewarded Hint unavailable: AdMob plugin not found.");
                return false;
            }

            this.isRewardedHintLoading = true;
            this.setSharedFullScreenLocked(true);

            if (!this.isRewardedAdReady) {
                await this.showAdLoadingOverlay({
                    icon: "lightbulb",
                    title: "Preparing Advertisement",
                    message: "Preparing your hint advertisement."
                });

                await AdMob.prepareRewardVideoAd({
                    adId: adId,
                    isTesting: !AdMobConfig.IS_PRODUCTION,
                });
            }

            this.isRewardedHintLoading = false;
            this.isRewardedHintShowing = true;

            if (typeof AdMob.addListener === 'function') {
                AdMob.addListener('onRewardedVideoAdShowed', () => {
                    this.hideAdLoadingOverlay();
                }).then(h => { showedHandle = h; }).catch(() => {});
            }

            this.trackAdEvent('ad_show_attempt', { placement: 'rewarded_hint', ad_type: 'rewarded' });
            const rewardItem = await AdMob.showRewardVideoAd();
            this.trackAdEvent('ad_shown', { placement: 'rewarded_hint', ad_type: 'rewarded' });

            this.isRewardedHintShowing = false;
            this.isRewardedAdReady = false;
            this.markAdShown();

            if (rewardItem) {
                console.log("Rewarded Hint earned:", rewardItem);
                return true;
            }

            console.log("Rewarded Hint closed without reward.");
            return false;
        } catch (error) {
            this.hideAdLoadingOverlay();
            this.isRewardedHintLoading = false;
            this.isRewardedHintShowing = false;
            this.isRewardedAdReady = false;

            console.error("Rewarded Hint failed:", error);
            return false;
        } finally {
            if (showedHandle && typeof showedHandle.remove === 'function') {
                try { showedHandle.remove(); } catch (e) {}
            }
            this.hideAdLoadingOverlay();
            this.setSharedFullScreenLocked(false);
        }
    },

    async showMistakeRescueAd() {
        if (window.isPremium) {
            this.hideAdLoadingOverlay();
            this.trackAdEvent('ad_skipped', { reason: 'premium_reward_auto_grant', placement: 'rewarded_mistake_rescue' });
            return true;
        }
        if (!this.isFeatureEnabled('rewarded_ads_enabled') || !this.isFeatureEnabled('mistake_rescue_rewarded_enabled')) {
            this.hideAdLoadingOverlay();
            console.log("Mistake Rescue skipped: disabled by Remote Config or master switch.");
            return false;
        }

        if (this.isMistakeRescueLoading || this.isMistakeRescueShowing) {
            this.hideAdLoadingOverlay();
            console.log("Mistake Rescue skipped: ad already loading or showing.");
            return false;
        }

        const initialized = await this.initialize();
        if (!initialized) {
            this.hideAdLoadingOverlay();
            console.log("Mistake Rescue skipped: AdMob not initialized.");
            return false;
        }

        const RewardedAd = this.getRewardedAdPlugin();
        if (RewardedAd && RewardedAd.show) {
            try {
                this.isMistakeRescueLoading = true;
                const isReady = await this.isRewardedReady('MISTAKE_RESCUE');
                if (!isReady) {
                    await this.showAdLoadingOverlay({
                        icon: "favorite",
                        title: "Preparing Advertisement",
                        message: "Watch the ad to continue your puzzle."
                    });
                    await this.prepareRewarded('MISTAKE_RESCUE', 'REWARDED_MISTAKE_RESCUE');
                }
                this.isMistakeRescueLoading = false;
                this.isMistakeRescueShowing = true;
                this.trackAdEvent('ad_show_attempt', { placement: 'rewarded_mistake_rescue', ad_type: 'rewarded' });

                const res = await RewardedAd.show({ placement: 'MISTAKE_RESCUE' });
                this.hideAdLoadingOverlay();
                this.isMistakeRescueShowing = false;
                this.markAdShown();

                if (res && res.shown) {
                    this.trackAdEvent('ad_shown', { placement: 'rewarded_mistake_rescue', ad_type: 'rewarded' });
                    return !!res.rewardEarned;
                }
                return false;
            } catch (e) {
                this.hideAdLoadingOverlay();
                this.isMistakeRescueLoading = false;
                this.isMistakeRescueShowing = false;
                console.error("Mistake Rescue native show error:", e);
                return false;
            }
        }

        const adId = this.getAdUnitId("REWARDED_MISTAKE_RESCUE");
        if (!adId) {
            this.hideAdLoadingOverlay();
            console.log("Mistake Rescue skipped: missing ad unit ID.");
            return false;
        }

        let showedHandle = null;
        try {
            const AdMob = window.Capacitor.Plugins.AdMob;

            if (!AdMob) {
                this.hideAdLoadingOverlay();
                console.warn("Mistake Rescue unavailable: AdMob plugin not found.");
                return false;
            }

            this.isMistakeRescueLoading = true;
            this.setSharedFullScreenLocked(true);

            if (!this.isRewardedAdReady) {
                await this.showAdLoadingOverlay({
                    icon: "favorite",
                    title: "Preparing Advertisement",
                    message: "Watch the ad to continue your puzzle."
                });

                await AdMob.prepareRewardVideoAd({
                    adId: adId,
                    isTesting: !AdMobConfig.IS_PRODUCTION,
                });
            }

            this.isMistakeRescueLoading = false;
            this.isMistakeRescueShowing = true;

            if (typeof AdMob.addListener === 'function') {
                AdMob.addListener('onRewardedVideoAdShowed', () => {
                    this.hideAdLoadingOverlay();
                }).then(h => { showedHandle = h; }).catch(() => {});
            }

            this.trackAdEvent('ad_show_attempt', { placement: 'rewarded_mistake_rescue', ad_type: 'rewarded' });
            const rewardItem = await AdMob.showRewardVideoAd();
            this.trackAdEvent('ad_shown', { placement: 'rewarded_mistake_rescue', ad_type: 'rewarded' });

            this.isMistakeRescueShowing = false;
            this.isRewardedAdReady = false;
            this.markAdShown();

            if (rewardItem) {
                console.log("Mistake Rescue earned:", rewardItem);
                return true;
            }

            console.log("Mistake Rescue closed without reward.");
            return false;
        } catch (error) {
            this.hideAdLoadingOverlay();
            this.isMistakeRescueLoading = false;
            this.isMistakeRescueShowing = false;
            this.isRewardedAdReady = false;

            console.error("Mistake Rescue failed:", error);
            return false;
        } finally {
            if (showedHandle && typeof showedHandle.remove === 'function') {
                try { showedHandle.remove(); } catch (e) {}
            }
            this.hideAdLoadingOverlay();
            this.setSharedFullScreenLocked(false);
        }
    },

    waitForRewardedAdLifecycle(AdMob, onAdOpened) {
        if (!AdMob || typeof AdMob.addListener !== 'function') {
            if (typeof onAdOpened === 'function') {
                try { onAdOpened(); } catch (e) {}
            }
            const p = Promise.resolve({ success: false, reason: 'listeners_unavailable' });
            p.cancel = () => {};
            return p;
        }

        let cleanupFn = null;
        const promise = new Promise((resolve) => {
            let showedHandle = null;
            let dismissedHandle = null;
            let failedHandle = null;
            let rewardHandle = null;
            let timeoutId = null;
            let resolved = false;

            let earnedReward = false;
            let rewardItem = null;

            const cleanup = (result) => {
                if (resolved) return;
                resolved = true;

                if (typeof onAdOpened === 'function') {
                    try { onAdOpened(); } catch (e) {}
                }

                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                if (showedHandle && typeof showedHandle.remove === 'function') {
                    try { showedHandle.remove(); } catch (e) {}
                    showedHandle = null;
                }
                if (dismissedHandle && typeof dismissedHandle.remove === 'function') {
                    try { dismissedHandle.remove(); } catch (e) {}
                    dismissedHandle = null;
                }
                if (failedHandle && typeof failedHandle.remove === 'function') {
                    try { failedHandle.remove(); } catch (e) {}
                    failedHandle = null;
                }
                if (rewardHandle && typeof rewardHandle.remove === 'function') {
                    try { rewardHandle.remove(); } catch (e) {}
                    rewardHandle = null;
                }
                resolve(result);
            };

            cleanupFn = () => cleanup({ success: false, reason: 'cancelled_or_disposed' });

            // 90s safety timeout to ensure UI is never stuck indefinitely
            timeoutId = setTimeout(() => {
                console.warn("[DailyAd] Rewarded ad lifecycle timed out after 90s");
                cleanup({
                    success: earnedReward,
                    reason: earnedReward ? 'reward_earned' : 'timeout',
                    rewardItem: rewardItem
                });
            }, 90000);

            try {
                // 1. onRewardedVideoAdShowed: Hide ad loading overlay
                AdMob.addListener('onRewardedVideoAdShowed', () => {
                    console.log("[DailyAd] Event: onRewardedVideoAdShowed");
                    if (typeof onAdOpened === 'function') {
                        try { onAdOpened(); } catch (e) {}
                    }
                }).then(h => {
                    showedHandle = h;
                    if (resolved && h && typeof h.remove === 'function') {
                        try { h.remove(); } catch (e) {}
                        showedHandle = null;
                    }
                }).catch(() => {});

                // 2. onRewardedVideoAdReward: User earned reward during playback
                AdMob.addListener('onRewardedVideoAdReward', (reward) => {
                    console.log("[DailyAd] Event: onRewardedVideoAdReward earned:", reward);
                    earnedReward = true;
                    rewardItem = reward || { type: 'daily_challenge', amount: 1 };
                }).then(h => {
                    rewardHandle = h;
                    if (resolved && h && typeof h.remove === 'function') {
                        try { h.remove(); } catch (e) {}
                        rewardHandle = null;
                    }
                }).catch(() => {});

                // 3. onRewardedVideoAdFailedToShow: Ad presentation failed
                AdMob.addListener('onRewardedVideoAdFailedToShow', (err) => {
                    console.error("[DailyAd] Event: onRewardedVideoAdFailedToShow:", err);
                    cleanup({ success: false, reason: 'failed_to_show', error: err });
                }).then(h => {
                    failedHandle = h;
                    if (resolved && h && typeof h.remove === 'function') {
                        try { h.remove(); } catch (e) {}
                        failedHandle = null;
                    }
                }).catch((e) => cleanup({ success: false, reason: 'failed_to_show', error: e }));

                // 4. onRewardedVideoAdDismissed: Ad screen closed by user
                AdMob.addListener('onRewardedVideoAdDismissed', () => {
                    console.log("[DailyAd] Event: onRewardedVideoAdDismissed. Earned:", earnedReward);
                    if (earnedReward) {
                        cleanup({ success: true, reason: 'reward_earned', rewardItem: rewardItem });
                    } else {
                        cleanup({ success: false, reason: 'user_cancelled_before_reward' });
                    }
                }).then(h => {
                    dismissedHandle = h;
                    if (resolved && h && typeof h.remove === 'function') {
                        try { h.remove(); } catch (e) {}
                        dismissedHandle = null;
                    }
                }).catch((e) => cleanup({ success: false, reason: 'user_cancelled_before_reward', error: e }));
            } catch (e) {
                console.error("[DailyAd] Failed to register rewarded lifecycle listeners:", e);
                cleanup({ success: false, reason: 'listener_registration_error', error: e });
            }
        });

        promise.cancel = () => {
            if (cleanupFn) cleanupFn();
        };

        return promise;
    },

    async showDailyChallengeRewardedAd() {
        console.log("[DailyAd] Initiating Daily Challenge rewarded flow");
        await this.showAdLoadingOverlay({
            icon: "event",
            title: "Preparing Advertisement",
            message: "Preparing today's challenge advertisement."
        });

        if (window.isPremium) {
            console.log("[DailyAd] User has premium - auto-granting reward");
            this.hideAdLoadingOverlay();
            this.trackAdEvent('ad_skipped', { reason: 'premium_reward_auto_grant', placement: 'daily_challenge_rewarded' });
            return { success: true, reason: 'premium_auto_grant' };
        }

        const isRewardedMasterEnabled = this.isFeatureEnabled('rewarded_ads_enabled');
        const isDailyAdEnabled = this.isFeatureEnabled('daily_challenge_rewarded_enabled');
        console.log(`[DailyAd] Effective Remote Config: rewarded_ads_enabled=${isRewardedMasterEnabled}, daily_challenge_rewarded_enabled=${isDailyAdEnabled}`);

        if (!isRewardedMasterEnabled || !isDailyAdEnabled) {
            this.hideAdLoadingOverlay();
            console.log("[DailyAd] Skipped: disabled by Remote Config or master switch");
            return { success: false, reason: 'disabled_by_remote_config' };
        }

        if (this.isDailyChallengeRewardedLoading || this.isDailyChallengeRewardedShowing) {
            this.hideAdLoadingOverlay();
            console.log("[DailyAd] Skipped: ad already loading or showing");
            return { success: false, reason: 'ad_already_in_flight' };
        }

        const initialized = await this.initialize();
        if (!initialized) {
            this.hideAdLoadingOverlay();
            console.warn("[DailyAd] Skipped: AdMob not initialized");
            return { success: false, reason: 'admob_not_initialized' };
        }

        const RewardedAd = this.getRewardedAdPlugin();
        if (RewardedAd && RewardedAd.show) {
            try {
                this.isDailyChallengeRewardedLoading = true;
                const isReady = await this.isRewardedReady('DAILY_CHALLENGE');
                if (!isReady) {
                    await this.prepareRewarded('DAILY_CHALLENGE', 'DAILY_CHALLENGE_REWARDED');
                }
                this.isDailyChallengeRewardedLoading = false;
                this.isDailyChallengeRewardedShowing = true;

                this.trackAdEvent('ad_show_attempt', { placement: 'daily_challenge_rewarded', ad_type: 'rewarded' });
                const res = await RewardedAd.show({ placement: 'DAILY_CHALLENGE' });
                this.hideAdLoadingOverlay();
                this.isDailyChallengeRewardedShowing = false;
                this.markAdShown();

                if (res && res.shown) {
                    this.trackAdEvent('ad_shown', { placement: 'daily_challenge_rewarded', ad_type: 'rewarded' });
                    return { success: !!res.rewardEarned, reason: res.rewardEarned ? 'reward_earned' : 'dismissed_without_reward' };
                }
                return { success: false, reason: res && res.reason ? res.reason : 'show_failed' };
            } catch (e) {
                this.hideAdLoadingOverlay();
                this.isDailyChallengeRewardedLoading = false;
                this.isDailyChallengeRewardedShowing = false;
                return { success: false, reason: 'exception: ' + e };
            }
        }

        const adId = this.getAdUnitId("DAILY_CHALLENGE_REWARDED");
        const isTesting = this.isTestModeEnabled();
        console.log(`[DailyAd] Ad unit selected: ${adId} (isTesting=${isTesting})`);

        if (!adId) {
            this.hideAdLoadingOverlay();
            console.warn("[DailyAd] Skipped: missing ad unit ID");
            return { success: false, reason: 'missing_ad_unit_id' };
        }

        let lifecyclePromise = null;
        try {
            const AdMob = window.Capacitor.Plugins.AdMob;

            if (!AdMob) {
                this.hideAdLoadingOverlay();
                console.warn("[DailyAd] Unavailable: AdMob plugin not found");
                return { success: false, reason: 'plugin_not_found' };
            }

            this.isDailyChallengeRewardedLoading = true;
            this.setSharedFullScreenLocked(true);

            console.log(`[DailyAd] Preparing rewarded ad: adId=${adId}, isTesting=${isTesting}`);
            try {
                await AdMob.prepareRewardVideoAd({
                    adId: adId,
                    isTesting: isTesting,
                });
                console.log("[DailyAd] Rewarded ad successfully loaded into memory");
            } catch (prepareError) {
                console.error("[DailyAd] prepareRewardVideoAd failed (ad not filled / network error):", prepareError);
                this.hideAdLoadingOverlay();
                this.isDailyChallengeRewardedLoading = false;
                return { success: false, reason: 'failed_to_load', error: prepareError };
            }

            this.isDailyChallengeRewardedLoading = false;
            this.isDailyChallengeRewardedShowing = true;

            // Register lifecycle listeners before invoking showRewardVideoAd
            lifecyclePromise = this.waitForRewardedAdLifecycle(AdMob, () => {
                this.hideAdLoadingOverlay();
            });

            this.trackAdEvent('ad_show_attempt', { placement: 'daily_challenge_rewarded', ad_type: 'rewarded' });
            console.log("[DailyAd] Calling AdMob.showRewardVideoAd()");
            
            // Note: AdMob.showRewardVideoAd() resolves with reward info when earned in plugin,
            // or on dismissal. We run it in parallel with our lifecyclePromise which awaits dismissal.
            const showPromise = AdMob.showRewardVideoAd().catch(e => {
                console.warn("[DailyAd] showRewardVideoAd error or early close:", e);
                return null;
            });

            // Wait for full dismissal event
            const lifecycleResult = await lifecyclePromise;
            const directShowResult = await showPromise;

            this.isDailyChallengeRewardedShowing = false;
            this.markAdShown();

            console.log("[DailyAd] Lifecycle completed:", lifecycleResult, "DirectShowResult:", directShowResult);

            if (lifecycleResult.success || (directShowResult && (directShowResult.type || directShowResult.amount))) {
                console.log("[DailyAd] Confirmed reward earned for Daily Challenge");
                this.trackAdEvent('ad_shown', { placement: 'daily_challenge_rewarded', ad_type: 'rewarded' });
                return {
                    success: true,
                    reason: 'reward_earned',
                    rewardItem: lifecycleResult.rewardItem || directShowResult
                };
            }

            console.log("[DailyAd] Ad finished without reward. Reason:", lifecycleResult.reason);
            return lifecycleResult;
        } catch (error) {
            this.hideAdLoadingOverlay();
            this.isDailyChallengeRewardedLoading = false;
            this.isDailyChallengeRewardedShowing = false;

            console.error("[DailyAd] Unexpected failure during rewarded ad presentation:", error);
            return { success: false, reason: 'exception', error: error };
        } finally {
            if (lifecyclePromise && typeof lifecyclePromise.cancel === 'function') {
                lifecyclePromise.cancel();
            }
            this.hideAdLoadingOverlay();
            this.setSharedFullScreenLocked(false);
        }
    },

    async showBonusRewardedAd() {
        await this.showAdLoadingOverlay({
            icon: "redeem",
            title: "Preparing Advertisement",
            message: "Preparing your bonus reward."
        });

        if (window.isPremium) {
            this.hideAdLoadingOverlay();
            this.trackAdEvent('ad_skipped', { reason: 'premium_reward_auto_grant', placement: 'bonus_rewarded' });
            return true;
        }
        if (!this.isFeatureEnabled('rewarded_ads_enabled') || !this.isFeatureEnabled('bonus_rewarded_enabled')) {
            this.hideAdLoadingOverlay();
            console.log("Bonus Rewarded skipped: disabled by Remote Config or master switch.");
            return false;
        }

        if (this.isBonusRewardedLoading || this.isBonusRewardedShowing) {
            this.hideAdLoadingOverlay();
            console.log("Bonus Rewarded skipped: ad already loading or showing.");
            return false;
        }

        const initialized = await this.initialize();
        if (!initialized) {
            this.hideAdLoadingOverlay();
            console.log("Bonus Rewarded skipped: AdMob not initialized.");
            return false;
        }

        const RewardedAd = this.getRewardedAdPlugin();
        if (RewardedAd && RewardedAd.show) {
            try {
                this.isBonusRewardedLoading = true;
                const isReady = await this.isRewardedReady('VICTORY_BONUS');
                if (!isReady) {
                    await this.prepareRewarded('VICTORY_BONUS', 'BONUS_REWARDED');
                }
                this.isBonusRewardedLoading = false;
                this.isBonusRewardedShowing = true;

                this.trackAdEvent('ad_show_attempt', { placement: 'bonus_rewarded', ad_type: 'rewarded' });
                const res = await RewardedAd.show({ placement: 'VICTORY_BONUS' });
                this.hideAdLoadingOverlay();
                this.isBonusRewardedShowing = false;
                this.markAdShown();

                if (res && res.shown) {
                    this.trackAdEvent('ad_shown', { placement: 'bonus_rewarded', ad_type: 'rewarded' });
                    return !!res.rewardEarned;
                }
                return false;
            } catch (e) {
                this.hideAdLoadingOverlay();
                this.isBonusRewardedLoading = false;
                this.isBonusRewardedShowing = false;
                return false;
            }
        }

        const adId = this.getAdUnitId("BONUS_REWARDED");
        if (!adId) {
            this.hideAdLoadingOverlay();
            console.log("Bonus Rewarded skipped: missing ad unit ID.");
            return false;
        }

        let showedHandle = null;
        try {
            const AdMob = window.Capacitor.Plugins.AdMob;

            if (!AdMob) {
                this.hideAdLoadingOverlay();
                console.warn("Bonus Rewarded unavailable: AdMob plugin not found.");
                return false;
            }

            this.isBonusRewardedLoading = true;
            this.setSharedFullScreenLocked(true);

            await AdMob.prepareRewardVideoAd({
                adId: adId,
                isTesting: !AdMobConfig.IS_PRODUCTION,
            });

            this.isBonusRewardedLoading = false;
            this.isBonusRewardedShowing = true;

            if (typeof AdMob.addListener === 'function') {
                AdMob.addListener('onRewardedVideoAdShowed', () => {
                    this.hideAdLoadingOverlay();
                }).then(h => { showedHandle = h; }).catch(() => {});
            }

            this.trackAdEvent('ad_show_attempt', { placement: 'bonus_rewarded', ad_type: 'rewarded' });
            const rewardItem = await AdMob.showRewardVideoAd();

            this.isBonusRewardedShowing = false;
            this.markAdShown();

            if (rewardItem) {
                console.log("Bonus Rewarded earned:", rewardItem);
                return true;
            }

            console.log("Bonus Rewarded closed without reward.");
            return false;
        } catch (error) {
            this.hideAdLoadingOverlay();
            this.isBonusRewardedLoading = false;
            this.isBonusRewardedShowing = false;

            console.error("Bonus Rewarded failed:", error);
            return false;
        } finally {
            if (showedHandle && typeof showedHandle.remove === 'function') {
                try { showedHandle.remove(); } catch (e) {}
            }
            this.hideAdLoadingOverlay();
            this.setSharedFullScreenLocked(false);
        }
    },

    /**
     * Shared Central Rewarded Video Lifecycle Engine
     */
    async requestRewardedReward({
        placement = 'rewarded_generic',
        adUnitKey = 'REWARDED_HINT',
        title = 'Preparing Advertisement',
        message = 'Watch the sponsor clip to unlock your reward.',
        icon = 'smart_display'
    } = {}) {
        if (window.isPremium) {
            this.hideAdLoadingOverlay();
            this.trackAdEvent('ad_skipped', { reason: 'premium_reward_auto_grant', placement: placement });
            return true;
        }

        if (!AdMobConfig.ADS_ENABLED) {
            this.hideAdLoadingOverlay();
            console.log(`[AdMobService] Rewarded (${placement}) skipped: ADS_ENABLED is false.`);
            return false;
        }

        if (!this.isFeatureEnabled('rewarded_ads_enabled')) {
            this.hideAdLoadingOverlay();
            console.log(`[AdMobService] Rewarded (${placement}) skipped: rewarded_ads_enabled is false.`);
            return false;
        }

        if (placement === 'auto_check' && !this.isFeatureEnabled('auto_check_rewarded_enabled')) {
            this.hideAdLoadingOverlay();
            console.log(`[AdMobService] Rewarded (auto_check) skipped: auto_check_rewarded_enabled is false.`);
            return false;
        }

        if (placement === 'theme_unlock' && !this.isFeatureEnabled('theme_rewarded_unlock_enabled')) {
            this.hideAdLoadingOverlay();
            console.log(`[AdMobService] Rewarded (theme_unlock) skipped: theme_rewarded_unlock_enabled is false.`);
            return false;
        }

        if (this.isAnyFullScreenBusy()) {
            this.hideAdLoadingOverlay();
            console.log(`[AdMobService] Rewarded (${placement}) skipped: another full-screen ad is busy.`);
            return false;
        }

        const initialized = await this.initialize();
        if (!initialized) {
            this.hideAdLoadingOverlay();
            console.log(`[AdMobService] Rewarded (${placement}) skipped: AdMob not initialized.`);
            return false;
        }

        const RewardedAd = this.getRewardedAdPlugin();
        if (RewardedAd && RewardedAd.show) {
            try {
                const nativePlacement = placement === 'auto_check' ? 'AUTO_CHECK' : 'THEME_UNLOCK';
                this.isGenericRewardedLoading = true;
                const isReady = await this.isRewardedReady(nativePlacement);
                if (!isReady) {
                    await this.showAdLoadingOverlay({ icon, title, message });
                    await this.prepareRewarded(nativePlacement, adUnitKey);
                }
                this.isGenericRewardedLoading = false;
                this.isGenericRewardedShowing = true;

                this.trackAdEvent('ad_show_attempt', { placement, ad_type: 'rewarded' });
                const res = await RewardedAd.show({ placement: nativePlacement });
                this.hideAdLoadingOverlay();
                this.isGenericRewardedShowing = false;
                this.markAdShown();

                if (res && res.shown) {
                    this.trackAdEvent('ad_shown', { placement, ad_type: 'rewarded' });
                    return !!res.rewardEarned;
                }
                return false;
            } catch (e) {
                this.hideAdLoadingOverlay();
                this.isGenericRewardedLoading = false;
                this.isGenericRewardedShowing = false;
                return false;
            }
        }

        const adId = this.getAdUnitId(adUnitKey) || this.getAdUnitId("REWARDED_HINT");
        if (!adId) {
            this.hideAdLoadingOverlay();
            console.warn(`[AdMobService] Rewarded (${placement}) skipped: missing ad unit ID for ${adUnitKey}`);
            return false;
        }

        let lifecyclePromise = null;
        try {
            const AdMob = window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins.AdMob : null;
            if (!AdMob) {
                this.hideAdLoadingOverlay();
                console.warn(`[AdMobService] Rewarded (${placement}) unavailable: AdMob plugin not found.`);
                return false;
            }

            this.isGenericRewardedLoading = true;
            this.setSharedFullScreenLocked(true);

            if (!this.isRewardedAdReady) {
                await this.showAdLoadingOverlay({ icon, title, message });
                await AdMob.prepareRewardVideoAd({
                    adId: adId,
                    isTesting: this.isTestModeEnabled(),
                });
            }

            this.isGenericRewardedLoading = false;
            this.isGenericRewardedShowing = true;

            lifecyclePromise = this.waitForRewardedAdLifecycle(AdMob, () => {
                this.hideAdLoadingOverlay();
            });

            this.trackAdEvent('ad_show_attempt', { placement, ad_type: 'rewarded' });
            const showPromise = AdMob.showRewardVideoAd().catch(e => {
                console.warn(`[AdMobService] Rewarded (${placement}) show error:`, e);
                return null;
            });

            const lifecycleResult = await lifecyclePromise;
            const directShowResult = await showPromise;

            this.isGenericRewardedShowing = false;
            this.isRewardedAdReady = false;
            this.markAdShown();

            if (lifecycleResult.success || (directShowResult && (directShowResult.type || directShowResult.amount))) {
                console.log(`[AdMobService] Rewarded (${placement}) confirmed earned:`, lifecycleResult.rewardItem || directShowResult);
                this.trackAdEvent('ad_shown', { placement, ad_type: 'rewarded' });
                return true;
            }

            console.log(`[AdMobService] Rewarded (${placement}) closed without confirmed reward.`);
            return false;
        } catch (error) {
            this.hideAdLoadingOverlay();
            this.isGenericRewardedLoading = false;
            this.isGenericRewardedShowing = false;
            this.isRewardedAdReady = false;

            console.error(`[AdMobService] Rewarded (${placement}) failed:`, error);
            return false;
        } finally {
            if (lifecyclePromise && typeof lifecyclePromise.cancel === 'function') {
                lifecyclePromise.cancel();
            }
            this.hideAdLoadingOverlay();
            this.setSharedFullScreenLocked(false);
        }
    },

    async showAutoCheckRewardedAd() {
        return await this.requestRewardedReward({
            placement: 'auto_check',
            adUnitKey: 'REWARDED_HINT',
            icon: 'fact_check',
            title: 'Preparing Auto-Check',
            message: 'Scan will run after a short sponsor clip.'
        });
    },

    async showThemeUnlockRewardedAd(themeId) {
        return await this.requestRewardedReward({
            placement: 'theme_unlock',
            adUnitKey: 'BONUS_REWARDED',
            icon: 'palette',
            title: 'Unlocking Theme (24h)',
            message: 'Unlocking 24 hours of theme access.'
        });
    },
    waitForInterstitialDismissal(AdMob, onAdOpened) {
        if (!AdMob || typeof AdMob.addListener !== 'function') {
            if (typeof onAdOpened === 'function') {
                try { onAdOpened(); } catch (e) {}
            }
            const p = Promise.resolve();
            p.cancel = () => {};
            return p;
        }

        let cleanupFn = null;
        const promise = new Promise((resolve) => {
            let showedHandle = null;
            let dismissedHandle = null;
            let failedHandle = null;
            let timeoutId = null;
            let resolved = false;

            const cleanup = () => {
                if (resolved) return;
                resolved = true;

                // Ensure loading overlay is cleared on dismissal, failure, or timeout
                if (typeof onAdOpened === 'function') {
                    try { onAdOpened(); } catch (e) {}
                }

                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                if (showedHandle && typeof showedHandle.remove === 'function') {
                    try { showedHandle.remove(); } catch (e) {}
                    showedHandle = null;
                }
                if (dismissedHandle && typeof dismissedHandle.remove === 'function') {
                    try { dismissedHandle.remove(); } catch (e) {}
                    dismissedHandle = null;
                }
                if (failedHandle && typeof failedHandle.remove === 'function') {
                    try { failedHandle.remove(); } catch (e) {}
                    failedHandle = null;
                }
                resolve();
            };

            cleanupFn = cleanup;

            // Max safety timeout (90s) so UI is never stuck indefinitely
            timeoutId = setTimeout(cleanup, 90000);

            try {
                // interstitialAdShowed: Hide overlay, do NOT resolve promise, do NOT navigate
                if (typeof onAdOpened === 'function') {
                    AdMob.addListener('interstitialAdShowed', () => {
                        try { onAdOpened(); } catch (e) {}
                    }).then(h => {
                        showedHandle = h;
                        if (resolved && h && typeof h.remove === 'function') {
                            try { h.remove(); } catch (e) {}
                            showedHandle = null;
                        }
                    }).catch(() => {});
                }

                // interstitialAdDismissed: Resolve dismissal promise, allowing intended navigation
                AdMob.addListener('interstitialAdDismissed', cleanup).then(h => {
                    dismissedHandle = h;
                    if (resolved && h && typeof h.remove === 'function') {
                        try { h.remove(); } catch (e) {}
                        dismissedHandle = null;
                    }
                }).catch(() => cleanup());

                // interstitialAdFailedToShow: Clear loading state, resolve safely, allow intended navigation
                AdMob.addListener('interstitialAdFailedToShow', cleanup).then(h => {
                    failedHandle = h;
                    if (resolved && h && typeof h.remove === 'function') {
                        try { h.remove(); } catch (e) {}
                        failedHandle = null;
                    }
                }).catch(() => cleanup());
            } catch (e) {
                cleanup();
            }
        });

        promise.cancel = () => {
            if (cleanupFn) cleanupFn();
        };

        return promise;
    },

    async showCompletionInterstitialAd() {
        if (window.isPremium) {
            this.hideAdLoadingOverlay();
            this.trackAdEvent('ad_skipped', { reason: 'premium_remove_ads', placement: 'completion_interstitial' });
            return false;
        }
        if (!AdMobConfig.ADS_ENABLED) {
            this.hideAdLoadingOverlay();
            console.log("Completion Interstitial skipped: ADS_ENABLED is false.");
            return false;
        }

        if (this.isAnyInterstitialBusy()) {
            this.hideAdLoadingOverlay();
            console.log("Completion Interstitial skipped: another interstitial is loading or showing.");
            return false;
        }

        if (!this.canShowCompletionInterstitial()) {
            this.hideAdLoadingOverlay();
            return false;
        }

        const initialized = await this.initialize();
        if (!initialized) {
            this.hideAdLoadingOverlay();
            console.log("Completion Interstitial skipped: AdMob not initialized.");
            return false;
        }

        const InterstitialAd = this.getInterstitialAdPlugin();
        if (InterstitialAd && InterstitialAd.show) {
            try {
                // Pre-network eligibility gating
                const eligible = await this.isInterstitialEligible('COMPLETION');
                if (!eligible) {
                    this.hideAdLoadingOverlay();
                    console.log("[CompletionAd] Skipped: not eligible according to native policy (cooldown/cap).");
                    this.trackAdEvent('ad_skipped', { reason: 'ineligible_policy', placement: 'completion_interstitial' });
                    return false;
                }

                this.isCompletionInterstitialLoading = true;
                const isReady = await this.isInterstitialReady('COMPLETION');
                if (!isReady) {
                    await this.showAdLoadingOverlay({
                        icon: "auto_stories",
                        title: "Preparing Advertisement",
                        message: "Your next puzzle will begin after the ad."
                    });
                    await this.prepareInterstitial('COMPLETION', 'COMPLETION_INTERSTITIAL');
                }

                this.isCompletionInterstitialLoading = false;
                const readyNow = await this.isInterstitialReady('COMPLETION');
                if (!readyNow) {
                    this.hideAdLoadingOverlay();
                    console.log("[CompletionAd] Not ready after preparation; proceeding with navigation.");
                    return false;
                }

                this.isCompletionInterstitialShowing = true;
                this.setSharedFullScreenLocked(true);
                this.trackAdEvent('ad_show_attempt', { placement: 'completion_interstitial', ad_type: 'interstitial' });

                const res = await InterstitialAd.show({ placement: 'COMPLETION' });

                this.hideAdLoadingOverlay();
                this.isCompletionInterstitialShowing = false;
                this.setSharedFullScreenLocked(false);

                if (res && res.shown) {
                    this.completionInterstitialsShownThisSession++;
                    this.markAdShown();
                    this.trackAdEvent('ad_shown', { placement: 'completion_interstitial', ad_type: 'interstitial' });
                    return true;
                }
                return false;
            } catch (e) {
                this.hideAdLoadingOverlay();
                this.isCompletionInterstitialLoading = false;
                this.isCompletionInterstitialShowing = false;
                this.setSharedFullScreenLocked(false);
                console.error("[CompletionAd] Native show error:", e);
                return false;
            }
        }

        this.hideAdLoadingOverlay();
        return false;
    },

    async showNewGameInterstitialAd() {
        if (window.isPremium) {
            this.trackAdEvent('ad_skipped', { reason: 'premium_remove_ads', placement: 'new_game_interstitial' });
            return false;
        }
        if (!this.isFeatureEnabled('interstitial_ads_enabled') || !this.isFeatureEnabled('new_game_interstitial_enabled')) {
            console.log("New Game Interstitial skipped: disabled by Remote Config or master switch.");
            return false;
        }

        if (this.isAnyInterstitialBusy()) {
            console.log("New Game Interstitial skipped: another interstitial is loading or showing.");
            return false;
        }

        if (this.isCooldownActive("New Game Interstitial")) {
            return false;
        }

        const initialized = await this.initialize();
        if (!initialized) {
            console.log("New Game Interstitial skipped: AdMob not initialized.");
            return false;
        }

        const InterstitialAd = this.getInterstitialAdPlugin();
        if (InterstitialAd && InterstitialAd.show) {
            try {
                // Pre-network eligibility gating
                const eligible = await this.isInterstitialEligible('NEW_GAME');
                if (!eligible) {
                    console.log("[NewGameAd] Skipped: not eligible according to native policy.");
                    this.trackAdEvent('ad_skipped', { reason: 'ineligible_policy', placement: 'new_game_interstitial' });
                    return false;
                }

                // Zero-latency ready check: never block user tap behind network spinner
                const isReady = await this.isInterstitialReady('NEW_GAME');
                if (!isReady) {
                    console.log("[NewGameAd] No cached ad ready; continuing navigation instantly without network blocking.");
                    // Opportunistic non-blocking background prepare for subsequent opportunities
                    this.prepareInterstitial('NEW_GAME', 'NEW_GAME_INTERSTITIAL').catch(() => {});
                    return false;
                }

                this.isNewGameInterstitialShowing = true;
                this.setSharedFullScreenLocked(true);
                this.trackAdEvent('ad_show_attempt', { placement: 'new_game_interstitial', ad_type: 'interstitial' });

                const res = await InterstitialAd.show({ placement: 'NEW_GAME' });

                this.isNewGameInterstitialShowing = false;
                this.setSharedFullScreenLocked(false);

                if (res && res.shown) {
                    this.markAdShown();
                    this.trackAdEvent('ad_shown', { placement: 'new_game_interstitial', ad_type: 'interstitial' });
                    return true;
                }
                return false;
            } catch (e) {
                this.isNewGameInterstitialShowing = false;
                this.setSharedFullScreenLocked(false);
                console.error("[NewGameAd] Native show error:", e);
                return false;
            }
        }

        return false;
    },

    async showAbandonInterstitialAd() {
        if (window.isPremium) {
            this.trackAdEvent('ad_skipped', { reason: 'premium_remove_ads', placement: 'abandon_interstitial' });
            return false;
        }
        if (!this.isFeatureEnabled('interstitial_ads_enabled') || !this.isFeatureEnabled('abandon_interstitial_enabled')) {
            console.log("Abandon Interstitial skipped: disabled by Remote Config or master switch.");
            return false;
        }

        if (this.isAnyInterstitialBusy()) {
            console.log("Abandon Interstitial skipped: another interstitial is loading or showing.");
            return false;
        }

        if (this.isCooldownActive("Abandon Interstitial")) {
            return false;
        }

        const initialized = await this.initialize();
        if (!initialized) {
            console.log("Abandon Interstitial skipped: AdMob not initialized.");
            return false;
        }

        const InterstitialAd = this.getInterstitialAdPlugin();
        if (InterstitialAd && InterstitialAd.show) {
            try {
                // Pre-network eligibility gating
                const eligible = await this.isInterstitialEligible('ABANDON');
                if (!eligible) {
                    console.log("[AbandonAd] Skipped: not eligible according to native policy.");
                    this.trackAdEvent('ad_skipped', { reason: 'ineligible_policy', placement: 'abandon_interstitial' });
                    return false;
                }

                // Zero-latency ready check: never block user tap behind network spinner
                const isReady = await this.isInterstitialReady('ABANDON');
                if (!isReady) {
                    console.log("[AbandonAd] No cached ad ready; continuing navigation instantly without network blocking.");
                    // Opportunistic non-blocking background prepare for subsequent opportunities
                    this.prepareInterstitial('ABANDON', 'ABANDON_INTERSTITIAL').catch(() => {});
                    return false;
                }

                this.isAbandonInterstitialShowing = true;
                this.setSharedFullScreenLocked(true);
                this.trackAdEvent('ad_show_attempt', { placement: 'abandon_interstitial', ad_type: 'interstitial' });

                const res = await InterstitialAd.show({ placement: 'ABANDON' });

                this.isAbandonInterstitialShowing = false;
                this.setSharedFullScreenLocked(false);

                if (res && res.shown) {
                    this.markAdShown();
                    this.trackAdEvent('ad_shown', { placement: 'abandon_interstitial', ad_type: 'interstitial' });
                    return true;
                }
                return false;
            } catch (e) {
                this.isAbandonInterstitialShowing = false;
                this.setSharedFullScreenLocked(false);
                console.error("[AbandonAd] Native show error:", e);
                return false;
            }
        }

        return false;
    },

    async showGameOverInterstitialAd(options = {}) {
        const action = (options && options.action) ? options.action : 'unknown';
        const isTryAgain = (action === 'try_again');

        const isPremium = !!window.isPremium;
        const masterAdsEnabled = !!AdMobConfig.ADS_ENABLED && (!AdMobConfig.REMOTE || AdMobConfig.REMOTE.ads_enabled !== false && AdMobConfig.REMOTE.ads_enabled !== "false");
        const interstitialAdsEnabled = this.isFeatureEnabled('interstitial_ads_enabled');
        const gameOverInterstitialEnabled = this.isFeatureEnabled('game_over_interstitial_enabled');
        const cooldownRemaining = this.getCooldownRemainingSeconds();
        const sessionCap = Number(this.getRemoteValue('game_over_interstitial_session_cap', 5));
        const sessionCapRemaining = sessionCap > 0 ? Math.max(0, sessionCap - this.gameOverInterstitialsShownThisSession) : Infinity;
        const isBusy = this.isAnyInterstitialBusy();

        let isEligible = true;
        let skipReason = null;

        if (isPremium) {
            isEligible = false;
            skipReason = 'premium_remove_ads';
        } else if (!masterAdsEnabled || !interstitialAdsEnabled || !gameOverInterstitialEnabled) {
            isEligible = false;
            skipReason = 'disabled_by_remote_config';
        } else if (isBusy) {
            isEligible = false;
            skipReason = 'another_interstitial_busy';
        } else if (sessionCap > 0 && sessionCapRemaining <= 0) {
            isEligible = false;
            skipReason = 'session_cap_reached';
        } else if (cooldownRemaining > 0) {
            isEligible = false;
            skipReason = `cooldown_active_${cooldownRemaining}s_remaining`;
        }

        if (!isEligible) {
            this.hideAdLoadingOverlay();
            this.trackAdEvent('ad_skipped', { reason: skipReason, placement: 'game_over_interstitial', action: action });
            console.log(`[GameOverAd] Skipped: ${skipReason}`);
            return false;
        }

        const initialized = await this.initialize();
        if (!initialized) {
            this.hideAdLoadingOverlay();
            console.log("[GameOverAd] Skipped: AdMob not initialized");
            return false;
        }

        const InterstitialAd = this.getInterstitialAdPlugin();
        if (InterstitialAd && InterstitialAd.show) {
            try {
                // Pre-network eligibility gating
                const nativeEligible = await this.isInterstitialEligible('GAME_OVER');
                if (!nativeEligible) {
                    this.hideAdLoadingOverlay();
                    console.log("[GameOverAd] Skipped: native policy says ineligible.");
                    this.trackAdEvent('ad_skipped', { reason: 'ineligible_policy', placement: 'game_over_interstitial', action: action });
                    return false;
                }

                this.isGameOverInterstitialLoading = true;
                const isReady = await this.isInterstitialReady('GAME_OVER');
                if (!isReady) {
                    await this.showAdLoadingOverlay({
                        icon: isTryAgain ? "replay" : "add_box",
                        title: "Preparing Advertisement",
                        message: isTryAgain ? "Your puzzle will restart after the ad." : "Your next puzzle will begin after the ad."
                    });
                    await this.prepareInterstitial('GAME_OVER', 'GAME_OVER_INTERSTITIAL');
                }

                this.isGameOverInterstitialLoading = false;
                const readyNow = await this.isInterstitialReady('GAME_OVER');
                if (!readyNow) {
                    this.hideAdLoadingOverlay();
                    console.log("[GameOverAd] Not ready after preparation; proceeding with action.");
                    return false;
                }

                this.isGameOverInterstitialShowing = true;
                this.setSharedFullScreenLocked(true);
                this.trackAdEvent('ad_show_attempt', { placement: 'game_over_interstitial', ad_type: 'interstitial', action: action });

                const res = await InterstitialAd.show({ placement: 'GAME_OVER' });

                this.hideAdLoadingOverlay();
                this.isGameOverInterstitialShowing = false;
                this.setSharedFullScreenLocked(false);

                if (res && res.shown) {
                    this.gameOverInterstitialsShownThisSession++;
                    this.markAdShown();
                    this.trackAdEvent('ad_shown', { placement: 'game_over_interstitial', ad_type: 'interstitial', action: action });
                    return true;
                }
                return false;
            } catch (e) {
                this.hideAdLoadingOverlay();
                this.isGameOverInterstitialLoading = false;
                this.isGameOverInterstitialShowing = false;
                this.setSharedFullScreenLocked(false);
                console.error("[GameOverAd] Native show error:", e);
                return false;
            }
        }

        this.hideAdLoadingOverlay();
        return false;
    },

    _setupBannerListeners(AdMob) {
        if (this.hasBannerListeners || !AdMob || typeof AdMob.addListener !== 'function') return;
        this.hasBannerListeners = true;

        try {
            AdMob.addListener('bannerAdSizeChanged', (info) => {
                const height = info && info.height ? Number(info.height) : 0;
                console.log(`[AdMobService] bannerAdSizeChanged: width=${info ? info.width : 0}, height=${height}`);
                this.updateGameplayBannerClearance(height);
            }).then(h => { this._bannerSizeChangedHandle = h; }).catch(() => {});

            AdMob.addListener('bannerAdFailedToLoad', (err) => {
                console.warn("[AdMobService] bannerAdFailedToLoad:", err);
                this.isGameplayBannerShowing = false;
                this.updateGameplayBannerClearance(0);
            }).then(h => { this._bannerFailedHandle = h; }).catch(() => {});

            AdMob.addListener('bannerAdLoaded', () => {
                console.log("[AdMobService] bannerAdLoaded successfully.");
            }).catch(() => {});
        } catch (e) {
            console.warn("[AdMobService] Failed to attach banner listeners:", e);
        }
    },

    updateGameplayBannerClearance(heightDp) {
        this.currentBannerHeight = heightDp || 0;
        const gameScreen = document.getElementById('game-screen');
        if (gameScreen) {
            if (this.currentBannerHeight > 0) {
                gameScreen.classList.add('has-banner');
                gameScreen.style.setProperty('--gameplay-banner-height', `${this.currentBannerHeight}px`);
            } else {
                gameScreen.classList.remove('has-banner');
                gameScreen.style.setProperty('--gameplay-banner-height', '0px');
            }
        }
    },

    async showGameplayBannerAd() {
        this.logAdState("showGameplayBannerAd");
        console.log("[GameplayBanner] requested");

        if (window.isPremium) {
            console.log("[GameplayBanner] skipped (Reason: User is premium)");
            return false;
        }
        if (!this.canRequestAds()) {
            console.log("[GameplayBanner] skipped (Reason: UMP consent not granted / canRequestAds=false)");
            return false;
        }
        if (!this.isFeatureEnabled('banner_ads_enabled') || !this.isFeatureEnabled('gameplay_banner_enabled')) {
            console.log("[GameplayBanner] skipped (Reason: disabled by Remote Config)");
            return false;
        }

        if (this.isGameplayBannerLoading || this.isGameplayBannerShowing) {
            console.log("[GameplayBanner] skipped (Reason: banner already active or loading)");
            return true;
        }

        const initialized = await this.initialize();
        if (!initialized) {
            console.log("[GameplayBanner] failed (Reason: AdMob failed to initialize)");
            return false;
        }

        const adId = this.getAdUnitId("GAMEPLAY_BANNER") || this.getAdUnitId("HOME_BANNER");
        if (!adId) {
            console.log("[GameplayBanner] failed (Reason: missing ad unit ID)");
            return false;
        }

        try {
            const AdMob = window.Capacitor.Plugins.AdMob;
            if (!AdMob) {
                console.log("[GameplayBanner] failed (Reason: AdMob plugin unavailable)");
                return false;
            }

            this.isGameplayBannerLoading = true;
            this._setupBannerListeners(AdMob);

            const bottomMargin = (typeof AdMobConfig !== 'undefined' && AdMobConfig.REMOTE && AdMobConfig.REMOTE.banner_bottom_margin_dp !== undefined)
                ? Number(AdMobConfig.REMOTE.banner_bottom_margin_dp)
                : 0;

            console.log(`[AdMobService] Presenting Gameplay banner: adId=${adId}, adSize=ADAPTIVE_BANNER, position=BOTTOM_CENTER, margin=${bottomMargin}`);
            await AdMob.showBanner({
                adId: adId,
                adSize: 'ADAPTIVE_BANNER',
                position: 'BOTTOM_CENTER',
                margin: bottomMargin,
                isTesting: this.isTestModeEnabled()
            });

            this.isGameplayBannerLoading = false;
            this.isGameplayBannerShowing = true;

            const gameScreen = document.getElementById('game-screen');
            if (gameScreen) {
                gameScreen.classList.add('has-banner');
            }
            console.log("[GameplayBanner] loaded");
            return true;
        } catch (e) {
            this.isGameplayBannerLoading = false;
            this.isGameplayBannerShowing = false;
            this.updateGameplayBannerClearance(0);
            console.warn("[GameplayBanner] failed (Reason: " + (e.message || JSON.stringify(e)) + ")");
            return false;
        }
    },

    async hideGameplayBannerAd() {
        this.isGameplayBannerShowing = false;
        this.isGameplayBannerLoading = false;
        this.updateGameplayBannerClearance(0);

        try {
            const AdMob = window.Capacitor.Plugins.AdMob;
            if (AdMob) {
                await AdMob.hideBanner().catch(() => {});
                await AdMob.removeBanner().catch(() => {});
                console.log("[AdMobService] Gameplay banner hidden and removed.");
            }
        } catch (e) {
            console.warn("[AdMobService] Hide gameplay banner error:", e);
        }
    },

    async showHomeBannerAd() {
        if (window.isPremium) return false;
        if (!this.canRequestAds()) {
            console.log("[HomeBanner] skipped (Reason: UMP consent not granted / canRequestAds=false)");
            return false;
        }
        if (!this.isFeatureEnabled('banner_ads_enabled')) return false;

        // Guard against competing with Home Native request
        if (this.isHomeNativeLoading) {
            console.log("[HomeBanner] Skipped: Home Native is currently loading (preventing competing request)");
            return false;
        }
        if (this.isNativeAdShowing && this.currentNativeAdScreen === 'home') {
            console.log("[HomeBanner] Skipped: Home Native is already showing");
            return false;
        }

        const initialized = await this.initialize();
        if (!initialized) return false;

        const adId = this.getAdUnitId("HOME_BANNER");
        if (!adId) return false;

        try {
            const AdMob = window.Capacitor.Plugins.AdMob;
            if (!AdMob) return false;

            const bottomMargin = (typeof AdMobConfig !== 'undefined' && AdMobConfig.REMOTE && AdMobConfig.REMOTE.banner_bottom_margin_dp !== undefined)
                ? Number(AdMobConfig.REMOTE.banner_bottom_margin_dp)
                : 0;

            await AdMob.showBanner({
                adId: adId,
                adSize: 'ADAPTIVE_BANNER',
                position: 'BOTTOM_CENTER',
                margin: bottomMargin,
                isTesting: this.isTestModeEnabled()
            });
            return true;
        } catch (e) {
            console.warn("Home banner failed:", e);
            return false;
        }
    },

    async hideHomeBannerAd() {
        try {
            const AdMob = window.Capacitor.Plugins.AdMob;
            if (AdMob) {
                await AdMob.hideBanner().catch(() => {});
                await AdMob.removeBanner().catch(() => {});
            }
        } catch (e) {
            console.warn("Hide banner failed:", e);
        }
    },

async showNativeAd(screenName) {
    if (typeof window.UpdateManager !== 'undefined' && window.UpdateManager.isMandatoryUpdateActive()) {
        console.log(`[NativeAd] Skipped for ${screenName}: mandatory update active`);
        return false;
    }
    this.logAdState(`showNativeAd:${screenName}`);
    const nowTime = new Date().toISOString();
    console.log(`[NativeAd] Requested for screen: ${screenName} at ${nowTime}`);

    const isPremium = !!window.isPremium;

    const logPlacement = (status, reason = "") => {
        const msg = reason ? `${status} (Reason: ${reason})` : status;
        if (screenName === 'home') {
            console.log(`[HomeAd] ${msg}`);
        } else if (screenName === 'gameplay') {
            console.log(`[GameplayNative] ${msg}`);
        } else if (screenName === 'pause') {
            console.log(`[PauseAd] ${msg}`);
        }
    };

    if (screenName === 'home') {
        console.log(`[HomeAd] request_start (time=${nowTime}, isPremium=${isPremium})`);
    } else if (screenName === 'gameplay') {
        console.log(`[GameplayNative] request_start (time=${nowTime}, isPremium=${isPremium})`);
    } else if (screenName === 'pause') {
        console.log(`[PauseAd] request_start (time=${nowTime}, isPremium=${isPremium})`);
    } else {
        logPlacement("requested");
    }
    
    if (isPremium) {
        console.log(`[NativeAd] Skipped: User is premium`);
        logPlacement("skipped", "User is premium");
        if (screenName === 'home') {
            const homeScreen = document.getElementById('home-screen');
            if (homeScreen) homeScreen.classList.remove('has-native-ad');
        } else if (screenName === 'gameplay') {
            const gameScreen = document.getElementById('game-screen');
            if (gameScreen) gameScreen.classList.remove('has-native-ad');
        }
        return false;
    }
    if (!this.isFeatureEnabled('native_ads_enabled')) {
        console.log(`[NativeAd] Skipped: native_ads_enabled is false`);
        logPlacement("skipped", "native_ads_enabled is false");
        if (screenName === 'home') {
            const homeScreen = document.getElementById('home-screen');
            if (homeScreen) homeScreen.classList.remove('has-native-ad');
        } else if (screenName === 'gameplay') {
            const gameScreen = document.getElementById('game-screen');
            if (gameScreen) gameScreen.classList.remove('has-native-ad');
        }
        return false;
    }

    if (screenName === 'home' && !this.isFeatureEnabled('home_native_ad_enabled')) {
        console.log(`[NativeAd] Skipped: home_native_ad_enabled is false`);
        logPlacement("skipped", "home_native_ad_enabled is false");
        const homeScreen = document.getElementById('home-screen');
        if (homeScreen) homeScreen.classList.remove('has-native-ad');
        return false;
    }
    if (screenName === 'gameplay' && !this.isFeatureEnabled('gameplay_native_ad_enabled')) {
        console.log(`[NativeAd] Skipped: gameplay_native_ad_enabled is false`);
        logPlacement("skipped", "gameplay_native_ad_enabled is false");
        const gameScreen = document.getElementById('game-screen');
        if (gameScreen) gameScreen.classList.remove('has-native-ad');
        return false;
    }
    if (screenName === 'achievements' && !this.isFeatureEnabled('achievements_native_enabled')) {
        console.log(`[NativeAd] Skipped: achievements_native_enabled is false`);
        return false;
    }
    if (screenName === 'daily_challenge' && !this.isFeatureEnabled('daily_challenge_native_enabled')) {
        console.log(`[NativeAd] Skipped: daily_challenge_native_enabled is false`);
        return false;
    }
    if (screenName === 'pause' && !this.isFeatureEnabled('pause_native_ad_enabled')) {
        console.log(`[NativeAd] Skipped: pause_native_ad_enabled is false`);
        logPlacement("skipped", "pause_native_ad_enabled is false");
        return false;
    }
    
    // Ensure AdMob SDK is initialized
    await this.initialize();

    // Hide banners if moving to native ad screens
    this.hideHomeBannerAd();
    this.hideGameplayBannerAd();

    let configKey = '';
    let heightDp = 120;
    let bottomMarginDp = 16;
    let horizontalMarginDp = 16;
    let placementName = screenName ? screenName.toUpperCase() : 'HOME';

    if (screenName === 'home') {
        configKey = 'HOME_NATIVE';
        heightDp = 110;
        bottomMarginDp = 16;
        horizontalMarginDp = 16;
        placementName = 'HOME';
    } else if (screenName === 'gameplay') {
        configKey = 'HOME_NATIVE';
        heightDp = 105;
        bottomMarginDp = 12;
        horizontalMarginDp = 12;
        placementName = 'GAMEPLAY';
    } else if (screenName === 'achievements') {
        configKey = 'ACHIEVEMENTS_NATIVE';
        heightDp = 120;
        bottomMarginDp = 16;
        horizontalMarginDp = 16;
        placementName = 'ACHIEVEMENTS';
    } else if (screenName === 'daily_challenge') {
        configKey = 'DAILY_CHALLENGE_NATIVE';
        heightDp = 120;
        bottomMarginDp = 16;
        horizontalMarginDp = 16;
        placementName = 'DAILY_CHALLENGE';
    } else if (screenName === 'victory') {
        configKey = 'HOME_NATIVE';
        heightDp = 120;
        bottomMarginDp = 16;
        horizontalMarginDp = 16;
        placementName = 'VICTORY';
    } else if (screenName === 'pause') {
        configKey = 'HOME_NATIVE';
        heightDp = 120;
        bottomMarginDp = 16;
        horizontalMarginDp = 16;
        placementName = 'PAUSE';
    }
    
    if (!configKey) {
        console.warn(`[NativeAd] Skipped: No config key for screen ${screenName}`);
        logPlacement("skipped", `No config key for screen ${screenName}`);
        return false;
    }
    
    const adId = this.getAdUnitId(configKey);
    if (!adId) {
        console.warn(`[NativeAd] Skipped: No ad unit ID found for ${configKey}`);
        logPlacement("skipped", `No ad unit ID found for ${configKey}`);
        return false;
    }
    
    console.log(`[NativeAd] Using ad unit ID: ${adId} for ${configKey} (height=${heightDp}dp, bottom=${bottomMarginDp}dp)`);
    
    if (screenName === 'home') {
        this.isHomeNativeLoading = true;
    }

    try {
        const NativeAd = this.getNativeAdPlugin();
        console.log(`[NativeAd] Plugin registered: ${!!NativeAd}`);
        
        if (NativeAd) {
            if (screenName === 'home') {
                console.log("[HomeAd] native_call");
            } else if (screenName === 'pause') {
                console.log("[PauseAd] native_call");
            }

            await NativeAd.showNativeAd({
                placement: placementName,
                adUnitId: adId,
                heightDp: heightDp,
                bottomMarginDp: bottomMarginDp,
                horizontalMarginDp: horizontalMarginDp
            });
            this.isNativeAdShowing = true;
            this.currentNativeAdScreen = screenName;
            console.log(`[NativeAd] Loaded success for ${screenName}`);
            
            if (screenName === 'home') {
                console.log("[HomeAd] loaded");
                const homeScreen = document.getElementById('home-screen');
                if (homeScreen) homeScreen.classList.add('has-native-ad');
                console.log("[HomeAd] visible");
            } else if (screenName === 'gameplay') {
                logPlacement("loaded");
                const gameScreen = document.getElementById('game-screen');
                if (gameScreen) gameScreen.classList.add('has-native-ad');
            } else if (screenName === 'pause') {
                console.log("[PauseAd] loaded");
                console.log("[PauseAd] visible");
            } else {
                logPlacement("loaded");
            }
            return true;
        } else {
            console.warn(`[NativeAd] Plugin not found in Capacitor.`);
            logPlacement("failed", "NativeAd plugin not found in Capacitor");
            if (screenName === 'home') {
                const homeScreen = document.getElementById('home-screen');
                if (homeScreen) homeScreen.classList.remove('has-native-ad');
                if (this.isFeatureEnabled('home_banner_fallback_enabled')) {
                    const isStillOnHome = homeScreen && !homeScreen.classList.contains('hidden') && homeScreen.classList.contains('active');
                    if (isStillOnHome) {
                        console.log(`[NativeAd] Fallback to Home Banner`);
                        this.showHomeBannerAd();
                    }
                }
            } else if (screenName === 'gameplay') {
                const gameScreen = document.getElementById('game-screen');
                if (gameScreen) gameScreen.classList.remove('has-native-ad');
            }
            return false;
        }
    } catch (e) {
        this.isNativeAdShowing = false;
        this.currentNativeAdScreen = null;
        if (screenName === 'home') {
            const homeScreen = document.getElementById('home-screen');
            if (homeScreen) homeScreen.classList.remove('has-native-ad');
        } else if (screenName === 'gameplay') {
            const gameScreen = document.getElementById('game-screen');
            if (gameScreen) gameScreen.classList.remove('has-native-ad');
        }
        console.error(`[NativeAd] Failed error for ${screenName}:`, e);
        logPlacement("failed", e.message || JSON.stringify(e));
        if (screenName === 'home' && this.isFeatureEnabled('home_banner_fallback_enabled')) {
            const homeScreen = document.getElementById('home-screen');
            const isStillOnHome = homeScreen && !homeScreen.classList.contains('hidden') && homeScreen.classList.contains('active');
            if (isStillOnHome) {
                console.log(`[NativeAd] Fallback to Home Banner (user still on Home)`);
                this.showHomeBannerAd();
            } else {
                console.log(`[NativeAd] Fallback to Home Banner skipped: user already left Home`);
            }
        }
        return false;
    } finally {
        if (screenName === 'home') {
            this.isHomeNativeLoading = false;
        }
    }
},

async hideNativeAd(screenName = null) {
    const prevScreen = screenName || this.currentNativeAdScreen;
    this.isNativeAdShowing = false;
    this.isHomeNativeLoading = false;
    this.currentNativeAdScreen = null;

    if (prevScreen === 'home') {
        console.log("[HomeAd] hidden");
    } else if (prevScreen === 'gameplay') {
        console.log("[GameplayNative] hidden");
    } else if (prevScreen === 'pause') {
        console.log("[PauseAd] hidden");
    }

    const homeScreen = document.getElementById('home-screen');
    if (homeScreen) homeScreen.classList.remove('has-native-ad');
    const gameScreen = document.getElementById('game-screen');
    if (gameScreen) gameScreen.classList.remove('has-native-ad');

    try {
        const NativeAd = this.getNativeAdPlugin();
        if (NativeAd) {
            const placement = prevScreen ? prevScreen.toUpperCase() : null;
            await NativeAd.hideNativeAd({ placement });
            console.log("[NativeAd] Hidden/Destroyed");
        }
    } catch (e) {
        console.error("[NativeAd] Hide error:", e);
    }
},

async showGameplayAd() {
    const nowTime = new Date().toISOString();
    console.log(`[GameplayAd] request_start (time=${nowTime})`);
    this.logAdState("showGameplayAd");
    
    if (window.isPremium) {
        console.log("[GameplayAd] skipped reason=user_is_premium");
        await this.hideNativeAd();
        await this.hideGameplayBannerAd();
        const gameScreen = document.getElementById('game-screen');
        if (gameScreen) {
            gameScreen.classList.remove('has-native-ad');
            gameScreen.classList.remove('has-banner');
        }
        return;
    }

    const screenHeight = this.getEffectiveViewportHeightDp();
    const minHeightThreshold = Number(this.getRemoteValue('gameplay_native_min_height_dp', 720));
    const isGameplayNativeEnabled = this.isFeatureEnabled('native_ads_enabled') && this.isFeatureEnabled('gameplay_native_ad_enabled');

    if (isGameplayNativeEnabled && screenHeight >= minHeightThreshold) {
        // Tall screen: Show Native Ad in empty bottom space
        console.log(`[GameplayAd] chosen_format: native (height=${screenHeight}dp >= ${minHeightThreshold}dp)`);
        console.log("[GameplayAd] native_call");
        await this.hideGameplayBannerAd();
        
        const success = await this.showNativeAd('gameplay');
        if (success) {
            const gameScreen = document.getElementById('game-screen');
            if (gameScreen) {
                gameScreen.classList.add('has-native-ad');
                gameScreen.classList.remove('has-banner');
            }
            console.log("[GameplayAd] loaded (format=native)");
            console.log("[GameplayAd] visible (format=native)");
            return;
        } else {
            console.log("[GameplayNative] fallback_banner (Native ad failed to load)");
        }
    } else {
        if (!isGameplayNativeEnabled) {
            console.log("[GameplayAd] chosen_format: banner (gameplay_native_ad_enabled is false)");
        } else {
            console.log(`[GameplayAd] chosen_format: banner (screen height ${screenHeight}dp < ${minHeightThreshold}dp threshold)`);
        }
    }

    // Fallback to Adaptive Banner
    console.log("[GameplayAd] banner_call");
    await this.hideNativeAd();
    const gameScreen = document.getElementById('game-screen');
    if (gameScreen) {
        gameScreen.classList.remove('has-native-ad');
    }
    const bannerSuccess = await this.showGameplayBannerAd();
    if (bannerSuccess) {
        console.log("[GameplayAd] loaded (format=banner)");
        console.log("[GameplayAd] visible (format=banner)");
    } else {
        console.log("[GameplayAd] failed (format=banner)");
    }
},

async initAppOpenAd() {
    if (this.isAppOpenInitialized) {
        console.log("[AppOpen] init skipped: already initialized");
        return;
    }
    if (window.isPremium) return;
    const isAppOpenEnabled = this.isFeatureEnabled('app_open_ads_enabled');
    if (!isAppOpenEnabled) {
        console.log("[AppOpen] skipped reason=disabled_by_config");
        try {
            const AppOpenAd = this.getAppOpenAdPlugin();
            if (AppOpenAd) {
                await AppOpenAd.init({
                    adUnitId: this.getAdUnitId("APP_OPEN") || "",
                    isPremium: !!window.isPremium,
                    enabled: false,
                    autoResume: false
                });
            }
        } catch (e) {}
        return;
    }

    const adId = this.getAdUnitId("APP_OPEN");
    if (!adId) {
        console.log("[AppOpen] skipped reason=missing_ad_unit_id");
        return;
    }

    try {
        const AppOpenAd = this.getAppOpenAdPlugin();
        if (AppOpenAd) {
            const minInterval = Number(this.getRemoteValue('app_open_min_interval_seconds', 120));
            const sessionCap = Number(this.getRemoteValue('app_open_session_cap', 4));
            const bgThreshold = Number(this.getRemoteValue('app_open_background_threshold_seconds', 45));

            if (AppOpenAd.configureLimits) {
                await AppOpenAd.configureLimits({
                    minIntervalSeconds: minInterval,
                    sessionCap: sessionCap,
                    backgroundThresholdSeconds: bgThreshold
                });
            }

            if (AppOpenAd.addListener && !this.hasAppOpenListeners) {
                this.hasAppOpenListeners = true;
                AppOpenAd.addListener("appOpenLoaded", () => {
                    console.log("[AppOpen] loaded");
                    console.log("[AppOpen] ready");
                });
                AppOpenAd.addListener("appOpenShown", () => {
                    console.log("[AppOpen] shown");
                    this.isAppOpenShowing = true;
                    this.lastAdShownAtMs = Date.now();
                    this.trackAdEvent('ad_shown', { placement: 'app_open', ad_type: 'app_open' });
                });
                AppOpenAd.addListener("appOpenDismissed", () => {
                    console.log("[AppOpen] dismissed");
                    this.isAppOpenShowing = false;
                    this.lastAdShownAtMs = Date.now();
                });
            }

            console.log("[AppOpen] preload_started with unit:", adId);
            await AppOpenAd.init({
                adUnitId: adId,
                isPremium: !!window.isPremium,
                enabled: true,
                autoResume: true
            });
            this.isAppOpenInitialized = true;
            console.log("[AppOpenAd] Initialized successfully with unit:", adId);
        }
    } catch (e) {
        console.warn("[AppOpenAd] Init error:", e);
    }
},

async isAppOpenAvailable() {
    if (window.isPremium || !this.isFeatureEnabled('app_open_ads_enabled')) return false;
    try {
        const AppOpenAd = this.getAppOpenAdPlugin();
        if (AppOpenAd && AppOpenAd.isAvailable) {
            const res = await AppOpenAd.isAvailable();
            return !!(res && res.available);
        }
    } catch (e) {}
    return false;
},

async waitForAppOpenAvailable(maxWaitMs = 3000, checkIntervalMs = 250) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        const available = await this.isAppOpenAvailable();
        if (available) return true;
        await new Promise(r => setTimeout(r, checkIntervalMs));
    }
    return false;
},

async showAppOpenAd(options = {}) {
    if (typeof window.UpdateManager !== 'undefined' && window.UpdateManager.isMandatoryUpdateActive()) {
        console.log("[AppOpen] skipped reason=mandatory_update_active");
        return false;
    }
    if (window.isPremium) {
        console.log("[AppOpen] skipped reason=user_is_premium");
        return false;
    }
    if (!this.isFeatureEnabled('app_open_ads_enabled')) {
        console.log("[AppOpen] skipped reason=app_open_disabled");
        return false;
    }

    if (this.isAnyFullScreenBusy()) {
        console.log("[AppOpen] skipped reason=fullscreen_busy");
        return false;
    }

    if (this.isCooldownActive("App Open Ad")) {
        console.log("[AppOpen] skipped reason=cooldown_active");
        return false;
    }

    try {
        const AppOpenAd = this.getAppOpenAdPlugin();
        if (AppOpenAd) {
            const res = await AppOpenAd.show({
                ignoreGameplayCheck: !!options.ignoreGameplayCheck
            });
            console.log("[AppOpenAd] Show response:", res);
            if (res && res.shown) {
                this.markAdShown();
                return true;
            } else if (res && res.reason) {
                console.log("[AppOpen] skipped reason=" + res.reason);
            }
        }
    } catch (e) {
        console.warn("[AppOpenAd] Show error:", e);
    }
    return false;
},

notifyColdStartExpired() {
    try {
        const AppOpenAd = this.getAppOpenAdPlugin();
        if (AppOpenAd && AppOpenAd.onColdStartWindowExpired) {
            AppOpenAd.onColdStartWindowExpired().catch(() => {});
        }
    } catch (e) {}
},

setPremium(isPremium) {
    window.isPremium = isPremium;
    try {
        const AppOpenAd = this.getAppOpenAdPlugin();
        if (AppOpenAd) {
            AppOpenAd.setPremium({ isPremium: !!isPremium });
        }
    } catch (e) {}
    try {
        const RewardedAd = this.getRewardedAdPlugin();
        if (RewardedAd) {
            RewardedAd.setPremium({ isPremium: !!isPremium });
        }
    } catch (e) {}
    try {
        const InterstitialAd = this.getInterstitialAdPlugin();
        if (InterstitialAd) {
            InterstitialAd.setPremium({ isPremium: !!isPremium });
        }
    } catch (e) {}
}
};