const AdMobService = {
    isInitialized: false,

    async initialize() {
        if (!AdMobConfig.ADS_ENABLED) {
            console.log("AdMob initialization skipped: ADS_ENABLED is false.");
            return;
        }

        if (this.isInitialized) {
            console.log("AdMob already initialized.");
            return;
        }

        try {
            // Check if running in a Capacitor native environment
            if (!window.Capacitor || !window.Capacitor.isNativePlatform()) {
                console.log("AdMob initialization skipped: Not running on a native platform.");
                return;
            }

            const AdMob = window.Capacitor.Plugins.AdMob;
            if (!AdMob) {
                console.warn("AdMob plugin not found in window.Capacitor.Plugins.");
                return;
            }

            // Initialize AdMob
            await AdMob.initialize({
                requestTrackingAuthorization: true,
                initializeForTesting: !AdMobConfig.IS_PRODUCTION,
            });

            this.isInitialized = true;
            console.log("AdMob initialized successfully.");
        } catch (error) {
            // Catch all failures so the app doesn't crash or block
            console.error("Failed to initialize AdMob:", error);
        }
    }
};
