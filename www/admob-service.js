const AdMobService = {
    isInitialized: false,

    isRewardedHintLoading: false,
    isRewardedHintShowing: false,

    isMistakeRescueLoading: false,
    isMistakeRescueShowing: false,

    async initialize() {
        if (!AdMobConfig.ADS_ENABLED) {
            console.log("AdMob initialization skipped: ADS_ENABLED is false.");
            return false;
        }

        if (this.isInitialized) {
            console.log("AdMob already initialized.");
            return true;
        }

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

            await AdMob.initialize({
                requestTrackingAuthorization: true,
                initializeForTesting: !AdMobConfig.IS_PRODUCTION,
            });

            this.isInitialized = true;
            console.log("AdMob initialized successfully.");
            return true;
        } catch (error) {
            console.error("Failed to initialize AdMob:", error);
            return false;
        }
    },

    getAdUnitId(placementName) {
        const placement = AdMobConfig.AD_UNITS[placementName];

        if (!placement) {
            console.warn("AdMob placement not found:", placementName);
            return null;
        }

        return AdMobConfig.IS_PRODUCTION ? placement.PRODUCTION : placement.TEST;
    },

    async showRewardedHintAd() {
        if (!AdMobConfig.ADS_ENABLED) {
            console.log("Rewarded Hint skipped: ADS_ENABLED is false.");
            return false;
        }

        if (this.isRewardedHintLoading || this.isRewardedHintShowing) {
            console.log("Rewarded Hint skipped: ad already loading or showing.");
            return false;
        }

        const initialized = await this.initialize();
        if (!initialized) {
            console.log("Rewarded Hint skipped: AdMob not initialized.");
            return false;
        }

        const adId = this.getAdUnitId("REWARDED_HINT");
        if (!adId) {
            console.log("Rewarded Hint skipped: missing ad unit ID.");
            return false;
        }

        try {
            const AdMob = window.Capacitor.Plugins.AdMob;

            if (!AdMob) {
                console.warn("Rewarded Hint unavailable: AdMob plugin not found.");
                return false;
            }

            this.isRewardedHintLoading = true;

            await AdMob.prepareRewardVideoAd({
                adId: adId,
                isTesting: !AdMobConfig.IS_PRODUCTION,
            });

            this.isRewardedHintLoading = false;
            this.isRewardedHintShowing = true;

            const rewardItem = await AdMob.showRewardVideoAd();

            this.isRewardedHintShowing = false;

            if (rewardItem) {
                console.log("Rewarded Hint earned:", rewardItem);
                return true;
            }

            console.log("Rewarded Hint closed without reward.");
            return false;
        } catch (error) {
            this.isRewardedHintLoading = false;
            this.isRewardedHintShowing = false;

            console.error("Rewarded Hint failed:", error);
            return false;
        }
    },

    async showMistakeRescueAd() {
        if (!AdMobConfig.ADS_ENABLED) {
            console.log("Mistake Rescue skipped: ADS_ENABLED is false.");
            return false;
        }

        if (this.isMistakeRescueLoading || this.isMistakeRescueShowing) {
            console.log("Mistake Rescue skipped: ad already loading or showing.");
            return false;
        }

        const initialized = await this.initialize();
        if (!initialized) {
            console.log("Mistake Rescue skipped: AdMob not initialized.");
            return false;
        }

        const adId = this.getAdUnitId("REWARDED_MISTAKE_RESCUE");
        if (!adId) {
            console.log("Mistake Rescue skipped: missing ad unit ID.");
            return false;
        }

        try {
            const AdMob = window.Capacitor.Plugins.AdMob;

            if (!AdMob) {
                console.warn("Mistake Rescue unavailable: AdMob plugin not found.");
                return false;
            }

            this.isMistakeRescueLoading = true;

            await AdMob.prepareRewardVideoAd({
                adId: adId,
                isTesting: !AdMobConfig.IS_PRODUCTION,
            });

            this.isMistakeRescueLoading = false;
            this.isMistakeRescueShowing = true;

            const rewardItem = await AdMob.showRewardVideoAd();

            this.isMistakeRescueShowing = false;

            if (rewardItem) {
                console.log("Mistake Rescue earned:", rewardItem);
                return true;
            }

            console.log("Mistake Rescue closed without reward.");
            return false;
        } catch (error) {
            this.isMistakeRescueLoading = false;
            this.isMistakeRescueShowing = false;

            console.error("Mistake Rescue failed:", error);
            return false;
        }
    }
};