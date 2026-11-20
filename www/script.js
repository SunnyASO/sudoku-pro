// Canonical AppRuntime Readiness Provider
window.AppRuntime = {
    _readyPromise: null,
    ready() {
        if (this._readyPromise) return this._readyPromise;
        this._readyPromise = new Promise((resolve) => {
            const check = () => {
                const hasCapacitor = typeof window.Capacitor !== 'undefined';
                const isNative = hasCapacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform();
                const platform = hasCapacitor && typeof window.Capacitor.getPlatform === 'function' ? window.Capacitor.getPlatform() : (isNative ? 'android' : 'web');
                resolve({ isNative, platform });
            };

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', check, { once: true });
            } else {
                check();
            }
        });
        return this._readyPromise;
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    console.log("[Startup] DOMContentLoaded");
    window.isPremium = false;

    // 1. Audit and verify Capacitor runtime readiness
    const runtime = await AppRuntime.ready();
    console.log("[Startup] capacitor_available:", typeof window.Capacitor !== 'undefined');
    console.log("[Startup] capacitor_platform:", runtime.platform);

    // 2. Register all native local plugins upfront with Capacitor
    let Analytics = null;
    let Billing = null;
    let RemoteConfig = null;
    let Review = null;
    let Haptics = null;
    let InAppUpdate = null;

    if (window.Capacitor && window.Capacitor.registerPlugin) {
        Analytics = window.Capacitor.registerPlugin('SudokuAnalytics');
        Billing = window.Capacitor.registerPlugin('Billing');
        RemoteConfig = window.Capacitor.registerPlugin('RemoteConfig');
        Review = window.Capacitor.registerPlugin('Review');
        Haptics = window.Capacitor.registerPlugin('Haptics');
        InAppUpdate = window.Capacitor.registerPlugin('InAppUpdate');
        window.Capacitor.registerPlugin('NativeAd');
        window.Capacitor.registerPlugin('AppOpenAd');
    } else if (window.Capacitor && window.Capacitor.Plugins) {
        Analytics = window.Capacitor.Plugins.SudokuAnalytics;
        Billing = window.Capacitor.Plugins.Billing;
        RemoteConfig = window.Capacitor.Plugins.RemoteConfig;
        Review = window.Capacitor.Plugins.Review;
        Haptics = window.Capacitor.Plugins.Haptics;
        InAppUpdate = window.Capacitor.Plugins.InAppUpdate;
    }
    console.log("[Startup] plugins_available:", !!(window.Capacitor && window.Capacitor.Plugins));

    // Analytics Helper
    function trackEvent(name, params = {}) {
        setTimeout(() => {
            try {
                console.log("Analytics Event:", name, params);
                if (Analytics) {
                    Analytics.logEvent({ name, params }).catch(e => {
                        console.warn("Analytics non-fatal error:", e);
                    });
                }
            } catch (e) {
                console.warn("Analytics crash prevented:", e);
            }
        }, 50); // non-blocking
    }

    // ═══════════════════════════════════════════════
    //  CENTRAL REVIEW PROMPT MANAGER (IN-APP REVIEW)
    // ═══════════════════════════════════════════════

    const ReviewPromptManager = {
        STORAGE_KEY: 'sudoku-review-prompt-state',
        _pendingTrigger: null,
        _pendingTriggerContext: {},
        _newAchievementsThisSession: false,
        _isReviewFlowInProgress: false,

        getState() {
            try {
                const raw = localStorage.getItem(this.STORAGE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    return {
                        firstInstallAt: parsed.firstInstallAt || Date.now(),
                        sessionCount: parsed.sessionCount || 1,
                        completedPuzzleCount: parsed.completedPuzzleCount || 0,
                        dailyChallengeCompletionCount: parsed.dailyChallengeCompletionCount || 0,
                        lastPromptAttemptAt: parsed.lastPromptAttemptAt || 0,
                        promptAttemptCount: parsed.promptAttemptCount || 0,
                        reviewFlowCompletedLocally: !!parsed.reviewFlowCompletedLocally,
                        lastPositiveMilestoneAt: parsed.lastPositiveMilestoneAt || 0
                    };
                }
            } catch (e) {
                console.warn('[ReviewPromptManager] Error reading state:', e);
            }
            return {
                firstInstallAt: Date.now(),
                sessionCount: 1,
                completedPuzzleCount: 0,
                dailyChallengeCompletionCount: 0,
                lastPromptAttemptAt: 0,
                promptAttemptCount: 0,
                reviewFlowCompletedLocally: false,
                lastPositiveMilestoneAt: 0
            };
        },

        saveState(state) {
            try {
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
            } catch (e) {
                console.warn('[ReviewPromptManager] Error saving state:', e);
            }
        },

        init() {
            const state = this.getState();
            state.sessionCount = (state.sessionCount || 0) + 1;
            this.saveState(state);
            console.log(`[ReviewPromptManager] Initialized. Session #${state.sessionCount}, Completed: ${state.completedPuzzleCount}, Attempts: ${state.promptAttemptCount}`);
        },

        getRemoteConfigValue(key, fallback) {
            if (typeof AdMobService !== 'undefined' && typeof AdMobService.getRemoteValue === 'function') {
                return AdMobService.getRemoteValue(key, fallback);
            }
            if (typeof AdMobConfig !== 'undefined' && AdMobConfig.REMOTE && AdMobConfig.REMOTE[key] !== undefined) {
                return AdMobConfig.REMOTE[key];
            }
            return fallback;
        },

        isEligible(trigger = 'generic') {
            if (typeof window.UpdateManager !== 'undefined' && window.UpdateManager.isMandatoryUpdateActive()) {
                console.log(`[ReviewPromptManager] Ineligible: mandatory update active`);
                return false;
            }

            const isEnabled = this.getRemoteConfigValue('review_prompt_enabled', true);
            if (!isEnabled) {
                console.log(`[ReviewPromptManager] Ineligible: review_prompt_enabled=false`);
                return false;
            }

            // Never request while an ad is currently displaying
            if (typeof AdMobService !== 'undefined') {
                if (typeof AdMobService.isAdShowing === 'function' && AdMobService.isAdShowing()) {
                    console.log(`[ReviewPromptManager] Ineligible: ad currently showing`);
                    return false;
                }
            }

            const state = this.getState();

            // Safety rule: never on first session / launch
            const minSessions = Number(this.getRemoteConfigValue('review_min_sessions', 2));
            if (state.sessionCount < minSessions) {
                console.log(`[ReviewPromptManager] Ineligible: sessionCount (${state.sessionCount}) < minSessions (${minSessions})`);
                return false;
            }

            // Safety rule: minimum completed puzzles
            const minPuzzles = Number(this.getRemoteConfigValue('review_min_completed_puzzles', 2));
            if (state.completedPuzzleCount < minPuzzles) {
                console.log(`[ReviewPromptManager] Ineligible: completedPuzzleCount (${state.completedPuzzleCount}) < minPuzzles (${minPuzzles})`);
                return false;
            }

            // Max attempts cap
            const maxAttempts = Number(this.getRemoteConfigValue('review_max_local_attempts', 5));
            if (state.promptAttemptCount >= maxAttempts) {
                console.log(`[ReviewPromptManager] Ineligible: promptAttemptCount (${state.promptAttemptCount}) >= maxAttempts (${maxAttempts})`);
                return false;
            }

            // Trigger-specific feature flags
            if (trigger === 'perfect_solve' && !this.getRemoteConfigValue('review_trigger_perfect_solve', true)) {
                return false;
            }
            if (trigger === 'daily_challenge_completion' && !this.getRemoteConfigValue('review_trigger_daily_challenge', true)) {
                return false;
            }
            if (trigger === 'achievement_unlocked' && !this.getRemoteConfigValue('review_trigger_achievement', true)) {
                return false;
            }
            if (trigger === 'personal_best' && !this.getRemoteConfigValue('review_trigger_personal_best', true)) {
                return false;
            }

            // Local cooldown logic
            const now = Date.now();
            const lastAttempt = state.lastPromptAttemptAt || 0;
            const msSinceLast = now - lastAttempt;

            let requiredCooldownDays = 0;
            if (state.promptAttemptCount === 1) {
                requiredCooldownDays = Number(this.getRemoteConfigValue('review_first_cooldown_days', 7));
            } else if (state.promptAttemptCount === 2) {
                requiredCooldownDays = Number(this.getRemoteConfigValue('review_second_cooldown_days', 21));
            } else if (state.promptAttemptCount >= 3) {
                requiredCooldownDays = Number(this.getRemoteConfigValue('review_later_cooldown_days', 45));
            }

            const requiredCooldownMs = requiredCooldownDays * 24 * 60 * 60 * 1000;
            if (lastAttempt > 0 && msSinceLast < requiredCooldownMs) {
                const daysRemaining = ((requiredCooldownMs - msSinceLast) / (86400000)).toFixed(1);
                console.log(`[ReviewPromptManager] Ineligible: in cooldown (${daysRemaining} days remaining for attempt #${state.promptAttemptCount + 1})`);
                return false;
            }

            return true;
        },

        recordPuzzleCompleted(details = {}) {
            const state = this.getState();
            state.completedPuzzleCount++;
            if (details.isDaily) {
                state.dailyChallengeCompletionCount++;
            }
            state.lastPositiveMilestoneAt = Date.now();
            this.saveState(state);

            // Determine highest priority trigger (Tier A -> Tier B)
            if (details.mistakes === 0 && details.hints === 0) {
                this._pendingTrigger = 'perfect_solve';
            } else if (details.isNewBest) {
                this._pendingTrigger = 'personal_best';
            } else if (details.difficulty === 'hard') {
                this._pendingTrigger = 'hard_puzzle_completion';
            } else if (details.isDaily) {
                this._pendingTrigger = 'daily_challenge_completion';
            } else if (state.completedPuzzleCount === 3) {
                this._pendingTrigger = '3rd_puzzle_completed';
            } else if (state.completedPuzzleCount === 10) {
                this._pendingTrigger = '10th_puzzle_completed';
            } else if (details.streak >= 3) {
                this._pendingTrigger = 'win_streak_milestone';
            } else {
                this._pendingTrigger = 'victory_screen_dismissal';
            }

            this._pendingTriggerContext = {
                difficulty: details.difficulty,
                is_daily: !!details.isDaily,
                mistakes: details.mistakes,
                hints: details.hints,
                streak: details.streak
            };

            console.log(`[ReviewPromptManager] Puzzle completed recorded (#${state.completedPuzzleCount}). Staged trigger: ${this._pendingTrigger}`);
        },

        recordAchievementUnlocked(achievementTitles) {
            this._newAchievementsThisSession = true;
            const state = this.getState();
            state.lastPositiveMilestoneAt = Date.now();
            this.saveState(state);
            this._pendingTrigger = 'achievement_unlocked';
            this._pendingTriggerContext = { achievements: achievementTitles };
            console.log(`[ReviewPromptManager] Achievement unlocked staged:`, achievementTitles);
        },

        async handleVictoryAction() {
            const trigger = this._pendingTrigger || 'victory_screen_dismissal';
            this._pendingTrigger = null;

            if (!this.isEligible(trigger)) {
                return false;
            }

            return await this.launchReviewFlow(trigger, this._pendingTriggerContext);
        },

        async triggerIfEligible(trigger, context = {}) {
            if (!this.isEligible(trigger)) {
                return false;
            }
            return await this.launchReviewFlow(trigger, context);
        },

        async launchReviewFlow(trigger, context = {}) {
            if (this._isReviewFlowInProgress) return false;
            this._isReviewFlowInProgress = true;

            const state = this.getState();
            const daysSinceLast = state.lastPromptAttemptAt ? Math.round((Date.now() - state.lastPromptAttemptAt) / 86400000) : -1;

            const analyticsParams = {
                trigger: trigger,
                completed_puzzles: state.completedPuzzleCount,
                session_count: state.sessionCount,
                days_since_last_attempt: daysSinceLast
            };

            trackEvent('review_eligible', analyticsParams);
            trackEvent('review_request_started', analyticsParams);

            state.promptAttemptCount++;
            state.lastPromptAttemptAt = Date.now();
            state.reviewFlowCompletedLocally = true;
            this.saveState(state);

            console.log(`[ReviewPromptManager] Launching In-App Review request. Attempt #${state.promptAttemptCount}, Trigger: ${trigger}`);

            let reviewAttempted = false;
            try {
                if (Review && typeof Review.requestReview === 'function') {
                    // Impose a 5-second timeout so app navigation is never blocked
                    const reviewPromise = Review.requestReview();
                    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ success: false, status: 'timeout' }), 5000));
                    const res = await Promise.race([reviewPromise, timeoutPromise]);

                    console.log('[ReviewPromptManager] Native review result:', res);
                    if (res && res.success) {
                        reviewAttempted = true;
                        trackEvent('review_request_completed', {
                            trigger: trigger,
                            completed_puzzles: state.completedPuzzleCount,
                            session_count: state.sessionCount,
                            status: res.status || 'success'
                        });
                    } else {
                        trackEvent('review_request_failed', {
                            trigger: trigger,
                            completed_puzzles: state.completedPuzzleCount,
                            session_count: state.sessionCount,
                            error: (res && res.error) || (res && res.status) || 'failed'
                        });
                    }
                } else {
                    console.log('[ReviewPromptManager] Review native plugin not available in this environment');
                    trackEvent('review_request_completed', {
                        trigger: trigger,
                        completed_puzzles: state.completedPuzzleCount,
                        session_count: state.sessionCount,
                        status: 'web_simulated'
                    });
                }
            } catch (err) {
                console.warn('[ReviewPromptManager] Non-fatal review launch error:', err);
                trackEvent('review_request_failed', {
                    trigger: trigger,
                    completed_puzzles: state.completedPuzzleCount,
                    session_count: state.sessionCount,
                    error: String(err)
                });
            } finally {
                this._isReviewFlowInProgress = false;
            }

            return reviewAttempted;
        },

        openManualStoreRating(source = 'settings') {
            trackEvent('review_manual_store_opened', { source });
            const marketUri = 'market://details?id=com.appsedifice.sudokupro.logicpuzzle';
            const httpsUri = 'https://play.google.com/store/apps/details?id=com.appsedifice.sudokupro.logicpuzzle';

            try {
                window.location.href = marketUri;
                setTimeout(() => {
                    if (document.visibilityState === 'visible') {
                        window.open(httpsUri, '_blank');
                    }
                }, 1200);
            } catch (e) {
                window.open(httpsUri, '_blank');
            }
        },

        async openManualShare() {
            const shareText = "I'm enjoying Sudoku Pro! A clean, mindful logic puzzle experience for Android: https://play.google.com/store/apps/details?id=com.appsedifice.sudokupro.logicpuzzle";
            trackEvent('share_app_tapped', { source: 'settings' });

            try {
                if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
                    await window.Capacitor.Plugins.Share.share({
                        title: 'Sudoku Pro',
                        text: shareText,
                        dialogTitle: 'Share Sudoku Pro'
                    });
                } else if (navigator.share) {
                    await navigator.share({
                        title: 'Sudoku Pro',
                        text: shareText
                    });
                } else {
                    window.open('https://play.google.com/store/apps/details?id=com.appsedifice.sudokupro.logicpuzzle', '_blank');
                }
            } catch (e) {
                console.log('[ReviewPromptManager] Share cancelled or failed:', e);
            }
        }
    };

    ReviewPromptManager.init();

    // ═══════════════════════════════════════════════
    //  GOOGLE PLAY IN-APP UPDATE MANAGER
    // ═══════════════════════════════════════════════

    const UpdateManager = {
        _isMandatoryActive: false,
        _flexibleUpdateAvailable: false,
        _flexibleDownloadComplete: false,
        _installedVersionCode: 20,
        _availableVersionCode: 20,
        _isCheckInProgress: false,
        _dismissedThisSession: false,
        _listenersSetup: false,

        isMandatoryUpdateActive() {
            return this._isMandatoryActive;
        },

        getRemoteConfigValue(key, fallback) {
            if (typeof AdMobService !== 'undefined' && typeof AdMobService.getRemoteValue === 'function') {
                return AdMobService.getRemoteValue(key, fallback);
            }
            if (typeof AdMobConfig !== 'undefined' && AdMobConfig.REMOTE && AdMobConfig.REMOTE[key] !== undefined) {
                return AdMobConfig.REMOTE[key];
            }
            return fallback;
        },

        async checkStartupUpdate() {
            if (this._isCheckInProgress) return { isMandatory: this._isMandatoryActive, isFlexible: false };
            this._isCheckInProgress = true;

            console.log("[Update] check_started");

            const updateEnabled = this.getRemoteConfigValue('app_update_enabled', true);
            if (!updateEnabled) {
                console.log("[Update] Skipped: app_update_enabled is false");
                this._isCheckInProgress = false;
                return { isMandatory: false, isFlexible: false };
            }

            if (!InAppUpdate || typeof InAppUpdate.checkForUpdate !== 'function') {
                console.log("[Update] InAppUpdate plugin not available");
                this._isCheckInProgress = false;
                return { isMandatory: false, isFlexible: false };
            }

            try {
                const info = await InAppUpdate.checkForUpdate();
                this._installedVersionCode = Number(info.installedVersionCode || 20);
                this._availableVersionCode = Number(info.availableVersionCode || this._installedVersionCode);

                console.log(`[Update] installed_version: ${this._installedVersionCode}`);
                console.log(`[Update] available_version: ${this._availableVersionCode}`);
                console.log(`[Update] update_available: ${!!info.updateAvailable}`);
                console.log(`[Update] immediate_allowed: ${!!info.immediateAllowed}`);
                console.log(`[Update] flexible_allowed: ${!!info.flexibleAllowed}`);

                if (info.updateAvailable || info.updateInProgress) {
                    trackEvent('app_update_available', {
                        installed_version: this._installedVersionCode,
                        available_version: this._availableVersionCode,
                        update_priority: info.updatePriority || 0,
                        immediate_allowed: !!info.immediateAllowed,
                        flexible_allowed: !!info.flexibleAllowed
                    });

                    const minSupportedVersion = Number(this.getRemoteConfigValue('minimum_supported_version_code', 19));
                    const forceUpdateBelow = Number(this.getRemoteConfigValue('force_update_below_version_code', 19));
                    const flexibleUpdateBelow = Number(this.getRemoteConfigValue('flexible_update_below_version_code', 20));

                    const isImmediateRequired = (
                        this._installedVersionCode < forceUpdateBelow ||
                        this._installedVersionCode < minSupportedVersion ||
                        (info.updatePriority >= 4 && info.immediateAllowed)
                    );

                    if (isImmediateRequired && (info.immediateAllowed || info.updateInProgress)) {
                        console.log("[Update] immediate_required: true");
                        this._isMandatoryActive = true;
                        this.presentMandatoryUpdateUI();
                        this._isCheckInProgress = false;
                        return { isMandatory: true, isFlexible: false, info };
                    }

                    const isFlexibleEligible = (
                        this._installedVersionCode < flexibleUpdateBelow &&
                        info.flexibleAllowed &&
                        !this._dismissedThisSession
                    );

                    if (isFlexibleEligible) {
                        console.log("[Update] flexible_eligible: true");
                        this._flexibleUpdateAvailable = true;
                        this._setupFlexibleListeners();
                        this.presentFlexibleBanner(info);
                        this._isCheckInProgress = false;
                        return { isMandatory: false, isFlexible: true, info };
                    }
                } else {
                    console.log("[Update] No update required or available.");
                }
            } catch (e) {
                console.warn("[Update] Exception checking for update:", e);
            }

            this._isCheckInProgress = false;
            return { isMandatory: false, isFlexible: false };
        },

        presentMandatoryUpdateUI() {
            const modal = document.getElementById('mandatory-update-modal');
            const updateBtn = document.getElementById('mandatory-update-btn');
            const statusNote = document.getElementById('mandatory-update-status');

            if (modal) {
                modal.classList.remove('hidden');
            }

            // Suppress ads immediately
            if (typeof AdMobService !== 'undefined') {
                AdMobService.logAdState("mandatory_update_active");
                if (typeof AdMobService.hideNativeAd === 'function') {
                    AdMobService.hideNativeAd();
                }
            }

            if (updateBtn) {
                updateBtn.onclick = () => {
                    this.startImmediateFlow();
                };
            }

            // Listen for immediate result
            this._setupFlexibleListeners();

            // Auto-launch Google Play immediate flow
            this.startImmediateFlow();
        },

        async startImmediateFlow() {
            console.log("[Update] immediate_started");
            trackEvent('app_update_started', {
                type: 'immediate',
                installed_version: this._installedVersionCode,
                available_version: this._availableVersionCode
            });

            const statusNote = document.getElementById('mandatory-update-status');
            if (statusNote) {
                statusNote.classList.remove('hidden');
                statusNote.textContent = "Connecting to Google Play...";
            }

            try {
                if (InAppUpdate && typeof InAppUpdate.startImmediateUpdate === 'function') {
                    const res = await InAppUpdate.startImmediateUpdate();
                    if (!res || !res.success) {
                        console.warn("[Update] failed to start immediate update:", res);
                        if (statusNote) {
                            statusNote.textContent = "Update flow could not be started. Tap below to retry.";
                        }
                        trackEvent('app_update_failed', { type: 'immediate', status: res ? res.status : 'null' });
                    }
                }
            } catch (e) {
                console.error("[Update] Exception starting immediate update:", e);
                if (statusNote) {
                    statusNote.textContent = "Update error. Tap to retry.";
                }
                trackEvent('app_update_failed', { type: 'immediate', error: e.message });
            }
        },

        _setupFlexibleListeners() {
            if (this._listenersSetup) return;
            if (!InAppUpdate || typeof InAppUpdate.addListener !== 'function') return;
            this._listenersSetup = true;

            InAppUpdate.addListener('onFlexibleUpdateStateChange', (event) => {
                console.log("[Update] onFlexibleUpdateStateChange:", event);
                if (event.status === 'DOWNLOADING') {
                    const pct = event.totalBytesToDownload > 0
                        ? Math.round((event.bytesDownloaded / event.totalBytesToDownload) * 100)
                        : 0;
                    this.updateFlexibleBannerProgress(pct);
                } else if (event.status === 'DOWNLOADED') {
                    console.log("[Update] downloaded");
                    this._flexibleDownloadComplete = true;
                    this.showFlexibleReadyBanner();
                    trackEvent('app_update_completed', { type: 'flexible_downloaded' });
                } else if (event.status === 'FAILED') {
                    console.warn("[Update] flexible download failed");
                    trackEvent('app_update_failed', { type: 'flexible_download' });
                }
            });

            InAppUpdate.addListener('onImmediateUpdateResult', (res) => {
                console.log("[Update] onImmediateUpdateResult:", res);
                const statusNote = document.getElementById('mandatory-update-status');
                if (res.resultCode === 0) { // Activity.RESULT_CANCELED
                    console.log("[Update] cancelled");
                    trackEvent('app_update_cancelled', { type: 'immediate' });
                    if (statusNote) {
                        statusNote.classList.remove('hidden');
                        statusNote.textContent = "Update required to continue. Tap to retry.";
                    }
                } else if (res.resultCode === -1) { // Activity.RESULT_OK
                    console.log("[Update] completed");
                    trackEvent('app_update_completed', { type: 'immediate' });
                } else {
                    console.warn("[Update] failed resultCode=" + res.resultCode);
                    trackEvent('app_update_failed', { type: 'immediate', resultCode: res.resultCode });
                    if (statusNote) {
                        statusNote.classList.remove('hidden');
                        statusNote.textContent = "Update failed. Tap to retry.";
                    }
                }
            });
        },

        presentFlexibleBanner(info) {
            const banner = document.getElementById('home-update-banner');
            const titleEl = document.getElementById('update-banner-title');
            const descEl = document.getElementById('update-banner-desc');
            const actionBtn = document.getElementById('home-update-action-btn');
            const laterBtn = document.getElementById('home-update-later-btn');

            if (!banner) return;
            banner.classList.remove('hidden');

            if (titleEl) titleEl.textContent = "Update Available";
            if (descEl) descEl.textContent = `A newer edition (v${this._availableVersionCode}) is ready on Google Play.`;

            if (actionBtn) {
                actionBtn.textContent = "Update";
                actionBtn.onclick = async () => {
                    console.log("[Update] flexible_started");
                    trackEvent('app_update_started', {
                        type: 'flexible',
                        installed_version: this._installedVersionCode,
                        available_version: this._availableVersionCode
                    });
                    actionBtn.disabled = true;
                    actionBtn.textContent = "Downloading...";
                    try {
                        await InAppUpdate.startFlexibleUpdate();
                    } catch (e) {
                        console.error("[Update] Failed starting flexible update:", e);
                        actionBtn.disabled = false;
                        actionBtn.textContent = "Update";
                    }
                };
            }

            if (laterBtn) {
                laterBtn.onclick = () => {
                    banner.classList.add('hidden');
                    this._dismissedThisSession = true;
                    console.log("[Update] flexible dismissed for this session");
                    trackEvent('app_update_cancelled', { type: 'flexible_dismissed' });
                };
            }
        },

        updateFlexibleBannerProgress(pct) {
            const descEl = document.getElementById('update-banner-desc');
            const actionBtn = document.getElementById('home-update-action-btn');
            if (descEl) descEl.textContent = `Downloading update: ${pct}%`;
            if (actionBtn) actionBtn.textContent = `${pct}%`;
        },

        showFlexibleReadyBanner() {
            const banner = document.getElementById('home-update-banner');
            const titleEl = document.getElementById('update-banner-title');
            const descEl = document.getElementById('update-banner-desc');
            const actionBtn = document.getElementById('home-update-action-btn');
            const laterBtn = document.getElementById('home-update-later-btn');

            if (!banner) return;
            banner.classList.remove('hidden');

            if (titleEl) titleEl.textContent = "Update Ready";
            if (descEl) descEl.textContent = "Download complete. Restart to apply update.";
            if (laterBtn) laterBtn.classList.add('hidden');

            if (actionBtn) {
                actionBtn.disabled = false;
                actionBtn.textContent = "Restart Now";
                actionBtn.onclick = async () => {
                    console.log("[Update] completeFlexibleUpdate requested");
                    try {
                        await InAppUpdate.completeFlexibleUpdate();
                    } catch (e) {
                        console.error("[Update] Exception completing flexible update:", e);
                    }
                };
            }
        }
    };

    window.UpdateManager = UpdateManager;

    // ═══════════════════════════════════════════════
    //  BILLING & REMOTE CONFIG INITIALIZATION
    // ═══════════════════════════════════════════════
    const initBillingPromise = (async () => {
        if (!Billing) return false;
        if (UpdateManager.isMandatoryUpdateActive()) return false;
        try {
            await Billing.initialize();
            const res = await Billing.isRemoveAdsPurchased();
            const isPurchased = !!(res && res.isPurchased);
            console.log("Billing result isPurchased:", isPurchased);
            window.isPremium = isPurchased;
            if (typeof AdMobService !== 'undefined') {
                AdMobService.setPremium(isPurchased);
            }
            const adsBtn = document.getElementById('settings-ads-btn');
            if (adsBtn) {
                adsBtn.textContent = isPurchased ? 'Ads Removed' : 'Remove Ads';
            }
            if (isPurchased) {
                trackEvent('remove_ads_active');
            }
            return isPurchased;
        } catch (e) {
            console.warn("Billing init error", e);
            return false;
        }
    })();

    if (Billing && Billing.addListener) {
        Billing.addListener("purchaseSuccessful", () => {
            console.log("Purchase successful event received");
            window.isPremium = true;
            if (typeof AdMobService !== 'undefined') AdMobService.setPremium(true);
            const adsBtn = document.getElementById('settings-ads-btn');
            if (adsBtn) {
                adsBtn.textContent = 'Ads Removed';
            }
            trackEvent('remove_ads_purchased');
            alert("Thank you! Ads have been removed.");
        });
    }

    const initRemoteConfigPromise = (async () => {
        if (!RemoteConfig) return null;
        try {
            console.log("[RemoteConfig] Fetching and activating remote configuration...");
            const result = await RemoteConfig.fetchAndActivate();
            console.log("[RemoteConfig] Fetch result:", result);
            if (result && result.values && typeof AdMobConfig !== 'undefined') {
                AdMobConfig.applyRemoteConfig(result.values);
            }
            return result;
        } catch (err) {
            console.warn("[RemoteConfig] Non-fatal fetch error (using defaults):", err);
            return null;
        }
    })();

    // Await billing and remote config before requesting ads
    await Promise.allSettled([initBillingPromise, initRemoteConfigPromise]);
    console.log(`[Startup] billing_ready (isPremium=${window.isPremium})`);
    console.log("[Startup] remote_config_ready");

    // ═══════════════════════════════════════════════
    //  AUTHORITATIVE UMP CONSENT & ADMOB INITIALIZATION
    // ═══════════════════════════════════════════════
    console.log("[Startup] admob_initialize_start");
    if (typeof AdMobService !== 'undefined') {
        try {
            console.log("[Startup] gathering_consent_start");
            const consentResult = await AdMobService.gatherConsent();
            console.log("[Startup] gathering_consent_complete:", consentResult);

            if (AdMobService.canRequestAds()) {
                await AdMobService.initialize();
                console.log("[Startup] admob_initialize_complete");

                // Every true app launch attempts to preload App Open ad when eligible
                if (!window.isPremium && AdMobService.isFeatureEnabled('app_open_ads_enabled')) {
                    console.log("[AppOpen] launch_detected");
                    console.log("[AppOpen] preload_started");
                    await AdMobService.initAppOpenAd();
                }
            } else {
                console.log("[Startup] Ads disabled by UMP consent (canRequestAds=false). AdMob initialization skipped.");
            }
        } catch (err) {
            console.warn("[Startup] AdMob init / consent error:", err);
        }
    }

    function showToast(message) {
        let toast = document.getElementById('sudoku-global-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'sudoku-global-toast';
            toast.style.position = 'fixed';
            toast.style.bottom = '80px';
            toast.style.left = '50%';
            toast.style.transform = 'translateX(-50%)';
            toast.style.backgroundColor = 'var(--st-primary, #010B17)';
            toast.style.color = 'var(--st-on-primary, #FFFFFF)';
            toast.style.padding = '10px 18px';
            toast.style.borderRadius = '24px';
            toast.style.fontSize = '13px';
            toast.style.fontFamily = "'Plus Jakarta Sans', sans-serif";
            toast.style.fontWeight = '600';
            toast.style.boxShadow = '0 6px 20px rgba(1, 11, 23, 0.35)';
            toast.style.zIndex = '10001';
            toast.style.pointerEvents = 'none';
            toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
            toast.style.opacity = '0';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(10px)';
        }, 3000);
    }

    // ═══════════════════════════════════════════════
    //  VIEW SWITCHING
    // ═══════════════════════════════════════════════

    const homeScreen = document.getElementById('home-screen');
    const gameScreen = document.getElementById('game-screen');

    function showView(viewName) {
        if (viewName === 'home') {
            homeScreen.classList.remove('hidden-view');
            gameScreen.classList.add('hidden-view');
            gameScreen.classList.remove('has-native-ad');
            updateContinueButton();
            if (typeof AdMobService !== 'undefined') {
                AdMobService.setGameplayActive(false);
                AdMobService.hideGameplayBannerAd();
                AdMobService.showNativeAd('home').then(success => {
                    if (success) {
                        homeScreen.classList.add('has-native-ad');
                    } else {
                        homeScreen.classList.remove('has-native-ad');
                    }
                }).catch(() => {
                    homeScreen.classList.remove('has-native-ad');
                });
            } else {
                homeScreen.classList.remove('has-native-ad');
            }
        } else if (viewName === 'game') {
            homeScreen.classList.add('hidden-view');
            homeScreen.classList.remove('has-native-ad');
            gameScreen.classList.remove('hidden-view');
            if (typeof AdMobService !== 'undefined') {
                AdMobService.hideHomeBannerAd();
                AdMobService.hideNativeAd();
                AdMobService.setGameplayActive(true);
                if (!window.isPremium) {
                    AdMobService.showGameplayAd();
                }
            }
        }
    }

    // ═══════════════════════════════════════════════
    //  DIFFICULTY STATE
    // ═══════════════════════════════════════════════

    let selectedDifficulty = localStorage.getItem('sudoku-difficulty') || 'easy';

    const diffEasyBtn = document.getElementById('difficulty-easy-btn');
    const diffMediumBtn = document.getElementById('difficulty-medium-btn');
    const diffHardBtn = document.getElementById('difficulty-hard-btn');
    const diffChips = [diffEasyBtn, diffMediumBtn, diffHardBtn].filter(Boolean);

    function updateDifficultyUI() {
        diffChips.forEach(chip => {
            if (chip.dataset.difficulty === selectedDifficulty) {
                chip.classList.add('selected');
            } else {
                chip.classList.remove('selected');
            }
        });
    }

    diffChips.forEach(chip => {
        chip.addEventListener('click', () => {
            selectedDifficulty = chip.dataset.difficulty;
            localStorage.setItem('sudoku-difficulty', selectedDifficulty);
            updateDifficultyUI();
            if (typeof HapticEngine !== 'undefined') HapticEngine.selection();
            trackEvent('difficulty_selected', { difficulty: selectedDifficulty });
        });
    });

    updateDifficultyUI();

    // ═══════════════════════════════════════════════
    //  GAME MODE STATE
    // ═══════════════════════════════════════════════

    let isDailyChallenge = false;   // true when playing today's daily puzzle
    let activeDailyChallengeDateKey = null; // tracks date string of active daily challenge
    let isGameOverNavigationInProgress = false; // prevents double taps on game over actions
    let hintsUsedThisGame = 0;      // track for No-Help achievement
    let mistakesThisGame = 0;       // track for Perfect Solve achievement

    // ═══════════════════════════════════════════════
    //  DAILY CHALLENGE ENGINE
    // ═══════════════════════════════════════════════

    const DailyChallengeEngine = {
        // Returns today's date as 'YYYY-MM-DD'
        todayKey() {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        },

        // Seeded pseudo-random number generator (mulberry32)
        seededRng(seed) {
            return function() {
                seed |= 0; seed = seed + 0x6D2B79F5 | 0;
                let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
                t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
                return ((t ^ t >>> 14) >>> 0) / 4294967296;
            };
        },

        // Convert date string to a numeric seed
        dateSeed(dateKey) {
            return dateKey.split('-').reduce((acc, p) => acc * 10000 + parseInt(p), 0);
        },

        // Generate deterministic puzzle for a given date
        generateForDate(dateKey) {
            const seed = this.dateSeed(dateKey);
            const rng = this.seededRng(seed);

            // Seeded shuffle
            function shuffle(arr) {
                for (let i = arr.length - 1; i > 0; i--) {
                    const j = Math.floor(rng() * (i + 1));
                    [arr[i], arr[j]] = [arr[j], arr[i]];
                }
                return arr;
            }

            // Seeded fillGrid
            function isValidLocal(g, idx, num) {
                const row = Math.floor(idx / 9);
                const col = idx % 9;
                for (let i = 0; i < 9; i++) {
                    if (g[row*9+i] === num || g[i*9+col] === num) return false;
                }
                const sr = Math.floor(row/3)*3, sc = Math.floor(col/3)*3;
                for (let i = 0; i < 3; i++)
                    for (let j = 0; j < 3; j++)
                        if (g[(sr+i)*9+(sc+j)] === num) return false;
                return true;
            }

            function fillLocal(g) {
                for (let i = 0; i < 81; i++) {
                    if (g[i] === 0) {
                        const nums = shuffle([1,2,3,4,5,6,7,8,9]);
                        for (const num of nums) {
                            if (isValidLocal(g, i, num)) {
                                g[i] = num;
                                if (fillLocal(g)) return true;
                                g[i] = 0;
                            }
                        }
                        return false;
                    }
                }
                return true;
            }

            const grid = new Array(81).fill(0);
            fillLocal(grid);
            const solved = [...grid];

            // Daily uses medium difficulty: 40-45 removals
            const removals = 40 + Math.floor(rng() * 6);
            // Simple seeded removal (no uniqueness check for speed; daily is always valid)
            const indices = shuffle([...Array(81).keys()]);
            let removed = 0;
            for (const idx of indices) {
                if (removed >= removals) break;
                grid[idx] = 0;
                removed++;
            }

            return { grid, solved };
        },

        getCompletionKey(dateKey) {
            return `sudoku-daily-done-${dateKey}`;
        },

        isCompleted(dateKey) {
            return localStorage.getItem(this.getCompletionKey(dateKey)) === 'true';
        },

        markCompleted(dateKey) {
            localStorage.setItem(this.getCompletionKey(dateKey), 'true');
            if (this.currentYear && this.currentMonth !== undefined) {
                this.computeStats();
                this.renderCalendar(this.currentYear, this.currentMonth);
            }
        },

        currentYear: new Date().getFullYear(),
        currentMonth: new Date().getMonth(),
        selectedDateKey: null,

        computeStats() {
            let currentStreak = 0;
            let bestStreak = 0;
            let totalCompleted = 0;
            let monthCompleted = 0;

            const allKeys = Object.keys(localStorage)
                .filter(k => k.startsWith('sudoku-daily-done-'))
                .map(k => k.replace('sudoku-daily-done-', ''))
                .sort();

            totalCompleted = allKeys.length;

            const monthPrefix = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}`;
            monthCompleted = allKeys.filter(k => k.startsWith(monthPrefix)).length;

            let tempStreak = 0;
            let lastDateObj = null;

            for (const dateKey of allKeys) {
                const dateObj = new Date(dateKey + 'T00:00:00'); 
                if (!lastDateObj) {
                    tempStreak = 1;
                } else {
                    const diffTime = Math.abs(dateObj - lastDateObj);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                    if (diffDays === 1) {
                        tempStreak++;
                    } else if (diffDays > 1) {
                        tempStreak = 1;
                    }
                }
                if (tempStreak > bestStreak) bestStreak = tempStreak;
                lastDateObj = dateObj;
            }

            const todayStr = this.todayKey();
            const d = new Date();
            d.setDate(d.getDate() - 1);
            const yesterdayStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

            if (allKeys.length > 0) {
                const lastCompleted = allKeys[allKeys.length - 1];
                if (lastCompleted === todayStr || lastCompleted === yesterdayStr) {
                    currentStreak = tempStreak;
                } else {
                    currentStreak = 0;
                }
            }

            const eCur = document.getElementById('cal-streak-current');
            const eBest = document.getElementById('cal-streak-best');
            const eTotal = document.getElementById('cal-total');
            const eMonth = document.getElementById('cal-month-progress');

            if (eCur) eCur.textContent = currentStreak;
            if (eBest) eBest.textContent = bestStreak;
            if (eTotal) eTotal.textContent = totalCompleted;
            if (eMonth) {
                const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
                eMonth.textContent = `${monthCompleted}/${daysInMonth}`;
            }
        },

        getStreak() {
            this.computeStats();
            const eCur = document.getElementById('cal-streak-current');
            return eCur ? parseInt(eCur.textContent, 10) || 0 : 0;
        },

        renderCalendar(year, month) {
            const grid = document.getElementById('cal-grid');
            const header = document.getElementById('cal-month-year');
            if (!grid || !header) return;

            const d = new Date(year, month, 1);
            header.textContent = d.toLocaleString('default', { month: 'long', year: 'numeric' });
            grid.innerHTML = '';
            
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const todayStr = this.todayKey();

            for (let i = 0; i < firstDay; i++) {
                const empty = document.createElement('div');
                empty.className = 'cal-day cal-empty';
                grid.appendChild(empty);
            }

            const now = new Date();
            now.setHours(0,0,0,0);

            for (let day = 1; day <= daysInMonth; day++) {
                const cell = document.createElement('div');
                cell.className = 'cal-day';
                cell.setAttribute('role', 'button');
                cell.setAttribute('tabindex', '0');

                const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                
                const isCompleted = this.isCompleted(dateStr);
                const isToday = (dateStr === todayStr);
                const cellDate = new Date(year, month, day);
                const isFuture = cellDate > now;
                
                if (isToday) cell.classList.add('cal-today');
                if (isCompleted) cell.classList.add('cal-completed');

                if (isFuture) {
                    cell.classList.add('cal-disabled');
                } else if (!isCompleted && !isToday) {
                    cell.classList.add('cal-missed');
                }

                if (this.selectedDateKey === dateStr) {
                    cell.classList.add('cal-selected');
                }

                let iconHtml = '';
                if (isCompleted) {
                    iconHtml = '<span class="material-symbols-outlined cal-day-icon">verified</span>';
                } else if (isToday) {
                    iconHtml = '<span class="material-symbols-outlined cal-day-icon">play_circle</span>';
                } else if (isFuture) {
                    iconHtml = '<span class="material-symbols-outlined cal-day-icon">lock</span>';
                }

                cell.innerHTML = `<span class="cal-day-num">${day}</span>${iconHtml}`;

                cell.addEventListener('click', () => {
                    this.selectedDateKey = dateStr;
                    this.renderCalendar(year, month);
                    const actionCard = document.querySelector('.cal-action-card');
                    if (actionCard) {
                        actionCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                });

                grid.appendChild(cell);
            }
            
            this.updateFooter();
        },

        updateFooter() {
            const statusLabel = document.getElementById('cal-selected-status');
            const playBtn = document.getElementById('daily-play-btn');
            if (!statusLabel || !playBtn) return;

            if (!this.selectedDateKey) {
                statusLabel.textContent = "Select a day";
                playBtn.disabled = true;
                return;
            }

            const todayStr = this.todayKey();
            const isToday = (this.selectedDateKey === todayStr);
            const isCompleted = this.isCompleted(this.selectedDateKey);
            
            const parts = this.selectedDateKey.split('-');
            const selDate = new Date(parts[0], parts[1]-1, parts[2]);
            const formatted = selDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

            const now = new Date();
            now.setHours(0,0,0,0);
            const isFuture = selDate > now;

            if (isFuture) {
                statusLabel.textContent = `${formatted} • Locked`;
                playBtn.disabled = true;
                playBtn.innerHTML = '<span class="material-symbols-outlined">lock</span><span>Locked</span>';
            } else if (isCompleted) {
                statusLabel.textContent = `${formatted} • Completed`;
                playBtn.disabled = false;
                playBtn.innerHTML = '<span class="material-symbols-outlined">replay</span><span>Play Again</span>';
            } else if (isToday) {
                statusLabel.textContent = `${formatted} • Today's Challenge`;
                playBtn.disabled = false;
                playBtn.innerHTML = '<span class="material-symbols-outlined">play_arrow</span><span>Play Now</span>';
            } else {
                statusLabel.textContent = `${formatted} • Past Challenge`;
                playBtn.disabled = false;
                playBtn.innerHTML = '<span class="material-symbols-outlined">play_arrow</span><span>Play Now</span>';
            }
        },

        navigateMonth(delta) {
            this.currentMonth += delta;
            if (this.currentMonth > 11) {
                this.currentMonth = 0;
                this.currentYear++;
            } else if (this.currentMonth < 0) {
                this.currentMonth = 11;
                this.currentYear--;
            }
            
            const now = new Date();
            if (this.currentYear === now.getFullYear() && this.currentMonth === now.getMonth()) {
                this.selectedDateKey = this.todayKey();
            } else {
                this.selectedDateKey = `${this.currentYear}-${String(this.currentMonth+1).padStart(2,'0')}-01`;
            }
            
            this.computeStats();
            this.renderCalendar(this.currentYear, this.currentMonth);
        },

        openModal() {
            const modal = document.getElementById('daily-challenge-modal');
            if (!modal) return;

            const now = new Date();
            this.currentYear = now.getFullYear();
            this.currentMonth = now.getMonth();
            this.selectedDateKey = this.todayKey();
            
            this.computeStats();
            this.renderCalendar(this.currentYear, this.currentMonth);

            modal.classList.remove('hidden');
        }
    };

    // ═══════════════════════════════════════════════
    //  ACHIEVEMENTS ENGINE
    // ═══════════════════════════════════════════════

    const AchievementsEngine = {
        definitions: [
            {
                id: 'first-win',
                icon: '🥇',
                title: 'First Win',
                desc: 'Complete your first puzzle',
                check: (stats, daily) => stats.gamesWon >= 1,
                progress: (stats) => `${Math.min(stats.gamesWon, 1)} / 1`
            },
            {
                id: 'beginner',
                icon: '🌱',
                title: 'Puzzle Beginner',
                desc: 'Complete 5 puzzles',
                check: (stats) => stats.gamesWon >= 5,
                progress: (stats) => `${Math.min(stats.gamesWon, 5)} / 5`
            },
            {
                id: 'solver',
                icon: '🧩',
                title: 'Sudoku Solver',
                desc: 'Complete 10 puzzles',
                check: (stats) => stats.gamesWon >= 10,
                progress: (stats) => `${Math.min(stats.gamesWon, 10)} / 10`
            },
            {
                id: 'perfect',
                icon: '✨',
                title: 'Perfect Solve',
                desc: 'Complete a puzzle with 0 mistakes',
                check: (stats, daily, flags) => flags.perfectSolve === true,
                progress: null
            },
            {
                id: 'no-hints',
                icon: '🚫💡',
                title: 'No Help Needed',
                desc: 'Complete a puzzle without using a hint',
                check: (stats, daily, flags) => flags.noHints === true,
                progress: null
            },
            {
                id: 'daily-solver',
                icon: '📅',
                title: 'Daily Solver',
                desc: 'Complete one Daily Challenge',
                check: (stats, daily) => daily.anyCompleted,
                progress: null
            }
        ],

        getUnlocked() {
            const raw = localStorage.getItem('sudoku-achievements-unlocked');
            return raw ? JSON.parse(raw) : {};
        },

        saveUnlocked(unlocked) {
            localStorage.setItem('sudoku-achievements-unlocked', JSON.stringify(unlocked));
        },

        // Call after every win
        onWin(flags) {
            const stats = StatsEngine.stats;
            // Check if any daily ever completed
            const anyDailyKey = Object.keys(localStorage)
                .some(k => k.startsWith('sudoku-daily-done-') && localStorage.getItem(k) === 'true');
            const daily = { anyCompleted: anyDailyKey };

            const unlocked = this.getUnlocked();
            let newUnlocks = [];

            this.definitions.forEach(def => {
                if (!unlocked[def.id] && def.check(stats, daily, flags || {})) {
                    unlocked[def.id] = Date.now();
                    newUnlocks.push(def.title);
                }
            });

            if (newUnlocks.length > 0) {
                this.saveUnlocked(unlocked);
                if (typeof ReviewPromptManager !== 'undefined') {
                    ReviewPromptManager.recordAchievementUnlocked(newUnlocks);
                }
            }
        },

        renderModal() {
            const list = document.getElementById('achievements-list');
            if (!list) return;

            const stats = StatsEngine.stats;
            const anyDailyKey = Object.keys(localStorage)
                .some(k => k.startsWith('sudoku-daily-done-') && localStorage.getItem(k) === 'true');
            const daily = { anyCompleted: anyDailyKey };
            const unlocked = this.getUnlocked();

            // Calculate overall progress summary
            const totalCount = this.definitions.length;
            let unlockedCount = 0;
            this.definitions.forEach(def => {
                if (unlocked[def.id]) unlockedCount++;
            });

            const pct = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;
            const summaryPct = document.getElementById('achieve-summary-pct');
            const summaryCount = document.getElementById('achieve-summary-count');
            const progressFill = document.getElementById('achieve-progress-fill');

            if (summaryPct) summaryPct.textContent = `${pct}%`;
            if (summaryCount) summaryCount.textContent = `${unlockedCount} of ${totalCount} Completed`;
            if (progressFill) progressFill.style.width = `${pct}%`;

            // Material Symbols map for canonical achievements
            const symbolMap = {
                'first-win': 'workspace_premium',
                'beginner': 'potted_plant',
                'solver': 'extension',
                'perfect': 'auto_awesome',
                'no-hints': 'lightbulb',
                'daily-solver': 'calendar_today'
            };

            list.innerHTML = '';
            this.definitions.forEach(def => {
                const isUnlocked = !!unlocked[def.id];
                const symbol = symbolMap[def.id] || 'military_tech';
                
                // Determine in-progress state for incremental achievements
                let isInProgress = false;
                let currentVal = 0;
                let maxVal = 1;
                let fractionText = '';

                if (def.progress) {
                    fractionText = def.progress(stats);
                    const parts = fractionText.split('/').map(p => parseInt(p.trim(), 10));
                    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                        currentVal = parts[0];
                        maxVal = parts[1];
                        if (!isUnlocked && currentVal > 0) {
                            isInProgress = true;
                        }
                    }
                }

                const item = document.createElement('article');
                let stateClass = 'locked';
                if (isUnlocked) {
                    stateClass = 'completed';
                } else if (isInProgress) {
                    stateClass = 'in-progress';
                }
                item.className = `achievement-card ${stateClass}`;

                // Status Badge markup
                let statusBadgeHtml = '';
                if (isUnlocked) {
                    statusBadgeHtml = `
                        <span class="achieve-card-status-badge completed">
                            <span class="material-symbols-outlined">check_circle</span>
                            <span>Completed</span>
                        </span>
                    `;
                } else if (isInProgress) {
                    statusBadgeHtml = `
                        <span class="achieve-card-status-badge in-progress">
                            <span>In Progress</span>
                        </span>
                    `;
                } else {
                    statusBadgeHtml = `
                        <span class="achieve-card-status-badge locked">
                            <span class="material-symbols-outlined">lock</span>
                            <span>Locked</span>
                        </span>
                    `;
                }

                // Progress Bar or text indicator markup
                let footerHtml = '';
                if (isUnlocked) {
                    footerHtml = `<div class="achieve-card-footer"><span class="achieve-fraction-text">${fractionText || 'Mastered'}</span></div>`;
                } else if (isInProgress) {
                    const fillPct = Math.min(100, Math.round((currentVal / maxVal) * 100));
                    footerHtml = `
                        <div class="achieve-card-progress-bar-wrap">
                            <div class="achieve-card-track">
                                <div class="achieve-card-fill" style="width: ${fillPct}%;"></div>
                            </div>
                            <span class="achieve-fraction-text in-progress-fraction">${fractionText}</span>
                        </div>
                    `;
                } else {
                    footerHtml = `<div class="achieve-card-footer"><span class="achieve-fraction-text">${fractionText || '0 / 1'}</span></div>`;
                }

                item.innerHTML = `
                    <div class="achieve-card-icon-wrap ${stateClass}">
                        <span class="material-symbols-outlined">${symbol}</span>
                    </div>
                    <div class="achieve-card-body">
                        <div class="achieve-card-top-row">
                            <h4 class="achieve-card-title">${def.title}</h4>
                            ${statusBadgeHtml}
                        </div>
                        <p class="achieve-card-desc">${def.desc}</p>
                        ${footerHtml}
                    </div>
                `;
                list.appendChild(item);
            });
        },

        openModal() {
            this.renderModal();
            const modal = document.getElementById('achievements-modal');
            if (modal) modal.classList.remove('hidden');
        }
    };

    // ═══════════════════════════════════════════════
    //  GAME ENGINE REFERENCES
    // ═══════════════════════════════════════════════

    const board = document.getElementById('sudoku-board');
    const undoBtn = document.getElementById('undo-btn');
    const undoCountSpan = document.getElementById('undo-count');
    const newGameBtn = document.getElementById('new-game-btn');
    const eraseBtn = document.getElementById('erase-btn');
    const hintBtn = document.getElementById('hint-btn');
    const hintCountSpan = document.getElementById('hint-count');
    const autoCheckBtn = document.getElementById('auto-check-btn');
    const autoCheckBadge = document.getElementById('auto-check-badge');
    let autoCheckUsedThisPuzzle = 0;
    let autoCheckClearTimeoutId = null;
    const numpad = document.getElementById('numpad');
    const timerDisplay = document.getElementById('timer');
    const mistakesDisplay = document.getElementById('mistakes');
    const gameOverModal = document.getElementById('game-over-modal');
    const tryAgainBtn = document.getElementById('try-again-btn');
    const restartGameBtn = document.getElementById('restart-game-btn');
    const rewardAdModal = document.getElementById('reward-ad-modal');
const rewardAdIcon = document.getElementById('reward-ad-icon');
const rewardAdTitle = document.getElementById('reward-ad-title');
const rewardAdMessage = document.getElementById('reward-ad-message');
const rewardAdCancel = document.getElementById('reward-ad-cancel');
const rewardAdConfirm = document.getElementById('reward-ad-confirm');

let rewardAdModalResolve = null;
    
    // Consent Modal
    const consentModal = document.getElementById('consent-modal');
    const consentAcceptBtn = document.getElementById('consent-accept-btn');
    
    // Stats UI
    const statsBtn = document.getElementById('stats-btn');
    const statsModal = document.getElementById('stats-modal');
    const closeStatsBtn = document.getElementById('close-stats-btn');
    const resetStatsBtn = document.getElementById('reset-stats-btn');
    const statGamesPlayed = document.getElementById('stat-games-played');
    const statGamesWon = document.getElementById('stat-games-won');
    const statWinRate = document.getElementById('stat-win-rate');
    const statCurrentStreak = document.getElementById('stat-current-streak');
    const statBestStreak = document.getElementById('stat-best-streak');
    const statBestTime = document.getElementById('stat-best-time');
    const statTotalMistakes = document.getElementById('stat-total-mistakes');
    
    // Tutorial UI (Text modal)
    const tutorialModal = document.getElementById('tutorial-modal');
    const tutorialVisual = document.getElementById('tutorial-visual');
    const tutorialStepTitle = document.getElementById('tutorial-step-title');
    const tutorialText = document.getElementById('tutorial-text');
    const tutorialDotsWrap = document.getElementById('tutorial-dots-wrap');
    const tutorialStepIndicator = document.getElementById('tutorial-step-indicator');
    const tutorialNextBtn = document.getElementById('tutorial-next-btn');
    const tutorialSkipBtn = document.getElementById('tutorial-skip-btn');
    const tutorialBackBtn = document.getElementById('tutorial-back-btn');
    const tutorialCloseBtn = document.getElementById('tutorial-close-btn');
    
    const muteBtn = document.getElementById('mute-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const settingsTutorialBtn = document.getElementById('settings-tutorial-btn');
    const settingsAdsBtn = document.getElementById('settings-ads-btn');
    const nightModeToggle = document.getElementById('night-mode-toggle');
    const hapticToggle = document.getElementById('haptic-toggle');
    const levelDisplay = document.getElementById('level-display');
    const levelProgressFill = document.getElementById('level-progress-fill');
    const victoryModal = document.getElementById('victory-modal');
    const victoryNextBtn = document.getElementById('victory-next-btn');
    const victoryReplayBtn = document.getElementById('victory-replay-btn');
    const victoryShareBtn = document.getElementById('victory-share-btn');
    const victoryHomeBtn = document.getElementById('victory-home-btn');
    const victoryBonusBtn = document.getElementById('victory-bonus-btn');
    const victoryCloseBtn = document.getElementById('victory-close-btn');
    let completedPuzzleSnapshot = null;
    let bonusRewardClaimedForCurrentVictory = false;
let completionNavigationCountThisSession = 0;
let isCompletionNavigationInProgress = false;

const pencilBtn = document.getElementById('pencil-btn');

    // Home screen buttons
    const continueGameBtn = document.getElementById('continue-game-btn');
    const newGameHomeBtn = document.getElementById('new-game-home-btn');
    const dailyChallengeBtn = document.getElementById('daily-challenge-btn');
    const homeStatsBtn = document.getElementById('home-stats-btn');
    const achievementsBtn = document.getElementById('achievements-btn');
    const homeSettingsBtn = document.getElementById('home-settings-btn');
    const homeBackBtn = document.getElementById('home-back-btn');

    // Pause
    const gamePauseBtn = document.getElementById('game-pause-btn');
    const pauseModal = document.getElementById('pause-modal');
    const pauseResumeBtn = document.getElementById('pause-resume-btn');
    const pauseHomeBtn = document.getElementById('pause-home-btn');
    const pauseCloseBtn = document.getElementById('pause-close-btn');
    const pauseDiffText = document.getElementById('pause-diff-text');
    const pauseTimerText = document.getElementById('pause-timer-text');
    const pauseMistakesText = document.getElementById('pause-mistakes-text');

    // Placeholder modal
    const placeholderModal = document.getElementById('placeholder-modal');
    const placeholderModalTitle = document.getElementById('placeholder-modal-title');
    const placeholderModalMsg = document.getElementById('placeholder-modal-msg');
    const placeholderCloseBtn = document.getElementById('placeholder-close-btn');
    
    let selectedCell = null;
    let isPencilMode = false;
    let solvedGrid = [];
    let undoStack = [];
    const MAX_UNDOS = 3;
    const MAX_HINTS = (typeof AdMobConfig !== 'undefined' && AdMobConfig.STARTING_HINTS != null) ? AdMobConfig.STARTING_HINTS : 3;
    
    // Confetti instance setup
    const confettiCanvas = document.getElementById('confetti-canvas');
    const myConfetti = window.confetti ? window.confetti.create(confettiCanvas, {
        resize: true,
        useWorker: false // Force main thread
    }) : null;
    let undosRemaining = MAX_UNDOS;
let hintsRemaining = MAX_HINTS;
let isRewardedHintRequestInProgress = false;
    
    let mistakes = 0;
const MAX_MISTAKES = 3;
let mistakeRescueUsedThisGame = false;
let isMistakeRescueRequestInProgress = false;
    
    let timerInterval = null;
    let secondsElapsed = 0;

    let currentLevel = parseInt(localStorage.getItem('sudoku-level')) || 1;

    let isPaused = false;

    function updatePauseBtnUI(paused) {
        if (!gamePauseBtn) return;
        gamePauseBtn.innerHTML = `<span class="material-symbols-outlined">${paused ? 'play_arrow' : 'pause'}</span>`;
        gamePauseBtn.setAttribute('title', paused ? 'Resume Game' : 'Pause Game');
    }

    function pauseGame() {
        if (isPaused) return;
        isPaused = true;
        stopTimer();
        gameScreen.classList.add('paused');
        updatePauseBtnUI(true);

        if (pauseDiffText) {
            pauseDiffText.textContent = isDailyChallenge ? 'Daily' : (selectedDifficulty.charAt(0).toUpperCase() + selectedDifficulty.slice(1));
        }
        if (pauseTimerText && timerDisplay) {
            pauseTimerText.textContent = timerDisplay.textContent;
        }
        if (pauseMistakesText) {
            pauseMistakesText.textContent = `${mistakes}/${MAX_MISTAKES}`;
        }

        const isNativePauseEligible = !window.isPremium && typeof AdMobService !== 'undefined' && AdMobService.isFeatureEnabled('pause_native_ad_enabled');
        if (pauseModal) {
            if (isNativePauseEligible) {
                pauseModal.classList.add('has-native-ad');
            } else {
                pauseModal.classList.remove('has-native-ad');
            }
            pauseModal.classList.remove('hidden');
        }

        if (typeof AdMobService !== 'undefined') {
            AdMobService.showNativeAd('pause');
        }
    }

    function resumeGame() {
        if (!isPaused) return;
        isPaused = false;
        gameScreen.classList.remove('paused');
        updatePauseBtnUI(false);
        if (pauseModal) {
            pauseModal.classList.remove('has-native-ad');
            pauseModal.classList.add('hidden');
        }

        if (typeof AdMobService !== 'undefined') {
            AdMobService.hideNativeAd();
            if (!window.isPremium) {
                AdMobService.showGameplayAd();
            }
        }

        resumeTimer();
    }

    function updateLevelUI() {
        if (levelDisplay) {
            levelDisplay.textContent = `Level ${currentLevel}`;
        }
        if (levelProgressFill) {
            const progress = ((currentLevel - 1) % 5) * 20;
            levelProgressFill.style.width = `${progress}%`;
        }
    }

    let isHapticEnabled = localStorage.getItem('sudoku-haptic') !== 'false';
    let isNightMode = localStorage.getItem('sudoku-night-mode') === 'true';

    if (isNightMode) {
        document.documentElement.setAttribute('data-theme', 'dark');
        if (nightModeToggle) nightModeToggle.checked = true;
    }
    if (hapticToggle) hapticToggle.checked = isHapticEnabled;



    const tutorialSteps = [
        {
            title: 'The Standard Grid',
            text: 'Every row, column, and 3x3 grid must contain the numbers 1 to 9.',
            visualHtml: `
                <div class="tut-mini-grid">
                    <div class="tut-mini-cell">1</div>
                    <div class="tut-mini-cell">2</div>
                    <div class="tut-mini-cell highlight">3</div>
                    <div class="tut-mini-cell">4</div>
                    <div class="tut-mini-cell highlight">5</div>
                    <div class="tut-mini-cell">6</div>
                    <div class="tut-mini-cell highlight">7</div>
                    <div class="tut-mini-cell">8</div>
                    <div class="tut-mini-cell">9</div>
                </div>
            `
        },
        {
            title: 'No Repetitions',
            text: 'No number can repeat in the same row, column, or square.',
            visualHtml: `
                <div class="tut-mini-grid">
                    <div class="tut-mini-cell">4</div>
                    <div class="tut-mini-cell highlight">7</div>
                    <div class="tut-mini-cell">2</div>
                    <div class="tut-mini-cell">8</div>
                    <div class="tut-mini-cell error-cell">7</div>
                    <div class="tut-mini-cell">1</div>
                    <div class="tut-mini-cell">6</div>
                    <div class="tut-mini-cell">5</div>
                    <div class="tut-mini-cell">9</div>
                </div>
            `
        },
        {
            title: 'Simple Controls',
            text: 'Click a cell and type a number or use the number pad.',
            visualHtml: `
                <div class="tut-big-icon-wrap">
                    <div class="tut-big-icon-badge">
                        <span class="material-symbols-outlined">dialpad</span>
                    </div>
                </div>
            `
        },
        {
            title: 'Mistake Limits',
            text: 'Careful! 3 mistakes and it is Game Over.',
            visualHtml: `
                <div class="tut-big-icon-wrap">
                    <div class="tut-big-icon-badge danger-badge">
                        <span class="material-symbols-outlined">heart_broken</span>
                    </div>
                </div>
            `
        }
    ];
    let currentTutorialStep = 0;

    // --- Sound Engine ---
    const SoundEngine = {
        audioCtx: null,
        isMuted: localStorage.getItem('sudoku-muted') === 'true',
        
        init() {
            if (!this.audioCtx) {
                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
        },
        
        toggleMute() {
            this.isMuted = !this.isMuted;
            localStorage.setItem('sudoku-muted', this.isMuted);
            return this.isMuted;
        },

        playTone(frequency, type, duration, vol = 0.1) {
            if (this.isMuted) return;
            this.init();
            const osc = this.audioCtx.createOscillator();
            const gainNode = this.audioCtx.createGain();
            
            osc.type = type;
            osc.frequency.setValueAtTime(frequency, this.audioCtx.currentTime);
            
            gainNode.gain.setValueAtTime(vol, this.audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + duration);
            
            osc.connect(gainNode);
            gainNode.connect(this.audioCtx.destination);
            
            osc.start();
            osc.stop(this.audioCtx.currentTime + duration);
        },

        playPop() {
            this.playTone(600, 'sine', 0.1, 0.2);
        },
        
        playBuzz() {
            this.playTone(150, 'sawtooth', 0.3, 0.3);
        },
        
        playGameOver() {
            if (this.isMuted) return;
            this.init();
            const notes = [300, 250, 200, 150];
            notes.forEach((freq, i) => {
                setTimeout(() => this.playTone(freq, 'square', 0.3, 0.2), i * 300);
            });
        },
        
        playVictory() {
            if (this.isMuted) return;
            this.init();
            const notes = [400, 500, 600, 800];
            notes.forEach((freq, i) => {
                setTimeout(() => this.playTone(freq, 'sine', 0.2, 0.2), i * 150);
            });
        }
    };

    // --- Native Haptic Engine ---
    const HapticEngine = {
        isEnabled() {
            return !!isHapticEnabled;
        },
        light() {
            if (!this.isEnabled()) return;
            try {
                if (Haptics && typeof Haptics.impact === 'function') {
                    Haptics.impact({ style: 'LIGHT' }).catch(() => {});
                } else if (navigator.vibrate) {
                    navigator.vibrate(15);
                }
            } catch (e) {}
        },
        medium() {
            if (!this.isEnabled()) return;
            try {
                if (Haptics && typeof Haptics.impact === 'function') {
                    Haptics.impact({ style: 'MEDIUM' }).catch(() => {});
                } else if (navigator.vibrate) {
                    navigator.vibrate(30);
                }
            } catch (e) {}
        },
        warning() {
            if (!this.isEnabled()) return;
            try {
                if (Haptics && typeof Haptics.notification === 'function') {
                    Haptics.notification({ type: 'WARNING' }).catch(() => {});
                } else if (navigator.vibrate) {
                    navigator.vibrate([40, 60, 80]);
                }
            } catch (e) {}
        },
        success() {
            if (!this.isEnabled()) return;
            try {
                if (Haptics && typeof Haptics.notification === 'function') {
                    Haptics.notification({ type: 'SUCCESS' }).catch(() => {});
                } else if (navigator.vibrate) {
                    navigator.vibrate([30, 40, 60]);
                }
            } catch (e) {}
        },
        selection() {
            if (!this.isEnabled()) return;
            try {
                if (Haptics && typeof Haptics.selectionChanged === 'function') {
                    Haptics.selectionChanged().catch(() => {});
                } else if (navigator.vibrate) {
                    navigator.vibrate(10);
                }
            } catch (e) {}
        }
    };

    // --- Stats Engine ---
    const StatsEngine = {
        stats: {
            gamesPlayed: 0,
            gamesWon: 0,
            currentStreak: 0,
            bestStreak: 0,
            bestTime: Infinity,
            totalMistakes: 0
        },

        init() {
            const saved = localStorage.getItem('sudoku-stats');
            if (saved) {
                this.stats = JSON.parse(saved);
            }
        },

        save() {
            localStorage.setItem('sudoku-stats', JSON.stringify(this.stats));
            this.updateUI();
        },

        recordGameStarted(level) {
            if (level > 1) { // Skip tutorial level
                this.stats.gamesPlayed++;
                this.save();
            }
        },

        recordWin(level, timeSeconds) {
            let isNewBest = false;
            if (level > 1) {
                this.stats.gamesWon++;
                this.stats.currentStreak++;
                if (this.stats.currentStreak > this.stats.bestStreak) {
                    this.stats.bestStreak = this.stats.currentStreak;
                }
                if (timeSeconds < this.stats.bestTime) {
                    this.stats.bestTime = timeSeconds;
                    isNewBest = true;
                }
                this.save();
            }
            return isNewBest;
        },

        recordGameOver() {
            this.stats.currentStreak = 0;
            this.save();
        },

        recordMistake() {
            this.stats.totalMistakes++;
            this.save();
        },

        formatTime(totalSeconds) {
            if (totalSeconds === Infinity) return '--:--';
            const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
            const secs = (totalSeconds % 60).toString().padStart(2, '0');
            return `${mins}:${secs}`;
        },

        reset() {
            this.stats = {
                gamesPlayed: 0,
                gamesWon: 0,
                currentStreak: 0,
                bestStreak: 0,
                bestTime: Infinity,
                totalMistakes: 0
            };
            this.save();
        },

        updateUI() {
            if (!statGamesPlayed) return; // UI might not be loaded
            statGamesPlayed.textContent = this.stats.gamesPlayed;
            statGamesWon.textContent = this.stats.gamesWon;
            
            const winRate = this.stats.gamesPlayed > 0 
                ? Math.round((this.stats.gamesWon / this.stats.gamesPlayed) * 100) 
                : 0;
            statWinRate.textContent = `${winRate}%`;
            
            statCurrentStreak.textContent = this.stats.currentStreak;
            statBestStreak.textContent = this.stats.bestStreak;
            statBestTime.textContent = this.formatTime(this.stats.bestTime);
            statTotalMistakes.textContent = this.stats.totalMistakes;
        }
    };
    StatsEngine.init();

    // Initialize Mute UI
    function updateMuteBtnUI(muted) {
        if (!muteBtn) return;
        muteBtn.innerHTML = `<span class="material-symbols-outlined">${muted ? 'volume_off' : 'volume_up'}</span>`;
        muteBtn.setAttribute('title', muted ? 'Unmute Sound' : 'Mute Sound');
    }
    updateMuteBtnUI(SoundEngine.isMuted);
    muteBtn.addEventListener('click', () => {
        const muted = SoundEngine.toggleMute();
        updateMuteBtnUI(muted);
    });

    // --- Grid Setup ---
    for (let i = 0; i < 81; i++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.dataset.index = i;

        const row = Math.floor(i / 9);
        const col = i % 9;
        
        if (col === 2 || col === 5) cell.classList.add('border-r');
        if (row === 2 || row === 5) cell.classList.add('border-b');

        cell.addEventListener('mousedown', () => selectCell(cell));
        board.appendChild(cell);
    }

    // --- Numpad Setup ---
    const numpadValues = ['1', '2', '3', '4', '5', '6', '7', '8', '9']; // X removed
    numpadValues.forEach(val => {
        const btn = document.createElement('button');
        btn.classList.add('numpad-btn');
        btn.textContent = val;
        btn.addEventListener('click', () => {
            if (!selectedCell || selectedCell.classList.contains('prefilled')) return;
            setCellValue(selectedCell, val === 'X' ? '' : val);
        });
        numpad.appendChild(btn);
    });

    if (eraseBtn) {
        eraseBtn.addEventListener('click', () => {
            if (!selectedCell || selectedCell.classList.contains('prefilled') || selectedCell.classList.contains('locked-group')) return;
            setCellValue(selectedCell, '');
        });
    }

    if (pencilBtn) {
        pencilBtn.addEventListener('click', () => {
            isPencilMode = !isPencilMode;
            pencilBtn.classList.toggle('active', isPencilMode);
            HapticEngine.light();
        });
    }

    // --- Events ---
    document.addEventListener('mousedown', (e) => {
        if (!e.target.closest('#sudoku-board') && 
            !e.target.closest('#numpad') && 
            !e.target.closest('.controls')) {
            if (selectedCell) {
                selectedCell.classList.remove('selected');
                selectedCell = null;
                Array.from(board.children).forEach(c => c.classList.remove('crosshair', 'matching-number'));
            }
        }
    });

    document.addEventListener('keydown', (e) => {
        if (!selectedCell || selectedCell.classList.contains('prefilled')) return;

        const key = e.key;
        if (/^[1-9]$/.test(key)) {
            setCellValue(selectedCell, key);
        } else if (key === 'Backspace' || key === 'Delete') {
            setCellValue(selectedCell, '');
        } else if (key.startsWith('Arrow')) {
            e.preventDefault();
            navigate(key);
        }
    });

    undoBtn.addEventListener('click', performUndo);
    newGameBtn.addEventListener('click', async () => {
        if (newGameBtn.disabled) return;
        newGameBtn.disabled = true;
        try {
            if (typeof AdMobService !== "undefined") {
                await AdMobService.showNewGameInterstitialAd();
            }
            startNewGame();
            saveGameState();
        } finally {
            newGameBtn.disabled = false;
        }
    });
    hintBtn.addEventListener('click', giveHint);
    if (autoCheckBtn) {
        autoCheckBtn.addEventListener('click', handleAutoCheck);
    }
    tryAgainBtn.addEventListener('click', tryAgain);
    restartGameBtn.addEventListener('click', restartGame);
if (rewardAdCancel) {
    rewardAdCancel.addEventListener('click', () => closeRewardAdModal(false));
}

if (rewardAdConfirm) {
    rewardAdConfirm.addEventListener('click', () => closeRewardAdModal(true));
}
    async function runCompletionNavigationWithAd(navigateAfterAd) {
        if (isCompletionNavigationInProgress) return;

        isCompletionNavigationInProgress = true;

        if (victoryNextBtn) victoryNextBtn.disabled = true;
        if (victoryHomeBtn) victoryHomeBtn.disabled = true;

        if (typeof AdMobService !== 'undefined') {
            AdMobService.hideNativeAd();
        }
        if (victoryModal) victoryModal.classList.remove('has-native-ad');

        try {
            if (typeof ReviewPromptManager !== 'undefined') {
                await ReviewPromptManager.handleVictoryAction();
            }

            completionNavigationCountThisSession++;

            const everyN = (typeof AdMobConfig !== 'undefined' && AdMobConfig.REMOTE && AdMobConfig.REMOTE.completion_interstitial_every != null)
                ? Number(AdMobConfig.REMOTE.completion_interstitial_every)
                : 1;

            if (typeof AdMobService !== "undefined" && completionNavigationCountThisSession % everyN === 0) {
                await AdMobService.showCompletionInterstitialAd();
            }

            navigateAfterAd();
        } catch (error) {
            console.error("Completion navigation failed:", error);
            navigateAfterAd();
        } finally {
            isCompletionNavigationInProgress = false;

            if (victoryNextBtn) victoryNextBtn.disabled = false;
            if (victoryHomeBtn) victoryHomeBtn.disabled = false;
        }
    }
    if (victoryNextBtn) {
    victoryNextBtn.addEventListener('click', () => {
        runCompletionNavigationWithAd(() => {
            victoryModal.classList.add('hidden');

            if (completedPuzzleSnapshot && completedPuzzleSnapshot.isDailyChallenge) {
                showView('home');
            } else {
                startNewGame();
                saveGameState();
            }
        });
    });
}

    if (victoryReplayBtn) {
        victoryReplayBtn.addEventListener('click', async () => {
            if (typeof AdMobService !== 'undefined') {
                AdMobService.hideNativeAd();
            }
            if (victoryModal) victoryModal.classList.remove('has-native-ad');
            victoryModal.classList.add('hidden');

            if (typeof ReviewPromptManager !== 'undefined') {
                await ReviewPromptManager.handleVictoryAction();
            }

            if (completedPuzzleSnapshot) {
                // Clear active play state
                isPaused = false;
                undoStack = [];
                undosRemaining = MAX_UNDOS;
                hintsRemaining = MAX_HINTS;
                mistakes = 0;
                mistakesThisGame = 0;
                hintsUsedThisGame = 0;
                
                updateMistakeUI();
                updateUndoUI();
                updateHintUI();
                
                if (selectedCell) {
                    selectedCell.classList.remove('selected');
                    selectedCell = null;
                }

                // Restore original grid
                const cells = Array.from(board.children);
                cells.forEach(c => {
                    c.textContent = '';
                    c.dataset.value = '';
                    c.dataset.notes = '';
                    c.classList.remove('prefilled', 'user-input', 'error', 'crosshair', 'tutorial-highlight', 'tutorial-dim', 'locked-group');
                });
                
                const origGrid = completedPuzzleSnapshot.originalGrid;
                for (let i = 0; i < 81; i++) {
                    if (origGrid[i] !== 0) {
                        cells[i].textContent = origGrid[i];
                        cells[i].dataset.value = origGrid[i].toString();
                        cells[i].classList.add('prefilled');
                    }
                }
                
                // Allow user to clear completedPuzzleSnapshot.recorded on next win
                // Wait, if they replay they should be able to win and not get stats again.
                // We keep recorded=true in the snapshot, which prevents checkWinCondition from double counting.
                
                startTimer();
                saveGameState();
            }
        });
    }
    if (victoryBonusBtn) {
    victoryBonusBtn.addEventListener('click', async () => {
        if (bonusRewardClaimedForCurrentVictory) return;

        const wantsBonus = await showRewardAdModal({
            icon: "🎁",
            title: "Claim Bonus Hint",
            message: "Watch a short ad to get +1 extra hint for your next puzzle.",
            confirmText: "Watch Ad",
            cancelText: "Not Now"
        });

        if (!wantsBonus) return;

        if (typeof AdMobService === "undefined") {
            console.warn("Bonus Rewarded unavailable: AdMobService is not loaded.");
            return;
        }

        victoryBonusBtn.disabled = true;
        victoryBonusBtn.textContent = "Loading Bonus...";

        const rewardEarned = await AdMobService.showBonusRewardedAd();

        if (rewardEarned) {
            bonusRewardClaimedForCurrentVictory = true;
            setPendingBonusHints(getPendingBonusHints() + 1);

            victoryBonusBtn.textContent = "✅ Bonus Hint Claimed";
            victoryBonusBtn.disabled = true;
        } else {
            victoryBonusBtn.textContent = "🎁 Claim Bonus Hint";
            victoryBonusBtn.disabled = false;
        }
    });
}
    if (victoryShareBtn) {
        victoryShareBtn.addEventListener('click', async () => {
            if (!completedPuzzleSnapshot) return;
            const diff = completedPuzzleSnapshot.isDailyChallenge ? 'Daily Challenge' : completedPuzzleSnapshot.difficulty;
            const timeStr = document.getElementById('victory-time')?.textContent || 'record time';
            const text = `I just solved a ${diff} puzzle in Sudoku Pro in ${timeStr}!`;
            try {
                if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
                    await window.Capacitor.Plugins.Share.share({
                        title: 'Sudoku Pro',
                        text: text,
                        dialogTitle: 'Share your victory'
                    });
                } else if (navigator.share) {
                    await navigator.share({
                        title: 'Sudoku Pro',
                        text: text
                    });
                }
            } catch (err) {
                console.log('Share canceled or failed', err);
            }
        });
    }

    if (victoryHomeBtn) {
        victoryHomeBtn.addEventListener('click', () => {
            runCompletionNavigationWithAd(() => {
                victoryModal.classList.add('hidden');
                showView('home');
            });
        });
    }

    if (victoryCloseBtn) {
        victoryCloseBtn.addEventListener('click', () => {
            runCompletionNavigationWithAd(() => {
                victoryModal.classList.add('hidden');
                showView('home');
            });
        });
    }

    // Settings logic
    function updatePrivacyChoicesVisibility() {
        const btn = document.getElementById('settings-privacy-choices-btn');
        const divider = document.getElementById('settings-privacy-choices-divider');
        if (!btn) return;
        const required = typeof AdMobService !== 'undefined' && AdMobService.isPrivacyOptionsRequired();
        if (required) {
            btn.style.display = 'flex';
            if (divider) divider.style.display = 'block';
        } else {
            btn.style.display = 'none';
            if (divider) divider.style.display = 'none';
        }
    }

    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            ThemeEngine.updateSettingsUI();
            updatePrivacyChoicesVisibility();
            settingsModal.classList.remove('hidden');
            if (!window.isPremium && typeof AdMobService !== 'undefined') AdMobService.prepareRewarded('THEME_UNLOCK');
            if (typeof AdMobService !== 'undefined') AdMobService.hideNativeAd();
        });
    }

    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => {
            settingsModal.classList.add('hidden');
            if (typeof AdMobService !== 'undefined') {
                AdMobService.disposeRewarded('THEME_UNLOCK', 'OPPORTUNITY_LEFT');
            }
            if (!homeScreen.classList.contains('hidden-view') && typeof AdMobService !== 'undefined') {
                AdMobService.showNativeAd('home');
            }
        });
    }

    if (settingsTutorialBtn) {
        settingsTutorialBtn.addEventListener('click', () => {
            settingsModal.classList.add('hidden');
            showTutorial();
        });
    }

    if (settingsAdsBtn) {
        settingsAdsBtn.addEventListener('click', () => {
            if (window.isPremium) return;
            
            let Billing = null;
            if (window.Capacitor && window.Capacitor.registerPlugin) {
                Billing = window.Capacitor.registerPlugin('Billing');
            } else if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Billing) {
                Billing = window.Capacitor.Plugins.Billing;
            }

            if (Billing) {
                if (typeof AdMobService !== 'undefined') {
                    AdMobService.hideNativeAd();
                    AdMobService.setPurchaseActive(true);
                }
                Billing.purchaseRemoveAds().catch(e => {
                    console.warn("Purchase error", e);
                    if (typeof AdMobService !== 'undefined') {
                        AdMobService.setPurchaseActive(false);
                    }
                    alert("Purchase error: " + (e.message || JSON.stringify(e)));
                }).finally(() => {
                    setTimeout(() => {
                        if (typeof AdMobService !== 'undefined') {
                            AdMobService.setPurchaseActive(false);
                        }
                    }, 500);
                });
                trackEvent('remove_ads_clicked');
            } else {
                alert('Billing is not available on this platform. (Plugin not registered)');
            }
        });
    }

    const settingsPrivacyChoicesBtn = document.getElementById('settings-privacy-choices-btn');
    if (settingsPrivacyChoicesBtn) {
        settingsPrivacyChoicesBtn.addEventListener('click', async () => {
            if (typeof AdMobService !== 'undefined') {
                try {
                    const res = await AdMobService.showPrivacyOptions();
                    console.log("[Settings] Privacy choices completed:", res);
                    updatePrivacyChoicesVisibility();
                } catch (e) {
                    console.error("[Settings] Error opening privacy choices:", e);
                }
            }
        });
    }

    // ═══════════════════════════════════════════════
    //  THEME ENGINE (Classic, Night, Wood, Cyberpunk)
    // ═══════════════════════════════════════════════

    const ThemeEngine = {
        THEMES: {
            classic: { id: 'classic', name: 'Classic', free: true },
            dark: { id: 'dark', name: 'Night', free: true },
            wood: { id: 'wood', name: 'Zen Wood', free: false },
            cyberpunk: { id: 'cyberpunk', name: 'Cyber Neon', free: false }
        },

        getUnlocks() {
            try {
                return JSON.parse(localStorage.getItem('sudoku-theme-unlocks') || '{}');
            } catch (e) {
                return {};
            }
        },

        saveUnlocks(unlocks) {
            try {
                localStorage.setItem('sudoku-theme-unlocks', JSON.stringify(unlocks));
            } catch (e) {}
        },

        isThemeUnlocked(themeId) {
            const def = this.THEMES[themeId];
            if (!def) return false;
            if (def.free) return true;
            if (window.isPremium) return true;

            const unlocks = this.getUnlocks();
            const expiry = unlocks[themeId];
            if (expiry && typeof expiry === 'number' && expiry > Date.now()) {
                return true;
            }
            return false;
        },

        getRemainingTimeFormatted(themeId) {
            if (window.isPremium || (this.THEMES[themeId] && this.THEMES[themeId].free)) {
                return 'Unlocked';
            }
            const unlocks = this.getUnlocks();
            const expiry = unlocks[themeId];
            if (!expiry || expiry <= Date.now()) return null;
            const diffMs = expiry - Date.now();
            const diffHours = Math.ceil(diffMs / (3600 * 1000));
            if (diffHours >= 1) {
                return `${diffHours}h left`;
            }
            const diffMinutes = Math.max(1, Math.ceil(diffMs / (60 * 1000)));
            return `${diffMinutes}m left`;
        },

        cleanExpired() {
            const unlocks = this.getUnlocks();
            let changed = false;
            const now = Date.now();
            for (const id in unlocks) {
                if (unlocks[id] <= now) {
                    delete unlocks[id];
                    changed = true;
                    trackEvent('theme_unlock_expired', { theme_id: id });
                }
            }
            if (changed) {
                this.saveUnlocks(unlocks);
            }

            // Fallback: if current active theme expired and is now locked, revert safely
            const currentTheme = localStorage.getItem('sudoku-selected-theme') || (isNightMode ? 'dark' : 'classic');
            if (!this.isThemeUnlocked(currentTheme)) {
                console.log(`[ThemeEngine] Active theme "${currentTheme}" expired. Reverting to free default.`);
                const fallback = isNightMode ? 'dark' : 'classic';
                this.applyTheme(fallback, true);
            }
        },

        applyTheme(themeId, skipLockCheck = false) {
            if (!skipLockCheck && !this.isThemeUnlocked(themeId)) {
                this.promptUnlock(themeId);
                return;
            }

            const theme = this.THEMES[themeId] ? themeId : 'classic';
            localStorage.setItem('sudoku-selected-theme', theme);

            if (theme === 'classic') {
                document.documentElement.removeAttribute('data-theme');
                isNightMode = false;
                localStorage.setItem('sudoku-night-mode', false);
                if (nightModeToggle) nightModeToggle.checked = false;
            } else if (theme === 'dark') {
                document.documentElement.setAttribute('data-theme', 'dark');
                isNightMode = true;
                localStorage.setItem('sudoku-night-mode', true);
                if (nightModeToggle) nightModeToggle.checked = true;
            } else {
                document.documentElement.setAttribute('data-theme', theme);
                isNightMode = false;
                if (nightModeToggle) nightModeToggle.checked = false;
            }

            this.updateSettingsUI();
        },

        async promptUnlock(themeId) {
            const def = this.THEMES[themeId];
            if (!def) return;

            trackEvent('theme_unlock_tapped', { theme_id: themeId });

            const isRewardEnabled = typeof AdMobService !== 'undefined'
                ? AdMobService.isFeatureEnabled('theme_rewarded_unlock_enabled')
                : true;

            if (!isRewardEnabled) {
                showToast(`${def.name} theme requires Sudoku Pro membership.`);
                return;
            }

            const durationHours = typeof AdMobService !== 'undefined'
                ? Number(AdMobService.getRemoteValue('theme_unlock_duration_hours', 24))
                : 24;

            const confirmed = await showRewardAdModal({
                icon: "palette",
                title: `Unlock ${def.name}`,
                message: `Watch a short sponsor video to unlock the ${def.name} theme for ${durationHours} hours!`,
                confirmText: "Watch Ad & Unlock",
                cancelText: "Not Now"
            });

            if (!confirmed) {
                return;
            }

            trackEvent('theme_unlock_ad_started', { theme_id: themeId });

            let rewarded = false;
            if (window.isPremium) {
                rewarded = true;
            } else if (typeof AdMobService !== 'undefined') {
                rewarded = await AdMobService.showThemeUnlockRewardedAd(themeId);
            } else {
                rewarded = true;
            }

            if (rewarded) {
                const unlocks = this.getUnlocks();
                unlocks[themeId] = Date.now() + (durationHours * 3600 * 1000);
                this.saveUnlocks(unlocks);

                trackEvent('theme_unlock_reward_earned', { theme_id: themeId });
                trackEvent('theme_unlock_granted', { theme_id: themeId, duration_hours: durationHours });

                this.applyTheme(themeId, true);
                showToast(`${def.name} theme unlocked for ${durationHours} hours!`);
            } else {
                trackEvent('theme_unlock_failed', { theme_id: themeId });
                showToast('Ad was not completed. Theme remains locked.');
            }
        },

        updateSettingsUI() {
            const currentTheme = localStorage.getItem('sudoku-selected-theme') || (isNightMode ? 'dark' : 'classic');
            const cards = document.querySelectorAll('.theme-option-card');
            cards.forEach(card => {
                const id = card.getAttribute('data-theme-id');
                if (!id) return;

                if (id === currentTheme) {
                    card.classList.add('active');
                } else {
                    card.classList.remove('active');
                }

                const statusEl = card.querySelector('.theme-option-status');
                if (statusEl) {
                    const def = this.THEMES[id];
                    if (def && def.free) {
                        statusEl.className = 'theme-option-status free';
                        statusEl.innerHTML = id === currentTheme ? 'Active' : 'Included';
                    } else if (window.isPremium) {
                        statusEl.className = 'theme-option-status free';
                        statusEl.innerHTML = id === currentTheme ? 'Active' : 'Premium';
                    } else {
                        const remaining = this.getRemainingTimeFormatted(id);
                        if (remaining) {
                            statusEl.className = 'theme-option-status active-unlock';
                            statusEl.innerHTML = `<span class="material-symbols-outlined theme-lock-icon">schedule</span> ${remaining}`;
                        } else {
                            statusEl.className = 'theme-option-status locked';
                            statusEl.innerHTML = `<span class="material-symbols-outlined theme-lock-icon">lock</span> Unlock 24h`;
                        }
                    }
                }
            });
        },

        init() {
            this.cleanExpired();
            const savedTheme = localStorage.getItem('sudoku-selected-theme') || (isNightMode ? 'dark' : 'classic');
            if (this.isThemeUnlocked(savedTheme)) {
                this.applyTheme(savedTheme, true);
            } else {
                this.applyTheme('classic', true);
            }

            // Wire theme cards click
            const cards = document.querySelectorAll('.theme-option-card');
            cards.forEach(card => {
                card.addEventListener('click', () => {
                    const id = card.getAttribute('data-theme-id');
                    if (id) {
                        this.applyTheme(id);
                    }
                });
            });

            this.updateSettingsUI();
        }
    };

    if (nightModeToggle) {
        nightModeToggle.addEventListener('change', (e) => {
            isNightMode = e.target.checked;
            if (isNightMode) {
                ThemeEngine.applyTheme('dark', true);
            } else {
                ThemeEngine.applyTheme('classic', true);
            }
        });
    }

    if (hapticToggle) {
        hapticToggle.addEventListener('change', (e) => {
            isHapticEnabled = e.target.checked;
            localStorage.setItem('sudoku-haptic', isHapticEnabled);
            if (isHapticEnabled) HapticEngine.selection();
        });
    }

    // --- Stats Modal Events ---
    if (statsBtn) {
        statsBtn.addEventListener('click', () => {
            StatsEngine.updateUI();
            statsModal.classList.remove('hidden');
        });
    }

    if (closeStatsBtn) {
        closeStatsBtn.addEventListener('click', () => {
            statsModal.classList.add('hidden');
        });
    }

    if (resetStatsBtn) {
        resetStatsBtn.addEventListener('click', () => {
            if (confirm("Are you sure you want to reset all statistics? This cannot be undone.")) {
                StatsEngine.reset();
            }
        });
    }

    // --- Consent Modal Logic ---
    if (!localStorage.getItem('sudoku-consent-accepted')) {
        consentModal.classList.remove('hidden');
    }

    consentAcceptBtn.addEventListener('click', () => {
        localStorage.setItem('sudoku-consent-accepted', 'true');
        consentModal.classList.add('hidden');
        if (!localStorage.getItem('sudoku-tutorial-seen')) {
            showTutorial();
            localStorage.setItem('sudoku-tutorial-seen', 'true');
        }
    });

    if (tutorialNextBtn) tutorialNextBtn.addEventListener('click', nextTutorialStep);
    if (tutorialBackBtn) tutorialBackBtn.addEventListener('click', prevTutorialStep);
    if (tutorialSkipBtn) tutorialSkipBtn.addEventListener('click', () => tutorialModal.classList.add('hidden'));
    if (tutorialCloseBtn) tutorialCloseBtn.addEventListener('click', () => tutorialModal.classList.add('hidden'));

    function showTutorial() {
        currentTutorialStep = 0;
        updateTutorialUI();
        tutorialModal.classList.remove('hidden');
    }

    function nextTutorialStep() {
        if (currentTutorialStep < tutorialSteps.length - 1) {
            currentTutorialStep++;
            updateTutorialUI();
        } else {
            tutorialModal.classList.add('hidden');
        }
    }

    function prevTutorialStep() {
        if (currentTutorialStep > 0) {
            currentTutorialStep--;
            updateTutorialUI();
        }
    }

    function updateTutorialUI() {
        const step = tutorialSteps[currentTutorialStep];
        if (!step) return;

        if (tutorialVisual) tutorialVisual.innerHTML = step.visualHtml;
        if (tutorialStepTitle) tutorialStepTitle.textContent = step.title;
        if (tutorialText) tutorialText.textContent = step.text;
        if (tutorialStepIndicator) tutorialStepIndicator.textContent = `${currentTutorialStep + 1} of ${tutorialSteps.length}`;
        
        if (tutorialDotsWrap) {
            const dots = tutorialDotsWrap.querySelectorAll('.tut-dot');
            dots.forEach((dot, idx) => {
                dot.classList.toggle('active', idx === currentTutorialStep);
            });
        }

        if (tutorialBackBtn) {
            tutorialBackBtn.disabled = (currentTutorialStep === 0);
            tutorialBackBtn.style.visibility = (currentTutorialStep === 0) ? 'hidden' : 'visible';
        }

        if (currentTutorialStep === tutorialSteps.length - 1) {
            if (tutorialNextBtn) tutorialNextBtn.textContent = 'Start Playing';
            if (tutorialSkipBtn) tutorialSkipBtn.style.display = 'none';
        } else {
            if (tutorialNextBtn) tutorialNextBtn.textContent = 'Next';
            if (tutorialSkipBtn) tutorialSkipBtn.style.display = 'inline-flex';
        }
    }
    function getPendingBonusHints() {
    return parseInt(localStorage.getItem('sudoku-pending-bonus-hints') || '0', 10);
}

function setPendingBonusHints(value) {
    localStorage.setItem('sudoku-pending-bonus-hints', Math.max(0, value).toString());
}

function applyPendingBonusHintsForNewPuzzle() {
    const pendingBonusHints = getPendingBonusHints();

    if (pendingBonusHints <= 0) {
        return;
    }

    hintsRemaining += pendingBonusHints;
    setPendingBonusHints(0);

    console.log(`Applied ${pendingBonusHints} bonus hint(s) to this puzzle.`);
}
    function showRewardAdModal({ icon, title, message, confirmText, cancelText, noteText }) {
    return new Promise((resolve) => {
        if (window.isPremium) {
            resolve(true);
            return;
        }
        if (!rewardAdModal || !rewardAdConfirm || !rewardAdCancel) {
            resolve(false);
            return;
        }

        rewardAdModalResolve = resolve;

        if (rewardAdIcon) rewardAdIcon.textContent = icon;
        if (rewardAdTitle) rewardAdTitle.textContent = title;
        if (rewardAdMessage) rewardAdMessage.textContent = message;

        const confirmTextEl = document.getElementById('reward-ad-confirm-text');
        if (confirmTextEl) {
            confirmTextEl.textContent = confirmText || "Watch Ad";
        } else if (rewardAdConfirm) {
            rewardAdConfirm.textContent = confirmText || "Watch Ad";
        }

        if (rewardAdCancel) rewardAdCancel.textContent = cancelText || "Not Now";

        const noteEl = document.getElementById('reward-ad-note');
        const noteTextEl = document.getElementById('reward-ad-note-text');
        if (noteText) {
            if (noteTextEl) noteTextEl.textContent = noteText;
            if (noteEl) noteEl.style.display = 'flex';
        } else if (title && title.includes('Home')) {
            if (noteEl) noteEl.style.display = 'none';
        } else {
            if (noteTextEl) noteTextEl.textContent = "Instant return to board • 15–30 sec sponsor clip";
            if (noteEl) noteEl.style.display = 'flex';
        }

        rewardAdModal.classList.remove('hidden');
    });
}

function closeRewardAdModal(result) {
    if (rewardAdModal) rewardAdModal.classList.add('hidden');

    if (rewardAdModalResolve) {
        rewardAdModalResolve(result);
        rewardAdModalResolve = null;
    }
}
async function tryAgain() {
    console.log("[GameOverAction] Player tapped 'Try Again' (Reset Grid).");
    if (isGameOverNavigationInProgress) {
        console.warn("[GameOverAction] Navigation already in progress. Ignoring duplicate tap.");
        return;
    }
    isGameOverNavigationInProgress = true;
    if (tryAgainBtn) tryAgainBtn.disabled = true;
    if (restartGameBtn) restartGameBtn.disabled = true;

    try {
        if (typeof AdMobService !== 'undefined') {
            await AdMobService.showGameOverInterstitialAd({ action: 'try_again' });
        }
    } catch (e) {
        console.warn('[GameOverAction] Game Over interstitial error:', e);
    } finally {
        isGameOverNavigationInProgress = false;
        if (tryAgainBtn) tryAgainBtn.disabled = false;
        if (restartGameBtn) restartGameBtn.disabled = false;

        gameOverModal.classList.add('hidden');
        mistakes = 0;
        updateMistakeUI();
        
        // Clear all user inputs
        const cells = Array.from(board.children);
        cells.forEach(c => {
            if (!c.classList.contains('prefilled')) {
                c.textContent = '';
                c.dataset.value = '';
                c.dataset.notes = '';
                c.classList.remove('user-input', 'error', 'locked-group');
            }
        });
        
        undoStack = [];
        undosRemaining = MAX_UNDOS;
        updateUndoUI();
        hintsRemaining = MAX_HINTS;
        updateHintUI();
        
        startTimer();
        saveGameState();
    }
}

async function restartGame() {
    console.log("[GameOverAction] Player tapped 'New Game' from Game Over screen.");
    if (isGameOverNavigationInProgress) {
        console.warn("[GameOverAction] Navigation already in progress. Ignoring duplicate tap.");
        return;
    }
    isGameOverNavigationInProgress = true;
    if (tryAgainBtn) tryAgainBtn.disabled = true;
    if (restartGameBtn) restartGameBtn.disabled = true;

    try {
        if (typeof AdMobService !== 'undefined') {
            await AdMobService.showGameOverInterstitialAd({ action: 'new_game' });
        }
    } catch (e) {
        console.warn('[GameOverAction] Game Over interstitial error:', e);
    } finally {
        isGameOverNavigationInProgress = false;
        if (tryAgainBtn) tryAgainBtn.disabled = false;
        if (restartGameBtn) restartGameBtn.disabled = false;

        gameOverModal.classList.add('hidden');
        startNewGame();
        saveGameState();
    }
}

    function selectCell(cell) {
        clearAutoCheckHighlights();
        if (cell.classList.contains('locked-group') || cell.classList.contains('prefilled')) {
            cell.classList.remove('locked-pulse');
            void cell.offsetWidth; // Trigger reflow for animation
            cell.classList.add('locked-pulse');
            // Allow selection to continue so users can still see crosshairs
        }

        if (selectedCell !== cell) {
            HapticEngine.selection();
        }

        if (selectedCell) {
            selectedCell.classList.remove('selected');
        }
        
        // Remove old crosshairs and matching numbers
        Array.from(board.children).forEach(c => {
            c.classList.remove('crosshair', 'matching-number');
        });

        selectedCell = cell;
        selectedCell.classList.add('selected');
        
        // Add new crosshairs and matching numbers
        const index = parseInt(cell.dataset.index);
        const row = Math.floor(index / 9);
        const col = index % 9;
        const boxRow = Math.floor(row / 3);
        const boxCol = Math.floor(col / 3);
        const cellVal = cell.dataset.value;
        
        Array.from(board.children).forEach((c, i) => {
            if (i === index) return;
            const r = Math.floor(i / 9);
            const cCol = i % 9;
            const bRow = Math.floor(r / 3);
            const bCol = Math.floor(cCol / 3);

            // Peer highlighting: same row, same column, or same 3x3 block
            if (r === row || cCol === col || (bRow === boxRow && bCol === boxCol)) {
                c.classList.add('crosshair');
            }

            // Matching number highlighting across the entire board
            if (cellVal && String(cellVal).trim() !== '' && c.dataset.value === cellVal) {
                c.classList.add('matching-number');
            }
        });
    }

    function renderNotes(cell) {
        const notesStr = cell.dataset.notes || '';
        const notes = notesStr.split(',').filter(n => n);
        
        let html = '<div class="notes-grid">';
        for (let i = 1; i <= 9; i++) {
            if (notes.includes(i.toString())) {
                html += `<div class="note-cell">${i}</div>`;
            } else {
                html += `<div class="note-cell"></div>`;
            }
        }
        html += '</div>';
        cell.innerHTML = html;
    }

    function autoCleanupNotes(placedIndexStr, placedValue) {
        const placedIndex = parseInt(placedIndexStr);
        const pRow = Math.floor(placedIndex / 9);
        const pCol = placedIndex % 9;
        const pBlockRow = Math.floor(pRow / 3);
        const pBlockCol = Math.floor(pCol / 3);

        const cells = Array.from(board.children);
        cells.forEach((cell, i) => {
            if (i === placedIndex) return;
            if (cell.classList.contains('user-input') || cell.classList.contains('prefilled')) return;
            
            const r = Math.floor(i / 9);
            const c = i % 9;
            const bRow = Math.floor(r / 3);
            const bCol = Math.floor(c / 3);
            
            if (r === pRow || c === pCol || (bRow === pBlockRow && bCol === pBlockCol)) {
                if (cell.dataset.notes) {
                    let notes = cell.dataset.notes.split(',').filter(n => n);
                    if (notes.includes(placedValue)) {
                        notes = notes.filter(n => n !== placedValue);
                        cell.dataset.notes = notes.join(',');
                        if (notes.length === 0) {
                            cell.innerHTML = '';
                            cell.dataset.notes = '';
                        } else {
                            renderNotes(cell);
                        }
                    }
                }
            }
        });
    }

    function setCellValue(cell, value) {
        if (cell.classList.contains('locked-group') || cell.classList.contains('prefilled')) {
            cell.classList.remove('locked-pulse');
            void cell.offsetWidth;
            cell.classList.add('locked-pulse');
            return;
        }

        const currentValue = cell.dataset.value || (cell.classList.contains('user-input') ? cell.textContent : '');
        const currentNotes = cell.dataset.notes || '';
        
        if (!isPencilMode && currentValue === value && value !== '') return;

        // Eraser
        if (value === '') {
            if (undosRemaining > 0) {
                undoStack.push({ cell, prevValue: currentValue, prevNotes: currentNotes });
                updateUndoUI();
            }
            cell.dataset.value = '';
            cell.dataset.notes = '';
            cell.textContent = '';
            cell.classList.remove('user-input');
            SoundEngine.playPop();
            HapticEngine.medium();
            validateBoard();
            if (selectedCell === cell) selectCell(cell);
            saveGameState();
            return;
        }

        if (isPencilMode) {
            // Pencil Mode
            if (cell.classList.contains('user-input') || cell.classList.contains('prefilled')) return; // Can't add notes to filled cell
            
            if (undosRemaining > 0) {
                undoStack.push({ cell, prevValue: currentValue, prevNotes: currentNotes });
                updateUndoUI();
            }
            
            let notes = currentNotes ? currentNotes.split(',').filter(n => n) : [];
            if (notes.includes(value)) {
                notes = notes.filter(n => n !== value); // Remove note
            } else {
                notes.push(value); // Add note
            }
            notes.sort();
            
            cell.dataset.notes = notes.join(',');
            
            if (notes.length === 0) {
                cell.innerHTML = '';
            } else {
                renderNotes(cell);
            }
            SoundEngine.playPop();
            HapticEngine.light();
        } else {
            // Normal Mode
            const correctValue = solvedGrid[cell.dataset.index].toString();
            if (value !== correctValue) {
                mistakes++;
                mistakesThisGame++;
                trackEvent('mistake_made', {
                    difficulty: selectedDifficulty,
                    is_daily_challenge: isDailyChallenge,
                    mistakes: mistakes,
                    mistakes_this_game: mistakesThisGame,
                    max_mistakes: MAX_MISTAKES
                });
                SoundEngine.playBuzz();
                HapticEngine.warning();
                updateMistakeUI();
                StatsEngine.recordMistake();
                if (mistakes >= MAX_MISTAKES) {
                    handleMistakeLimitReached();
                    return;
                } else if (mistakes === MAX_MISTAKES - 1 && !window.isPremium) {
                    if (!mistakeRescueUsedThisGame) {
                        // INTENT-PROXIMATE PRELOAD: Prepare Mistake Rescue rewarded ad when 1 mistake away from limit
                        if (typeof AdMobService !== 'undefined' && AdMobService.prepareRewarded) {
                            AdMobService.prepareRewarded('MISTAKE_RESCUE');
                        }
                    } else {
                        // Mistake rescue already consumed: next mistake will trigger Game Over
                        if (typeof AdMobService !== 'undefined' && AdMobService.prepareInterstitial) {
                            AdMobService.prepareInterstitial('GAME_OVER');
                        }
                    }
                }
            } else {
                SoundEngine.playPop();
                HapticEngine.light();
                cell.classList.remove('number-pop');
                void cell.offsetWidth;
                cell.classList.add('number-pop');
                cell.addEventListener('animationend', () => cell.classList.remove('number-pop'), { once: true });
            }

            if (undosRemaining > 0) {
                undoStack.push({ cell, prevValue: currentValue, prevNotes: currentNotes });
                updateUndoUI();
            }

            cell.dataset.value = value;
            cell.dataset.notes = '';
            cell.textContent = value;
            cell.classList.add('user-input');
            
            if (value === correctValue) {
                autoCleanupNotes(cell.dataset.index, value);
            }
            
            validateBoard();
            if (selectedCell === cell) selectCell(cell);
        }
        saveGameState();
    }

    function updateMistakeUI() {
        if (mistakesDisplay) {
            mistakesDisplay.textContent = `Mistakes: ${mistakes}/${MAX_MISTAKES}`;
        }
    }
     async function handleMistakeLimitReached() {
    if (isMistakeRescueRequestInProgress) return;

    stopTimer();

    if (mistakeRescueUsedThisGame) {
        triggerGameOver();
        return;
    }

const wantsRescue = await showRewardAdModal({
    icon: "❤️",
    title: "Rescue Available",
    message: "Watch an ad to remove 1 mistake and continue this puzzle.",
    confirmText: "Watch Ad",
    cancelText: "End Game"
});
    if (!wantsRescue) {
        triggerGameOver();
        return;
    }

    if (typeof AdMobService === "undefined") {
        console.warn("Mistake Rescue unavailable: AdMobService is not loaded.");
        triggerGameOver();
        return;
    }

    isMistakeRescueRequestInProgress = true;

    const rewardEarned = await AdMobService.showMistakeRescueAd();

    isMistakeRescueRequestInProgress = false;

    if (rewardEarned) {
    mistakeRescueUsedThisGame = true;
    mistakes = MAX_MISTAKES - 1;
    updateMistakeUI();
    saveGameState();
    resumeTimer();
    return;
} else {
    triggerGameOver();
}
}
    function triggerGameOver() {
        stopTimer();
        StatsEngine.recordGameOver();
        SoundEngine.playGameOver();
        clearSavedGame();
        gameOverModal.classList.remove('hidden');
        trackEvent('game_over', { difficulty: selectedDifficulty, is_daily_challenge: isDailyChallenge, elapsed_seconds: secondsElapsed, mistakes: mistakes });
        if (!window.isPremium && typeof AdMobService !== 'undefined' && AdMobService.prepareInterstitial) {
            AdMobService.prepareInterstitial('GAME_OVER');
        }
    }

    // --- Validation & Group Pulse Logic ---
    let completedGroupsTracker = new Set();

    function validateBoard() {
        const cells = Array.from(board.children);
        cells.forEach(c => {
            c.classList.remove('error');
            c.classList.remove('locked-group');
        });

        let hasErrors = false;
        const gridState = new Array(81).fill('');
        
        for (let i = 0; i < 81; i++) {
            let val = '';
            if (cells[i].classList.contains('user-input') || cells[i].classList.contains('prefilled')) {
                val = cells[i].dataset.value || cells[i].childNodes[0].nodeValue || '';
            }
            gridState[i] = val;
            if (!val) continue;

            // Highlight if incorrect against the solution
            const correctVal = solvedGrid[i].toString();
            if (val !== correctVal) {
                cells[i].classList.add('error');
                hasErrors = true;
            }
        }
        
        // --- Cell Locking Logic & Group Completion Feedback ---
        // Only lock if there are no errors on the board (prevents locking a row if an intersecting column is wrong)
        if (!hasErrors) {
            const newlyCompletedCells = [];
            const currentCompletedKeys = new Set();

            // Check Rows
            for (let r = 0; r < 9; r++) {
                const rowCells = [];
                let isComplete = true;
                for (let c = 0; c < 9; c++) {
                    const idx = r * 9 + c;
                    rowCells.push(cells[idx]);
                    if (!gridState[idx]) isComplete = false;
                }
                if (isComplete) {
                    rowCells.forEach(cell => cell.classList.add('locked-group'));
                    const groupKey = 'row_' + r;
                    currentCompletedKeys.add(groupKey);
                    if (!completedGroupsTracker.has(groupKey)) {
                        newlyCompletedCells.push(...rowCells);
                    }
                }
            }
            
            // Check Columns
            for (let c = 0; c < 9; c++) {
                const colCells = [];
                let isComplete = true;
                for (let r = 0; r < 9; r++) {
                    const idx = r * 9 + c;
                    colCells.push(cells[idx]);
                    if (!gridState[idx]) isComplete = false;
                }
                if (isComplete) {
                    colCells.forEach(cell => cell.classList.add('locked-group'));
                    const groupKey = 'col_' + c;
                    currentCompletedKeys.add(groupKey);
                    if (!completedGroupsTracker.has(groupKey)) {
                        newlyCompletedCells.push(...colCells);
                    }
                }
            }
            
            // Check 3x3 Blocks
            for (let br = 0; br < 3; br++) {
                for (let bc = 0; bc < 3; bc++) {
                    const blockCells = [];
                    let isComplete = true;
                    for (let i = 0; i < 3; i++) {
                        for (let j = 0; j < 3; j++) {
                            const row = br * 3 + i;
                            const col = bc * 3 + j;
                            const idx = row * 9 + col;
                            blockCells.push(cells[idx]);
                            if (!gridState[idx]) isComplete = false;
                        }
                    }
                    if (isComplete) {
                        blockCells.forEach(cell => cell.classList.add('locked-group'));
                        const groupKey = 'box_' + br + '_' + bc;
                        currentCompletedKeys.add(groupKey);
                        if (!completedGroupsTracker.has(groupKey)) {
                            newlyCompletedCells.push(...blockCells);
                        }
                    }
                }
            }

            // Pulse newly completed groups and trigger subtle medium haptic
            if (newlyCompletedCells.length > 0 && completedGroupsTracker.size > 0) {
                HapticEngine.medium();
                const uniqueCells = Array.from(new Set(newlyCompletedCells));
                uniqueCells.forEach(c => {
                    c.classList.remove('group-completed-pulse');
                    void c.offsetWidth;
                    c.classList.add('group-completed-pulse');
                    c.addEventListener('animationend', () => c.classList.remove('group-completed-pulse'), { once: true });
                });
            }

            completedGroupsTracker = currentCompletedKeys;
        }

        checkWinCondition(hasErrors);
    }

    function checkWinCondition(hasErrors) {
        const cells = Array.from(board.children);
        const isFull = cells.every(c => c.classList.contains('user-input') || c.classList.contains('prefilled'));

        if (isFull && !hasErrors) {
            stopTimer();
            timerDisplay.style.color = '#4a6fa5'; // Win color

            // Only record stats if this exact replay wasn't already recorded
            if (!completedPuzzleSnapshot || !completedPuzzleSnapshot.recorded) {
                const isNewBest = StatsEngine.recordWin(currentLevel, secondsElapsed);
                
                // Mark daily challenge completed if applicable
                if (isDailyChallenge) {
                    const completedKey = activeDailyChallengeDateKey || DailyChallengeEngine.todayKey();
                    DailyChallengeEngine.markCompleted(completedKey);
                    trackEvent('daily_challenge_completed', {
                        daily_date: completedKey,
                        difficulty: selectedDifficulty
                    });
                }

                trackEvent('puzzle_completed', {
                    difficulty: selectedDifficulty,
                    is_daily_challenge: isDailyChallenge,
                    mistakes: mistakes,
                    hints_used_this_game: hintsUsedThisGame,
                    mistakes_this_game: mistakesThisGame,
                    elapsed_seconds: secondsElapsed
                });

                // Fire achievement checks
                const winFlags = {
                    perfectSolve: mistakesThisGame === 0,
                    noHints: hintsUsedThisGame === 0
                };
                AchievementsEngine.onWin(winFlags);

                // Record puzzle completion for in-app review strategy
                if (typeof ReviewPromptManager !== 'undefined') {
                    ReviewPromptManager.recordPuzzleCompleted({
                        difficulty: selectedDifficulty,
                        isDaily: isDailyChallenge,
                        mistakes: mistakesThisGame,
                        hints: hintsUsedThisGame,
                        isNewBest: isNewBest,
                        streak: StatsEngine.stats.currentStreak
                    });
                }

                // Level up (only for non-daily games)
                if (!isDailyChallenge) {
                    currentLevel++;
                    localStorage.setItem('sudoku-level', currentLevel);
                }

                if (completedPuzzleSnapshot) {
                    completedPuzzleSnapshot.recorded = true;
                    completedPuzzleSnapshot.isNewBest = isNewBest;
                }
            }
            
            clearSavedGame();
            SoundEngine.playVictory();
            HapticEngine.success();

            // Small timeout to allow UI to render the last number before modal
            setTimeout(() => {
                updateLevelUI();

                // Fire confetti!
                if (myConfetti) {
                    myConfetti({
                        particleCount: 150,
                        spread: 70,
                        origin: { y: 0.6 }
                    });
                }

                if (victoryModal) {
                    // Populate victory stats
                    const vDiff = document.getElementById('victory-diff');
                    const vTime = document.getElementById('victory-time');
                    const vMistakes = document.getElementById('victory-mistakes');
                    const vHints = document.getElementById('victory-hints');
                    const vBest = document.getElementById('victory-best-time');
                    
                    if (vDiff) vDiff.textContent = isDailyChallenge ? 'Daily' : (selectedDifficulty.charAt(0).toUpperCase() + selectedDifficulty.slice(1));
                    if (vTime) vTime.textContent = timerDisplay.textContent;
                    if (vMistakes) vMistakes.textContent = mistakesThisGame.toString();
                    if (vHints) vHints.textContent = hintsUsedThisGame.toString();

                    const vScore = document.getElementById('victory-score');
                    if (vScore) {
                        const basePts = selectedDifficulty === 'expert' ? 3500 : selectedDifficulty === 'hard' ? 2500 : selectedDifficulty === 'medium' ? 1800 : 1200;
                        const timePenalty = Math.min(1000, secondsElapsed * 2);
                        const mistakePenalty = mistakesThisGame * 200;
                        const finalScore = Math.max(500, basePts - timePenalty - mistakePenalty);
                        vScore.textContent = `+${finalScore.toLocaleString()} pts`;
                    }

                    const pristineBadge = document.querySelector('.victory-pristine-badge');
                    if (pristineBadge) {
                        pristineBadge.style.display = (mistakesThisGame === 0 && hintsUsedThisGame === 0) ? 'inline-flex' : 'none';
                    }
                    
                    if (vBest) {
                        if (completedPuzzleSnapshot && completedPuzzleSnapshot.isNewBest) {
                            vBest.classList.remove('hidden');
                        } else {
                            vBest.classList.add('hidden');
                        }
                    }

                    // Calculate stars
                    let stars = 1;
                    if (mistakesThisGame === 0 && hintsUsedThisGame === 0) {
                        stars = 3;
                    } else if (mistakesThisGame <= 2 && hintsUsedThisGame <= 1) {
                        stars = 2;
                    }

                    for (let i = 1; i <= 3; i++) {
                        const starEl = document.getElementById(`v-star-${i}`);
                        if (starEl) {
                            starEl.classList.remove('filled', 'animate-in');
                            // Small delay for stagger effect
                            setTimeout(() => {
                                if (i <= stars) {
                                    starEl.classList.add('filled');
                                }
                                starEl.classList.add('animate-in');
                            }, i * 200);
                        }
                    }

                  bonusRewardClaimedForCurrentVictory = false;

                  if (victoryBonusBtn) {
                      victoryBonusBtn.textContent = "🎁 Claim Bonus Hint (2x)";
                      victoryBonusBtn.disabled = false;
                  }
                  if (typeof AdMobService !== 'undefined') {
                      AdMobService.setGameplayActive(false);
                      AdMobService.hideGameplayBannerAd();
                      AdMobService.showNativeAd('victory');
                  }

                  const hasNativeAd = (typeof window.Capacitor !== 'undefined' && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform() && !window.isPremium);
                  if (hasNativeAd) {
                      victoryModal.classList.add('has-native-ad');
                  } else {
                      victoryModal.classList.remove('has-native-ad');
                  }
                  victoryModal.classList.remove('hidden');
                  if (!window.isPremium && typeof AdMobService !== 'undefined') {
                      if (AdMobService.disposeInterstitial) {
                          AdMobService.disposeInterstitial('GAME_OVER', 'OPPORTUNITY_LEFT');
                      }
                      if (!bonusRewardClaimedForCurrentVictory && AdMobService.prepareRewarded) {
                          AdMobService.prepareRewarded('VICTORY_BONUS');
                      }
                      if (AdMobService.prepareInterstitial) {
                          AdMobService.prepareInterstitial('COMPLETION');
                      }
                  }
                } else {
                    alert(`Congratulations! Puzzle solved in ${timerDisplay.textContent}.`);
                    startNewGame();
                    saveGameState();
                }
            }, 100);
        } else {
            timerDisplay.style.color = ''; // Reset to default
        }
    }

    // --- Undo Logic ---
    function performUndo() {
        if (undosRemaining <= 0 || undoStack.length === 0) return;

        const lastAction = undoStack.pop();
        
        // Restore values and notes
        lastAction.cell.dataset.value = lastAction.prevValue;
        lastAction.cell.dataset.notes = lastAction.prevNotes;
        
        if (lastAction.prevValue) {
            lastAction.cell.textContent = lastAction.prevValue;
            lastAction.cell.classList.add('user-input');
        } else if (lastAction.prevNotes) {
            lastAction.cell.classList.remove('user-input');
            renderNotes(lastAction.cell);
        } else {
            lastAction.cell.textContent = '';
            lastAction.cell.classList.remove('user-input');
        }

        undosRemaining--;
        HapticEngine.medium();
        selectCell(lastAction.cell);
        updateUndoUI();
        validateBoard();
        saveGameState();

        trackEvent('undo_used', {
            difficulty: selectedDifficulty,
            is_daily_challenge: isDailyChallenge,
            undo_stack_remaining: undosRemaining,
            mistakes: mistakes,
            hints_remaining: hintsRemaining
        });
    }

    function updateUndoUI() {
        undoCountSpan.textContent = undosRemaining;
        if (undosRemaining <= 0 || undoStack.length === 0) {
            undoBtn.disabled = true;
        } else {
            undoBtn.disabled = false;
        }
    }

    function navigate(key) {
        if (!selectedCell) return;
        let index = parseInt(selectedCell.dataset.index);
        let row = Math.floor(index / 9);
        let col = index % 9;

        if (key === 'ArrowUp' && row > 0) index -= 9;
        if (key === 'ArrowDown' && row < 8) index += 9;
        if (key === 'ArrowLeft' && col > 0) index -= 1;
        if (key === 'ArrowRight' && col < 8) index += 1;

        const nextCell = board.children[index];
        selectCell(nextCell);
    }

    // --- Hint Logic ---
    async function giveHint() {
    if (hintsRemaining <= 0) {
        if (isRewardedHintRequestInProgress) return;

const wantsAd = await showRewardAdModal({
    icon: "💡",
    title: "Need a Hint?",
    message: "Watch a short ad to get 1 extra hint.",
    confirmText: "Watch Ad",
    cancelText: "Not Now"
});
        if (!wantsAd) return;

        if (typeof AdMobService === "undefined") {
            console.warn("Rewarded Hint unavailable: AdMobService is not loaded.");
            return;
        }

        isRewardedHintRequestInProgress = true;
        if (hintBtn) hintBtn.disabled = true;

        const rewardEarned = await AdMobService.showRewardedHintAd();

        isRewardedHintRequestInProgress = false;

            if (rewardEarned) {
    hintsRemaining += 1;
    trackEvent('bonus_hint_claimed', { hints_remaining: hintsRemaining, difficulty: selectedDifficulty, is_daily_challenge: isDailyChallenge });
    updateHintUI();
    saveGameState();
} else {
    updateHintUI();
}

        return;
    }

        let targetCell = selectedCell;

        // If no cell selected, or selected cell is already prefilled, or selected cell is correct, pick a random empty or wrong cell
        if (!targetCell || targetCell.classList.contains('prefilled') || targetCell.textContent == solvedGrid[targetCell.dataset.index]) {
            const cells = Array.from(board.children);
            const emptyOrWrongCells = cells.filter(c => !c.classList.contains('prefilled') && c.textContent != solvedGrid[c.dataset.index]);
            
            if (emptyOrWrongCells.length === 0) return; // Board is full and correct
            
            targetCell = emptyOrWrongCells[Math.floor(Math.random() * emptyOrWrongCells.length)];
            selectCell(targetCell);
        }

        // Fill the cell with the correct answer
        const correctValue = solvedGrid[targetCell.dataset.index].toString();
        
        // Don't add to undo stack since it's a hint
        targetCell.textContent = correctValue;
        targetCell.classList.remove('user-input', 'error');
        targetCell.classList.add('prefilled'); // Lock it
        targetCell.classList.remove('number-pop');
        void targetCell.offsetWidth;
        targetCell.classList.add('number-pop');
        targetCell.addEventListener('animationend', () => targetCell.classList.remove('number-pop'), { once: true });
        HapticEngine.light();
        validateBoard();

        hintsRemaining--;
        hintsUsedThisGame++;
        trackEvent('hint_used', { hints_remaining: hintsRemaining, difficulty: selectedDifficulty, is_daily_challenge: isDailyChallenge, hints_used_this_game: hintsUsedThisGame });
        updateHintUI();
        saveGameState();
    }

    function updateHintUI() {
        if (hintCountSpan) {
            if (hintsRemaining <= 0) {
                hintCountSpan.textContent = "AD";
                hintCountSpan.className = "tool-badge tool-badge-ad";
                if (!window.isPremium && typeof AdMobService !== 'undefined' && AdMobService.prepareRewarded) {
                    AdMobService.prepareRewarded('HINT');
                }
            } else {
                hintCountSpan.textContent = hintsRemaining;
                hintCountSpan.className = "tool-badge";
            }
        }

    if (hintBtn) {
        hintBtn.disabled = isRewardedHintRequestInProgress;

        if (hintsRemaining <= 0) {
            hintBtn.title = "Watch ad to get an extra hint";
            hintBtn.setAttribute("aria-label", "Watch ad to get an extra hint");
        } else {
            hintBtn.title = "Use hint";
            hintBtn.setAttribute("aria-label", "Use hint");
        }
    }
}

    // --- Auto-Check / Scan Mistakes Logic ---
    function clearAutoCheckHighlights() {
        if (autoCheckClearTimeoutId) {
            clearTimeout(autoCheckClearTimeoutId);
            autoCheckClearTimeoutId = null;
        }
        const boardEl = document.getElementById('sudoku-board');
        if (!boardEl) return;
        const highlighted = boardEl.querySelectorAll('.auto-check-error, .auto-check-correct');
        highlighted.forEach(el => el.classList.remove('auto-check-error', 'auto-check-correct'));
    }

    function updateAutoCheckUI() {
        if (!autoCheckBtn || !autoCheckBadge) return;
        const puzzleLimit = typeof AdMobService !== 'undefined'
            ? Number(AdMobService.getRemoteValue('auto_check_per_puzzle_limit', 1))
            : 1;

        if (window.isPremium) {
            autoCheckBadge.textContent = 'FREE';
            autoCheckBadge.className = 'tool-badge';
            autoCheckBtn.disabled = false;
            autoCheckBtn.title = 'Scan board for mistakes (Free for Member)';
            return;
        }

        const remaining = Math.max(0, puzzleLimit - autoCheckUsedThisPuzzle);
        if (remaining <= 0) {
            autoCheckBadge.textContent = '0';
            autoCheckBadge.className = 'tool-badge';
            autoCheckBtn.disabled = true;
            autoCheckBtn.title = `Auto-Check limit (${puzzleLimit}/puzzle) reached`;
        } else {
            autoCheckBadge.textContent = 'AD';
            autoCheckBadge.className = 'tool-badge tool-badge-ad';
            autoCheckBtn.disabled = false;
            autoCheckBtn.title = 'Watch ad to scan board for mistakes';
        }
    }

    let isAutoCheckInProgress = false;
    async function handleAutoCheck() {
        if (isAutoCheckInProgress || isGameOver || isGameWon || isPaused) return;

        const isEnabled = typeof AdMobService !== 'undefined'
            ? AdMobService.isFeatureEnabled('auto_check_rewarded_enabled')
            : true;
        if (!isEnabled) {
            showToast('Auto-Check is currently disabled.');
            return;
        }

        const puzzleLimit = typeof AdMobService !== 'undefined'
            ? Number(AdMobService.getRemoteValue('auto_check_per_puzzle_limit', 1))
            : 1;

        if (!window.isPremium && autoCheckUsedThisPuzzle >= puzzleLimit) {
            showToast(`Auto-Check limit (${puzzleLimit}/puzzle) reached for this game.`);
            return;
        }

        const boardEl = document.getElementById('sudoku-board');
        if (!boardEl || !solvedGrid || solvedGrid.length < 81) return;

        // Check if there are user inputs on the board to scan
        const userCells = Array.from(boardEl.querySelectorAll('.cell.user-input')).filter(c => c.textContent && !c.querySelector('.notes-grid'));
        if (userCells.length === 0) {
            showToast('Enter at least one number before scanning.');
            return;
        }

        trackEvent('auto_check_tapped', { difficulty: selectedDifficulty });

        let confirmed = true;
        if (!window.isPremium) {
            confirmed = await showRewardAdModal({
                icon: "fact_check",
                title: "Scan Mistakes",
                message: "Watch a short sponsor clip to scan your board and highlight incorrect entries.",
                confirmText: "Watch Ad & Scan",
                cancelText: "Cancel"
            });
        }

        if (!confirmed) {
            trackEvent('auto_check_cancelled', { difficulty: selectedDifficulty });
            return;
        }

        isAutoCheckInProgress = true;
        if (autoCheckBtn) autoCheckBtn.disabled = true;

        let rewardGranted = false;
        try {
            if (window.isPremium) {
                rewardGranted = true;
            } else if (typeof AdMobService !== 'undefined') {
                trackEvent('auto_check_ad_started', { difficulty: selectedDifficulty });
                rewardGranted = await AdMobService.showAutoCheckRewardedAd();
            } else {
                rewardGranted = true;
            }

            if (rewardGranted) {
                autoCheckUsedThisPuzzle++;
                updateAutoCheckUI();

                // Scan entered user cells against solvedGrid
                clearAutoCheckHighlights();
                let mistakeCount = 0;
                let correctCount = 0;

                userCells.forEach(cell => {
                    const idx = parseInt(cell.dataset.index, 10);
                    if (isNaN(idx)) return;
                    const enteredVal = cell.textContent.trim();
                    const correctVal = solvedGrid[idx].toString();
                    if (enteredVal !== correctVal) {
                        mistakeCount++;
                        cell.classList.add('auto-check-error');
                    } else {
                        correctCount++;
                        cell.classList.add('auto-check-correct');
                    }
                });

                trackEvent('auto_check_reward_earned', { difficulty: selectedDifficulty });
                trackEvent('auto_check_completed', {
                    difficulty: selectedDifficulty,
                    mistakes_found: mistakeCount,
                    correct_found: correctCount
                });

                if (mistakeCount > 0) {
                    HapticEngine.warning();
                    showToast(`Scan complete: ${mistakeCount} incorrect entry highlighted.`);
                } else {
                    HapticEngine.medium();
                    showToast('Scan complete: All entered numbers are correct!');
                }

                // Clear highlights automatically after 4.5s
                autoCheckClearTimeoutId = setTimeout(() => {
                    clearAutoCheckHighlights();
                }, 4500);
            } else {
                trackEvent('auto_check_failed', { difficulty: selectedDifficulty });
                showToast('Advertisement not completed. Board was not scanned.');
            }
        } catch (e) {
            console.error('[AutoCheck] Error during scan flow:', e);
            trackEvent('auto_check_failed', { difficulty: selectedDifficulty, error: String(e) });
            showToast('Scan could not be performed. Please try again.');
        } finally {
            isAutoCheckInProgress = false;
            updateAutoCheckUI();
        }
    }
    
    // --- Sudoku Generation & State ---
    
    /**
     * Generates a brand new Sudoku puzzle and resets the game state.
     * 
     * Example:
     * - Resets undos to 3, hints to 3, mistakes to 0.
     * - Generates a valid full board using fillGrid().
     * - Removes cells based on difficulty + currentLevel.
     */
    function startNewGame(dailyData) {
        // Clear any stuck confetti
        if (myConfetti) {
            myConfetti.reset();
        }

        // Reset per-game tracking
        isDailyChallenge = !!dailyData;
        hintsUsedThisGame = 0;
        mistakesThisGame = 0;
        mistakeRescueUsedThisGame = false;
        isMistakeRescueRequestInProgress = false;
        autoCheckUsedThisPuzzle = 0;
        completedGroupsTracker.clear();
        clearAutoCheckHighlights();
        updateAutoCheckUI();

        // Clear any stale rewarded slot from prior puzzle session (intent-proximate model)
        if (typeof AdMobService !== 'undefined') {
            AdMobService.disposeRewarded(null, 'OPPORTUNITY_LEFT');
        }

        // Clear pause state
        if (isPaused) {
            isPaused = false;
            gameScreen.classList.remove('paused');
            updatePauseBtnUI(false);
            if (pauseModal) pauseModal.classList.add('hidden');
        }

        // Reset state
        undoStack = [];
        undosRemaining = MAX_UNDOS;
        hintsRemaining = MAX_HINTS;
applyPendingBonusHintsForNewPuzzle();

mistakes = 0;
updateMistakeUI();
updateUndoUI();
updateHintUI();
        if (selectedCell) {
            selectedCell.classList.remove('selected');
            selectedCell = null;
        }

        const cells = Array.from(board.children);
        cells.forEach(c => {
            c.textContent = '';
            c.dataset.value = '';
            c.dataset.notes = '';
            c.classList.remove('prefilled', 'user-input', 'error', 'crosshair', 'tutorial-highlight', 'tutorial-dim', 'locked-group');
        });

        let grid, diffLabel, badgeClass;

        const finishRender = () => {
            // Save the puzzle snapshot for replay BEFORE user edits it
            completedPuzzleSnapshot = {
                originalGrid: [...grid],
                solvedGrid: [...solvedGrid],
                difficulty: selectedDifficulty,
                isDailyChallenge: isDailyChallenge,
                recorded: false
            };

            // 3. Render
            for (let i = 0; i < 81; i++) {
                if (grid[i] !== 0) {
                    cells[i].textContent = grid[i];
                    cells[i].dataset.value = grid[i].toString();
                    cells[i].classList.add('prefilled');
                }
            }

            // 4. Update difficulty badge in separate row beneath level
            const badgeRow = document.getElementById('difficulty-badge-row');
            if (badgeRow) {
                badgeRow.innerHTML = `<span class="difficulty-badge ${badgeClass}">${diffLabel}</span>`;
            }
            if (levelDisplay) {
                levelDisplay.textContent = `Level ${currentLevel}`;
            }

            // 5. Tutorial Highlight for Level 1
            if (currentLevel === 1 && !dailyData) {
                const emptyIndex = grid.indexOf(0);
                if (emptyIndex !== -1) {
                    const row = Math.floor(emptyIndex / 9);
                    const col = emptyIndex % 9;
                    const startRow = Math.floor(row / 3) * 3;
                    const startCol = Math.floor(col / 3) * 3;

                    const targetCells = new Set();
                    for (let i = 0; i < 3; i++) {
                        for (let j = 0; j < 3; j++) {
                            const cellIndex = (startRow + i) * 9 + (startCol + j);
                            cells[cellIndex].classList.add('tutorial-highlight');
                            targetCells.add(cellIndex);
                        }
                    }
                    for (let i = 0; i < 81; i++) {
                        if (!targetCells.has(i)) cells[i].classList.add('tutorial-dim');
                    }
                }
            }

            startTimer();
            trackEvent('new_game_started', {
                difficulty: selectedDifficulty,
                is_daily_challenge: isDailyChallenge,
                source: dailyData ? 'daily' : 'manual',
                hints_remaining: hintsRemaining,
                mistakes_allowed: MAX_MISTAKES
            });
        };

        if (dailyData) {
            // Daily Challenge: use pre-generated deterministic puzzle
            grid = [...dailyData.grid];
            solvedGrid = [...dailyData.solved];
            diffLabel = 'Daily';
            badgeClass = 'diff-badge-daily';
            console.log('Game: starting Daily Challenge puzzle');
            finishRender();
        } else {
            // Record that a new real game has started
            StatsEngine.recordGameStarted(currentLevel);

            if (currentLevel === 1) {
                // Tutorial: easy single-cell removal, no rating needed
                const solved = new Array(81).fill(0);
                fillGrid(solved);
                solvedGrid = [...solved];
                grid = [...solved];
                PuzzleMaker.removeCellsUnique(grid, 1);
                diffLabel = 'Easy';
                badgeClass = 'diff-badge-easy';
                console.log('Game: starting Tutorial puzzle (Level 1, 1 cell removed)');
                finishRender();
            } else {
                // Show a loading/generating state on the board briefly
                cells.forEach(c => c.textContent = '');
                if (levelDisplay) levelDisplay.textContent = 'Generating...';

                // Yield to the browser so the "Generating..." UI can render
                setTimeout(() => {
                    const result = PuzzleMaker.generate(selectedDifficulty);
                    grid = result.grid;
                    solvedGrid = result.solved;
                    const labels = {
                        easy:   { label: 'Easy',   badge: 'diff-badge-easy' },
                        medium: { label: 'Medium', badge: 'diff-badge-medium' },
                        hard:   { label: 'Hard',   badge: 'diff-badge-hard' }
                    };
                    const d = labels[selectedDifficulty] || labels.easy;
                    diffLabel = d.label;
                    badgeClass = d.badge;
                    
                    finishRender();
                }, 10);
            }
        }
    }

    // --- Timer Logic ---
    function startTimer() {
        clearInterval(timerInterval);
        secondsElapsed = 0;
        updateTimerDisplay();
        timerInterval = setInterval(() => {
            secondsElapsed++;
            updateTimerDisplay();
        }, 1000);
    }

    function resumeTimer() {
        clearInterval(timerInterval);
        updateTimerDisplay();
        timerInterval = setInterval(() => {
            secondsElapsed++;
            updateTimerDisplay();
        }, 1000);
    }

    function stopTimer() {
        clearInterval(timerInterval);
    }

    function updateTimerDisplay() {
        const mins = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
        const secs = (secondsElapsed % 60).toString().padStart(2, '0');
        timerDisplay.textContent = `${mins}:${secs}`;
    }

    /**
     * Recursively fills the Sudoku grid with a valid, complete solution using a backtracking algorithm.
     * 
     * @param {number[]} grid - A 1D array of length 81 representing the 9x9 board. Empty cells are 0.
     * @returns {boolean} - Returns true if the grid was successfully filled.
     * 
     * Example:
     * let emptyBoard = new Array(81).fill(0);
     * fillGrid(emptyBoard);
     * // emptyBoard now contains 81 numbers satisfying all Sudoku rules.
     */
    function fillGrid(grid) {
        for (let i = 0; i < 81; i++) {
            if (grid[i] === 0) {
                const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
                for (let num of nums) {
                    if (isValid(grid, i, num)) {
                        grid[i] = num;
                        if (fillGrid(grid)) return true;
                        grid[i] = 0;
                    }
                }
                return false;
            }
        }
        return true;
    }

    /**
     * PuzzleMaker — generates uniquely-solvable Sudoku puzzles rated by
     * logical solving techniques, not just clue count.
     *
     * Techniques tracked (weakest → hardest):
     *   0. Naked Single    — one candidate for a cell
     *   1. Hidden Single   — one candidate for a digit in row/col/box
     *   2. Locked Candidates — box-line intersection elimination
     *   3. Naked Pair      — two cells in a unit sharing exactly two candidates
     *   4. Expert+         — unresolved by above; puzzle still has unique solution
     *
     * Rating bands:
     *   easy:   hardest === 0  (naked singles only)
     *   medium: hardest 1–2    (hidden singles / locked candidates)
     *   hard:   hardest >= 3   (naked pairs or expert+)
     *
     * Generation time guard: 400 ms per difficulty call (prevents UI freeze).
     */
    const PuzzleMaker = {

        // ── Uniqueness check (MRV-guided backtracker, stops at `limit`) ──────
        countSolutions(grid, limit = 2) {
            const g = [...grid];
            let count = 0;
            function solve() {
                let best = -1, bestCnt = 10;
                for (let i = 0; i < 81; i++) {
                    if (g[i] !== 0) continue;
                    let cnt = 0;
                    for (let n = 1; n <= 9; n++) if (isValid(g, i, n)) cnt++;
                    if (cnt === 0) return;   // dead end
                    if (cnt < bestCnt) { bestCnt = cnt; best = i; }
                    if (bestCnt === 1) break; // can't do better
                }
                if (best === -1) { count++; return; } // all filled = solution
                for (let n = 1; n <= 9; n++) {
                    if (!isValid(g, best, n)) continue;
                    g[best] = n;
                    solve();
                    g[best] = 0;
                    if (count >= limit) return;
                }
            }
            solve();
            return count;
        },

        // ── Remove cells ensuring unique solution ─────────────────────────────
        removeCellsUnique(grid, targetRemove) {
            const indices = [...Array(81).keys()].sort(() => Math.random() - 0.5);
            let removed = 0;
            for (const idx of indices) {
                if (removed >= targetRemove) break;
                if (grid[idx] === 0) continue;
                const backup = grid[idx];
                grid[idx] = 0;
                if (this.countSolutions(grid, 2) === 1) {
                    removed++;
                } else {
                    grid[idx] = backup; // restore — would break uniqueness
                }
            }
            return removed;
        },

        // ── Candidate set builder ─────────────────────────────────────────────
        getCandidates(grid) {
            const cands = Array.from({length: 81}, () => new Set());
            for (let i = 0; i < 81; i++) {
                if (grid[i] !== 0) continue;
                for (let n = 1; n <= 9; n++) {
                    if (isValid(grid, i, n)) cands[i].add(n);
                }
            }
            return cands;
        },

        // ── Logical difficulty rater ──────────────────────────────────────────
        // Returns: { rating, techName, solved, hardest, remainingUnsolvedCells }
        rateLogical(puzzle) {
            const g = [...puzzle];
            // hardest starts at -1 = no technique fired yet
            let hardest = -1;

            const applyNakedSingles = (cands) => {
                let progress = false;
                for (let i = 0; i < 81; i++) {
                    if (g[i] !== 0 || cands[i].size !== 1) continue;
                    const val = [...cands[i]][0];
                    g[i] = val;
                    this._eliminatePeers(cands, i, val);
                    if (hardest < 0) hardest = 0;
                    progress = true;
                }
                return progress;
            };

            const applyHiddenSingles = (cands) => {
                let progress = false;
                for (const unit of this._allUnits()) {
                    for (let n = 1; n <= 9; n++) {
                        const possible = unit.filter(i => g[i] === 0 && cands[i].has(n));
                        if (possible.length === 1) {
                            const idx = possible[0];
                            g[idx] = n;
                            this._eliminatePeers(cands, idx, n);
                            cands[idx].clear();
                            if (hardest < 1) hardest = 1;
                            progress = true;
                        }
                    }
                }
                return progress;
            };

            const applyLockedCandidates = (cands) => {
                let progress = false;
                for (let br = 0; br < 3; br++) {
                    for (let bc = 0; bc < 3; bc++) {
                        const boxCells = [];
                        for (let i = 0; i < 3; i++)
                            for (let j = 0; j < 3; j++)
                                boxCells.push((br*3+i)*9 + (bc*3+j));
                        for (let n = 1; n <= 9; n++) {
                            const inBox = boxCells.filter(i => g[i] === 0 && cands[i].has(n));
                            if (inBox.length < 2) continue;
                            const rows = [...new Set(inBox.map(i => Math.floor(i/9)))];
                            const cols = [...new Set(inBox.map(i => i%9))];
                            if (rows.length === 1) {
                                for (let c = 0; c < 9; c++) {
                                    const ci = rows[0]*9+c;
                                    if (boxCells.includes(ci) || g[ci] !== 0 || !cands[ci].has(n)) continue;
                                    cands[ci].delete(n);
                                    if (hardest < 2) hardest = 2;
                                    progress = true;
                                }
                            }
                            if (cols.length === 1) {
                                for (let r = 0; r < 9; r++) {
                                    const ci = r*9+cols[0];
                                    if (boxCells.includes(ci) || g[ci] !== 0 || !cands[ci].has(n)) continue;
                                    cands[ci].delete(n);
                                    if (hardest < 2) hardest = 2;
                                    progress = true;
                                }
                            }
                        }
                    }
                }
                return progress;
            };

            const applyNakedPairs = (cands) => {
                let progress = false;
                for (const unit of this._allUnits()) {
                    const empties = unit.filter(i => g[i] === 0);
                    const pairs = empties.filter(i => cands[i].size === 2);
                    for (let a = 0; a < pairs.length; a++) {
                        for (let b = a+1; b < pairs.length; b++) {
                            const setA = cands[pairs[a]];
                            const setB = cands[pairs[b]];
                            if (setA.size === 2 && [...setA].every(v => setB.has(v))) {
                                for (const n of setA) {
                                    for (const i of empties) {
                                        if (i === pairs[a] || i === pairs[b]) continue;
                                        if (cands[i].has(n)) {
                                            cands[i].delete(n);
                                            if (hardest < 3) hardest = 3;
                                            progress = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                return progress;
            };

            // Main solving loop — apply techniques weakest-first
            let maxIter = 200;
            while (maxIter-- > 0) {
                const cands = this.getCandidates(g);
                if (g.every(v => v !== 0)) break; // solved

                let progress = false;
                progress = applyNakedSingles(cands) || progress;
                if (!progress) progress = applyHiddenSingles(cands) || progress;
                if (!progress) progress = applyLockedCandidates(cands) || progress;
                if (!progress) progress = applyNakedPairs(cands) || progress;
                if (!progress) {
                    // No supported technique can advance — mark as expert+
                    if (hardest < 4) hardest = 4;
                    break;
                }
            }

            const solved = g.every(v => v !== 0);
            const remainingUnsolvedCells = g.filter(v => v === 0).length;
            // Clamp hardest to 0 if nothing fired (all cells were already given)
            if (hardest < 0) hardest = 0;
            const techName = ['naked single', 'hidden single', 'locked candidates', 'naked pair', 'expert+'][hardest] || 'unknown';

            // Rating map
            let rating;
            if (hardest === 0) rating = 'easy';
            else if (hardest <= 2) rating = 'medium';
            else rating = 'hard';   // hardest 3 (naked pair) or 4 (expert+)

            console.log(
                `  rateLogical: solved=${solved} hardest="${techName}"(${hardest})` +
                ` remainingCells=${remainingUnsolvedCells} → rated="${rating}"`
            );

            return { rating, techName, solved, hardest, remainingUnsolvedCells };
        },

        _eliminatePeers(cands, idx, val) {
            const row = Math.floor(idx / 9), col = idx % 9;
            const sr = Math.floor(row/3)*3, sc = Math.floor(col/3)*3;
            for (let i = 0; i < 9; i++) {
                cands[row*9+i].delete(val);
                cands[i*9+col].delete(val);
            }
            for (let i = 0; i < 3; i++)
                for (let j = 0; j < 3; j++)
                    cands[(sr+i)*9+(sc+j)].delete(val);
            cands[idx].clear();
        },

        _allUnits() {
            const units = [];
            for (let i = 0; i < 9; i++) {
                const row = [], col = [], box = [];
                for (let j = 0; j < 9; j++) {
                    row.push(i*9+j);
                    col.push(j*9+i);
                    const br = Math.floor(i/3)*3, bc = (i%3)*3;
                    box.push((br + Math.floor(j/3))*9 + (bc + j%3));
                }
                units.push(row, col, box);
            }
            return units;
        },

        // ── One generation attempt (synchronous inner loop) ───────────────────
        // Returns accepted puzzle or null if time exceeded.
        // deadline = performance.now() value after which we must stop.
        _tryGenerate(difficulty, cfg, deadline) {
            const [rMin, rMax] = cfg.removeRange;
            let attempts = 0;

            while (performance.now() < deadline) {
                attempts++;
                const solved = new Array(81).fill(0);
                fillGrid(solved);

                const targetRemove = rMin + Math.floor(Math.random() * (rMax - rMin + 1));
                const puzzle = [...solved];
                this.removeCellsUnique(puzzle, targetRemove);
                const clueCount = puzzle.filter(v => v !== 0).length;

                // Uniqueness (already guaranteed by removeCellsUnique, but double-check)
                const sols = this.countSolutions(puzzle, 2);
                if (sols !== 1) {
                    console.log(`Game: ${difficulty} rejected — uniqueness=${sols}, attempt ${attempts}`);
                    continue;
                }

                const { rating, techName, solved: logicSolved, hardest, remainingUnsolvedCells } = this.rateLogical(puzzle);

                // For hard: allow expert+ (unsolvable by supported techniques) since
                // uniqueness is confirmed — it IS solvable, just needs bifurcation.
                // Reject only if it rated easy or medium.
                if (rating !== difficulty) {
                    console.log(`Game: ${difficulty} rejected — rated="${rating}" tech="${techName}" clues=${clueCount} attempt=${attempts}`);
                    continue;
                }

                // Extra guard: hard must NOT be solvable by singles alone
                if (difficulty === 'hard' && hardest <= 1) {
                    console.log(`Game: hard rejected — solvable by singles (hardest=${hardest}), attempt ${attempts}`);
                    continue;
                }

                console.log(`Game: ${difficulty} accepted — ${clueCount} clues, tech="${techName}", attempts=${attempts}`);
                return { grid: puzzle, solved, clueCount, rating, techName, attempts, hardest };
            }
            return null; // time expired
        },

        // ── Verified hard fallback ────────────────────────────────────────────
        // Called when _tryGenerate times out. Tries a quick extra burst with
        // looser time (200ms more) then builds a minimum-guarantee hard puzzle.
        _hardFallback(deadline) {
            // Extra 200ms burst
            const extended = deadline + 200;
            const cfgHard = { removeRange: [50, 56] };
            const result = this._tryGenerate('hard', cfgHard, extended);
            if (result) {
                console.log(`Game: hard accepted via extended fallback — ${result.clueCount} clues`);
                return result;
            }

            // Last resort: keep generating until we find ANY puzzle with hardest>=3
            // (no time limit — guaranteed to terminate within ~5 attempts statistically)
            console.warn('Game: hard — using last-resort fallback, generating until hardest>=3');
            let safeAttempts = 0;
            while (safeAttempts < 200) {
                safeAttempts++;
                const solved = new Array(81).fill(0);
                fillGrid(solved);
                const puzzle = [...solved];
                this.removeCellsUnique(puzzle, 53);
                if (this.countSolutions(puzzle, 2) !== 1) continue;
                const { rating, techName, hardest } = this.rateLogical(puzzle);
                if (hardest < 3) continue; // not hard enough
                const clueCount = puzzle.filter(v => v !== 0).length;
                console.log(`Game: hard last-resort accepted — ${clueCount} clues, tech="${techName}", safeAttempts=${safeAttempts}`);
                return { grid: puzzle, solved, clueCount, rating: 'hard', techName, attempts: safeAttempts, hardest };
            }

            // Absolute last resort (should be statistically unreachable)
            console.error('Game: hard — absolute last resort, returning best-effort puzzle');
            const solved = new Array(81).fill(0);
            fillGrid(solved);
            const puzzle = [...solved];
            this.removeCellsUnique(puzzle, 53);
            const clueCount = puzzle.filter(v => v !== 0).length;
            return { grid: puzzle, solved, clueCount, rating: 'hard', techName: 'last-resort', attempts: 999, hardest: 3 };
        },

        // ── Main generate function ────────────────────────────────────────────
        // Returns { grid, solved, clueCount, rating, techName, attempts, hardest }
        // Time-guarded: will not freeze UI. For easy/medium fallback returns
        // best-effort puzzle (may be a different rating in extreme edge cases).
        generate(difficulty) {
            const config = {
                // easy: solvable by naked singles; 32-40 removals
                easy:   { removeRange: [32, 40], timeLimitMs: 300 },
                // medium: needs hidden singles; 42-50 removals
                medium: { removeRange: [42, 50], timeLimitMs: 400 },
                // hard: needs pairs/expert; 50-56 removals
                hard:   { removeRange: [50, 56], timeLimitMs: 400 }
            };
            const cfg = config[difficulty] || config.easy;
            const deadline = performance.now() + cfg.timeLimitMs;

            const result = this._tryGenerate(difficulty, cfg, deadline);
            if (result) return result;

            // Time expired — difficulty-specific fallback
            console.warn(`Game: ${difficulty} — time limit (${cfg.timeLimitMs}ms) reached, using fallback`);

            if (difficulty === 'hard') {
                return this._hardFallback(deadline);
            }

            // Easy/medium fallback: generate any puzzle in the removal range,
            // verify uniqueness, log actual rating (may differ from requested).
            let fbAttempts = 0;
            while (fbAttempts < 30) {
                fbAttempts++;
                const solved = new Array(81).fill(0);
                fillGrid(solved);
                const [rMin, rMax] = cfg.removeRange;
                const puzzle = [...solved];
                this.removeCellsUnique(puzzle, Math.round((rMin + rMax) / 2));
                if (this.countSolutions(puzzle, 2) !== 1) continue;
                const { rating: actualRating, techName } = this.rateLogical(puzzle);
                const clueCount = puzzle.filter(v => v !== 0).length;
                console.log(`Game: ${difficulty} fallback accepted — clues=${clueCount} actualRating="${actualRating}" tech="${techName}" (requested: ${difficulty})`);
                return { grid: puzzle, solved, clueCount, rating: actualRating, techName, attempts: fbAttempts, hardest: -1 };
            }

            // Absolute last resort for easy/medium
            const fbSolved = new Array(81).fill(0);
            fillGrid(fbSolved);
            const fbPuzzle = [...fbSolved];
            const [rMin, rMax] = cfg.removeRange;
            this.removeCellsUnique(fbPuzzle, Math.round((rMin + rMax) / 2));
            const fbClues = fbPuzzle.filter(v => v !== 0).length;
            return { grid: fbPuzzle, solved: fbSolved, clueCount: fbClues, rating: difficulty, techName: 'last-resort', attempts: 999, hardest: -1 };
        }
    };


    /**
     * Checks if placing a number in a specific index violates any Sudoku rules
     * (i.e. checking if the number already exists in its row, column, or 3x3 subgrid).
     * 
     * @param {number[]} grid - The 1D array representing the board.
     * @param {number} index - The index (0-80) where the number is being placed.
     * @param {number} num - The number (1-9) to check.
     * @returns {boolean} - True if the move is valid, false otherwise.
     * 
     * Example:
     * // Check if placing '5' at the top-left cell (index 0) is valid:
     * let isValidMove = isValid(grid, 0, 5); 
     */
    function isValid(grid, index, num) {
        const row = Math.floor(index / 9);
        const col = index % 9;

        for (let i = 0; i < 9; i++) {
            if (grid[row * 9 + i] === num) return false;
            if (grid[i * 9 + col] === num) return false;
        }

        const startRow = Math.floor(row / 3) * 3;
        const startCol = Math.floor(col / 3) * 3;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                if (grid[(startRow + i) * 9 + (startCol + j)] === num) return false;
            }
        }
        return true;
    }

    // ═══════════════════════════════════════════════
    //  SAVE / LOAD GAME STATE
    // ═══════════════════════════════════════════════

    function saveGameState() {
        try {
            const cells = Array.from(board.children);
            const cellStates = cells.map(c => ({
                value: c.dataset.value || '',
                notes: c.dataset.notes || '',
                prefilled: c.classList.contains('prefilled'),
                userInput: c.classList.contains('user-input')
            }));
            const state = {
                cellStates,
                solvedGrid: [...solvedGrid],
                mistakes,
                undosRemaining,
                hintsRemaining,
                autoCheckUsedThisPuzzle,
                secondsElapsed,
                currentLevel,
                selectedDifficulty,
                isDailyChallenge,
                activeDailyChallengeDateKey,
                hintsUsedThisGame,
                mistakesThisGame,
                timestamp: Date.now()
            };
            localStorage.setItem('sudoku-saved-game', JSON.stringify(state));
        } catch (e) {
            console.warn('Failed to save game state:', e);
        }
    }

    function loadSavedGame() {
        try {
            const raw = localStorage.getItem('sudoku-saved-game');
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            console.warn('Failed to load saved game:', e);
            return null;
        }
    }

    function hasSavedGame() {
        return loadSavedGame() !== null;
    }

    function clearSavedGame() {
        localStorage.removeItem('sudoku-saved-game');
    }

    function restoreGame(savedState) {
        const cells = Array.from(board.children);
        completedGroupsTracker.clear();

        // Restore solved grid
        solvedGrid = savedState.solvedGrid || [];
        mistakes = savedState.mistakes || 0;
        undosRemaining = savedState.undosRemaining != null ? savedState.undosRemaining : MAX_UNDOS;
        hintsRemaining = savedState.hintsRemaining != null ? savedState.hintsRemaining : MAX_HINTS;
        autoCheckUsedThisPuzzle = savedState.autoCheckUsedThisPuzzle || 0;
        updateAutoCheckUI();
        secondsElapsed = savedState.secondsElapsed || 0;
        currentLevel = savedState.currentLevel || currentLevel;
        isDailyChallenge = savedState.isDailyChallenge || false;
        activeDailyChallengeDateKey = savedState.activeDailyChallengeDateKey || null;
        hintsUsedThisGame = savedState.hintsUsedThisGame || 0;
        mistakesThisGame = savedState.mistakesThisGame || 0;
        mistakeRescueUsedThisGame = false;
        isMistakeRescueRequestInProgress = false;

        if (typeof AdMobService !== 'undefined') {
            if (mistakes === MAX_MISTAKES - 1 && !mistakeRescueUsedThisGame && !window.isPremium) {
                AdMobService.prepareRewarded('MISTAKE_RESCUE');
            } else if (hintsRemaining <= 0 && !window.isPremium) {
                AdMobService.prepareRewarded('HINT');
            }
        }
        undoStack = [];

        // Restore difficulty selection
        if (savedState.selectedDifficulty) {
            selectedDifficulty = savedState.selectedDifficulty;
            updateDifficultyUI();
        }

        // Restore cell states
        cells.forEach((c, i) => {
            c.textContent = '';
            c.dataset.value = '';
            c.dataset.notes = '';
            c.classList.remove('prefilled', 'user-input', 'error', 'crosshair', 'tutorial-highlight', 'tutorial-dim', 'locked-group');

            const cs = savedState.cellStates[i];
            if (!cs) return;

            if (cs.prefilled && cs.value) {
                c.textContent = cs.value;
                c.dataset.value = cs.value;
                c.classList.add('prefilled');
            } else if (cs.userInput && cs.value) {
                c.textContent = cs.value;
                c.dataset.value = cs.value;
                c.classList.add('user-input');
            } else if (cs.notes) {
                c.dataset.notes = cs.notes;
                renderNotes(c);
            }
        });

        // Restore difficulty badge in separate row
        const badgeRow = document.getElementById('difficulty-badge-row');
        const badgeMap = {
            'easy':   { label: 'Easy',   cls: 'diff-badge-easy' },
            'medium': { label: 'Medium', cls: 'diff-badge-medium' },
            'hard':   { label: 'Hard',   cls: 'diff-badge-hard' }
        };
        if (badgeRow) {
            if (isDailyChallenge) {
                badgeRow.innerHTML = `<span class="difficulty-badge diff-badge-daily">Daily</span>`;
            } else {
                const b = badgeMap[selectedDifficulty] || badgeMap['easy'];
                badgeRow.innerHTML = `<span class="difficulty-badge ${b.cls}">${b.label}</span>`;
            }
        }
        if (levelDisplay) {
            levelDisplay.textContent = `Level ${currentLevel}`;
        }

        updateMistakeUI();
        updateUndoUI();
        updateHintUI();
        updateLevelUI();
        validateBoard();
        resumeTimer();
    }

    // ═══════════════════════════════════════════════
    //  HOME SCREEN BUTTON BINDINGS
    // ═══════════════════════════════════════════════
    let isAbandonNavigationInProgress = false;
    async function goHomeFromActiveGameWithAd() {
        if (isAbandonNavigationInProgress) return;
        isAbandonNavigationInProgress = true;

        try {
            const wasPausedBeforePrompt = isPaused;

            if (wasPausedBeforePrompt && pauseModal) {
                pauseModal.classList.remove('has-native-ad');
                pauseModal.classList.add('hidden');
                if (typeof AdMobService !== 'undefined') {
                    AdMobService.hideNativeAd();
                }
            }

            const shouldLeave = await showRewardAdModal({
                icon: "🏠",
                title: "Go to Home?",
                message: "Your puzzle progress will be saved before leaving.",
                confirmText: "Go Home",
                cancelText: "Keep Playing"
            });

            if (!shouldLeave) {
                if (wasPausedBeforePrompt && pauseModal) {
                    const isNativePauseEligible = !window.isPremium && typeof AdMobService !== 'undefined' && AdMobService.isFeatureEnabled('pause_native_ad_enabled');
                    if (isNativePauseEligible) {
                        pauseModal.classList.add('has-native-ad');
                    }
                    pauseModal.classList.remove('hidden');
                    if (typeof AdMobService !== 'undefined') {
                        AdMobService.showNativeAd('pause');
                    }
                }
                return;
            }

            saveGameState();

            if (typeof AdMobService !== "undefined") {
                await AdMobService.showAbandonInterstitialAd();
            }

            if (isPaused) {
                isPaused = false;
                gameScreen.classList.remove('paused');
                updatePauseBtnUI(false);
                if (pauseModal) pauseModal.classList.add('hidden');
            }

            stopTimer();
            showView('home');
        } finally {
            isAbandonNavigationInProgress = false;
        }
    }
    function updateContinueButton() {
        const saved = loadSavedGame();
        const heroCard = document.getElementById('home-hero-card');
        const heroActive = document.getElementById('home-hero-active');
        const heroEmpty = document.getElementById('home-hero-empty');
        const streakEl = document.getElementById('home-streak-count');

        // Update header streak counter
        if (streakEl) {
            const currentStreak = (typeof StatsEngine !== 'undefined' && StatsEngine.stats && StatsEngine.stats.currentStreak) 
                ? StatsEngine.stats.currentStreak 
                : 0;
            streakEl.textContent = currentStreak;
        }

        // Update daily challenge streak badge text
        const dailyStreakSafeBadge = document.getElementById('daily-streak-badge-text');
        if (dailyStreakSafeBadge) {
            const streak = (typeof DailyChallengeEngine !== 'undefined' && typeof DailyChallengeEngine.getStreak === 'function')
                ? DailyChallengeEngine.getStreak()
                : ((typeof StatsEngine !== 'undefined' && StatsEngine.stats) ? StatsEngine.stats.currentStreak : 0);
            dailyStreakSafeBadge.textContent = streak > 0 ? `${streak}-Day Streak` : 'Daily Puzzle';
        }

        let hasActiveGame = false;
        if (saved && Array.isArray(saved.cellStates) && saved.cellStates.length === 81) {
            hasActiveGame = true;

            // Player-target cells exclude original prefilled Sudoku clues
            const playerCells = saved.cellStates.filter(c => !c.prefilled);
            const totalPlayerCells = playerCells.length > 0 ? playerCells.length : 81;

            // Count player-completed cells (non-prefilled with non-empty value)
            const completedPlayerCells = playerCells.filter(c => c && c.value && String(c.value).trim() !== '' && String(c.value) !== '0').length;
            const pct = Math.min(100, Math.round((completedPlayerCells / totalPlayerCells) * 100));

            const minutes = Math.floor((saved.secondsElapsed || 0) / 60);
            const seconds = (saved.secondsElapsed || 0) % 60;
            const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            const diffCapitalized = (saved.selectedDifficulty || 'medium').charAt(0).toUpperCase() + (saved.selectedDifficulty || 'medium').slice(1);

            const heroStatusBadge = document.getElementById('hero-status-badge');
            if (heroStatusBadge) heroStatusBadge.textContent = `${diffCapitalized} • In Progress`;

            const heroProgressPct = document.getElementById('hero-progress-pct');
            if (heroProgressPct) heroProgressPct.textContent = `${completedPlayerCells} of ${totalPlayerCells} solved (${pct}%)`;

            const heroProgressBar = document.getElementById('hero-progress-bar');
            if (heroProgressBar) heroProgressBar.style.width = `${pct}%`;

            const heroStatTimer = document.getElementById('hero-stat-timer');
            if (heroStatTimer) heroStatTimer.textContent = timeStr;

            const heroStatMistakes = document.getElementById('hero-stat-mistakes');
            if (heroStatMistakes) heroStatMistakes.textContent = `${saved.mistakes || 0} / 3`;

            const heroStatLevel = document.getElementById('hero-stat-level');
            if (heroStatLevel) heroStatLevel.textContent = `Level ${saved.currentLevel || 1}`;
        }

        if (hasActiveGame) {
            if (heroCard) heroCard.classList.remove('hidden');
            if (heroActive) heroActive.classList.remove('hidden');
            if (heroEmpty) heroEmpty.classList.add('hidden');
            if (continueGameBtn) continueGameBtn.disabled = false;
        } else {
            if (heroCard) heroCard.classList.add('hidden');
            if (heroActive) heroActive.classList.add('hidden');
            if (heroEmpty) heroEmpty.classList.remove('hidden');
            if (continueGameBtn) continueGameBtn.disabled = true;
        }
    }

    // Continue Game
    if (continueGameBtn) {
        continueGameBtn.addEventListener('click', () => {
            const saved = loadSavedGame();
            if (!saved) return;
            restoreGame(saved);
            showView('game');
        });
    }

    // New Game from Home
    if (newGameHomeBtn) {
        newGameHomeBtn.addEventListener('click', () => {
            startNewGame();
            saveGameState();
            showView('game');
        });
    }

    // Pause button
    if (gamePauseBtn) {
        gamePauseBtn.addEventListener('click', () => {
            if (isPaused) resumeGame(); else pauseGame();
        });
    }

    // Pause modal — Resume
    if (pauseResumeBtn) {
        pauseResumeBtn.addEventListener('click', () => resumeGame());
    }

    // Pause modal — Close button (resumes game)
    if (pauseCloseBtn) {
        pauseCloseBtn.addEventListener('click', () => resumeGame());
    }

    // Pause modal — Go to Home
    if (pauseHomeBtn) {
        pauseHomeBtn.addEventListener('click', () => {
            goHomeFromActiveGameWithAd();
        });
    }

    // Home Back Button (game screen → home)
    if (homeBackBtn) {
    homeBackBtn.addEventListener('click', () => {
        goHomeFromActiveGameWithAd();
    });
}

    // Daily Challenge — real engine
    const dailyChallengeModal = document.getElementById('daily-challenge-modal');
    const closeDailyBtn = document.getElementById('close-daily-btn');
    const dailyPlayBtn = document.getElementById('daily-play-btn');

    if (dailyChallengeBtn) {
        dailyChallengeBtn.addEventListener('click', () => {
            DailyChallengeEngine.openModal();
            if (!window.isPremium && typeof AdMobService !== 'undefined') AdMobService.prepareRewarded('DAILY_CHALLENGE');
            if (typeof AdMobService !== 'undefined') AdMobService.showNativeAd('daily_challenge');
        });
    }

    const calPrevBtn = document.getElementById('cal-prev-btn');
    const calNextBtn = document.getElementById('cal-next-btn');

    if (calPrevBtn) {
        calPrevBtn.addEventListener('click', () => {
            DailyChallengeEngine.navigateMonth(-1);
        });
    }

    if (calNextBtn) {
        calNextBtn.addEventListener('click', () => {
            DailyChallengeEngine.navigateMonth(1);
        });
    }

    if (closeDailyBtn) {
        closeDailyBtn.addEventListener('click', () => {
            if (dailyChallengeModal) dailyChallengeModal.classList.add('hidden');
            if (typeof AdMobService !== 'undefined') {
                AdMobService.disposeRewarded('DAILY_CHALLENGE', 'OPPORTUNITY_LEFT');
                AdMobService.hideNativeAd();
            }
            if (!homeScreen.classList.contains('hidden-view') && typeof AdMobService !== 'undefined') {
                AdMobService.showNativeAd('home');
            }
        });
    }

    if (dailyPlayBtn) {
        dailyPlayBtn.addEventListener('click', async () => {
            if (dailyPlayBtn.disabled) return;

            const targetDateKey = DailyChallengeEngine.selectedDateKey || DailyChallengeEngine.todayKey();
            const isCompleted = DailyChallengeEngine.isCompleted(targetDateKey);

            // Guard against duplicate taps
            dailyPlayBtn.disabled = true;

            try {
                console.log(`[DailyAd] Play Now tapped. Selected date: ${targetDateKey}, isCompleted: ${isCompleted}, isPremium: ${!!window.isPremium}`);

                // If the user already has a saved in-progress regular game, preserve it silently
                const saved = loadSavedGame();
                if (saved && !saved.isDailyChallenge) {
                    saveGameState();
                }

                // If user is premium or already completed this date: free to play immediately without ad
                if (window.isPremium || isCompleted) {
                    console.log(`[DailyAd] Bypassing ad (isPremium=${!!window.isPremium}, isCompleted=${isCompleted})`);
                    if (dailyChallengeModal) dailyChallengeModal.classList.add('hidden');
                    if (typeof AdMobService !== 'undefined') AdMobService.hideNativeAd();

                    activeDailyChallengeDateKey = targetDateKey;
                    const dailyData = DailyChallengeEngine.generateForDate(targetDateKey);
                    startNewGame(dailyData);
                    saveGameState();
                    showView('game');
                    return;
                }

                // Free user on uncompleted challenge:
                // Hide native ad while rewarded ad loading overlay and ad run
                if (typeof AdMobService !== 'undefined') AdMobService.hideNativeAd();

                // 1. Show ad preparation overlay IMMEDIATELY
                if (typeof AdMobService !== 'undefined') {
                    await AdMobService.showAdLoadingOverlay({
                        icon: "event",
                        title: "Preparing Advertisement",
                        message: "Preparing today's challenge advertisement."
                    });
                }

                // 2. Launch rewarded advertisement
                let adResult = { success: false, reason: 'uninitialized' };
                if (typeof AdMobService !== 'undefined') {
                    const rawResult = await AdMobService.showDailyChallengeRewardedAd();
                    if (typeof rawResult === 'boolean') {
                        adResult = { success: rawResult, reason: rawResult ? 'reward_earned' : 'failed' };
                    } else if (rawResult && typeof rawResult === 'object') {
                        adResult = rawResult;
                    }
                }

                console.log("[DailyAd] Ad execution result:", adResult);

                // 3. Branch on outcome with distinct user feedback
                if (adResult.success) {
                    // Confirmed reward: start selected puzzle
                    console.log("[DailyAd] Confirmed reward. Starting Daily Challenge puzzle for:", targetDateKey);
                    if (dailyChallengeModal) dailyChallengeModal.classList.add('hidden');
                    activeDailyChallengeDateKey = targetDateKey;
                    const dailyData = DailyChallengeEngine.generateForDate(targetDateKey);
                    startNewGame(dailyData);
                    saveGameState();
                    showView('game');
                } else {
                    // Re-show native ad if applicable
                    if (typeof AdMobService !== 'undefined') {
                        AdMobService.hideAdLoadingOverlay();
                        AdMobService.showNativeAd('daily_challenge');
                    }

                    const statusLabel = document.getElementById('cal-selected-status');

                    if (adResult.reason === 'user_cancelled_before_reward') {
                        console.log("[DailyAd] Ad dismissed before reward completion");
                        if (statusLabel) {
                            statusLabel.textContent = "Ad was not completed • Tap Play Now to retry";
                        }
                        showToast("Watch the full ad to unlock the challenge.");
                    } else if (adResult.reason === 'failed_to_load' || adResult.reason === 'failed_to_show' || adResult.reason === 'missing_ad_unit_id') {
                        console.warn("[DailyAd] Ad unavailable (load/show failure):", adResult.reason);
                        if (statusLabel) {
                            statusLabel.textContent = "Advertisement unavailable • Tap Play Now to retry";
                        }
                        showToast("Advertisement unavailable. Please check your connection and try again.");
                    } else if (adResult.reason === 'disabled_by_remote_config') {
                        console.log("[DailyAd] Rewarded ad disabled by Remote Config. Granting free entry.");
                        if (dailyChallengeModal) dailyChallengeModal.classList.add('hidden');
                        activeDailyChallengeDateKey = targetDateKey;
                        const dailyData = DailyChallengeEngine.generateForDate(targetDateKey);
                        startNewGame(dailyData);
                        saveGameState();
                        showView('game');
                        return;
                    } else {
                        console.warn("[DailyAd] Ad not completed. Reason:", adResult.reason);
                        if (statusLabel) {
                            statusLabel.textContent = "Could not load ad • Tap Play Now to retry";
                        }
                        showToast("Could not load advertisement. Please try again.");
                    }
                }
            } catch (err) {
                console.error("[DailyAd] Daily Challenge Play Now unexpected error:", err);
                if (typeof AdMobService !== 'undefined') {
                    AdMobService.hideAdLoadingOverlay();
                    AdMobService.showNativeAd('daily_challenge');
                }
                const statusLabel = document.getElementById('cal-selected-status');
                if (statusLabel) {
                    statusLabel.textContent = "Error preparing ad • Tap Play Now to retry";
                }
                showToast("Could not prepare advertisement. Please try again.");
            } finally {
                dailyPlayBtn.disabled = false;
            }
        });
    }

    // Home Stats → open existing stats modal
    if (homeStatsBtn) {
        homeStatsBtn.addEventListener('click', () => {
            StatsEngine.updateUI();
            if (statsModal) statsModal.classList.remove('hidden');
        });
    }

    // Achievements — real engine
    const achievementsModal = document.getElementById('achievements-modal');
    const closeAchievementsBtn = document.getElementById('close-achievements-btn');

    if (achievementsBtn) {
        achievementsBtn.addEventListener('click', () => {
            AchievementsEngine.openModal();
            if (typeof AdMobService !== 'undefined') AdMobService.showNativeAd('achievements');
        });
    }

    if (closeAchievementsBtn) {
        closeAchievementsBtn.addEventListener('click', () => {
            if (achievementsModal) achievementsModal.classList.add('hidden');
            if (typeof AdMobService !== 'undefined') AdMobService.hideNativeAd();
            if (!homeScreen.classList.contains('hidden-view') && typeof AdMobService !== 'undefined') {
                AdMobService.showNativeAd('home');
            }
            if (typeof ReviewPromptManager !== 'undefined' && ReviewPromptManager._newAchievementsThisSession) {
                ReviewPromptManager._newAchievementsThisSession = false;
                ReviewPromptManager.triggerIfEligible('achievement_unlocked');
            }
        });
    }

    // Settings manual Rate & Share entries
    const settingsRateBtn = document.getElementById('settings-rate-btn');
    if (settingsRateBtn) {
        settingsRateBtn.addEventListener('click', () => {
            if (typeof ReviewPromptManager !== 'undefined') {
                ReviewPromptManager.openManualStoreRating('settings');
            }
        });
    }

    const settingsShareBtn = document.getElementById('settings-share-btn');
    if (settingsShareBtn) {
        settingsShareBtn.addEventListener('click', () => {
            if (typeof ReviewPromptManager !== 'undefined') {
                ReviewPromptManager.openManualShare();
            }
        });
    }

    // Home subtle Rate entry
    const homeRateBtn = document.getElementById('home-rate-btn');
    if (homeRateBtn) {
        homeRateBtn.addEventListener('click', () => {
            if (typeof ReviewPromptManager !== 'undefined') {
                ReviewPromptManager.openManualStoreRating('home');
            }
        });
    }

    // Home Settings → open existing settings modal
    if (homeSettingsBtn) {
        homeSettingsBtn.addEventListener('click', () => {
            ThemeEngine.updateSettingsUI();
            updatePrivacyChoicesVisibility();
            if (settingsModal) settingsModal.classList.remove('hidden');
            if (!window.isPremium && typeof AdMobService !== 'undefined') AdMobService.prepareRewarded('THEME_UNLOCK');
            if (typeof AdMobService !== 'undefined') AdMobService.hideNativeAd();
        });
    }

    // Home Profile Button → open stats modal
    const homeProfileBtn = document.getElementById('home-profile-btn');
    if (homeProfileBtn) {
        homeProfileBtn.addEventListener('click', () => {
            StatsEngine.updateUI();
            if (statsModal) statsModal.classList.remove('hidden');
        });
    }

    // Home Bottom Navigation Tabs
    const navTabHome = document.getElementById('nav-tab-home');
    if (navTabHome) {
        navTabHome.addEventListener('click', () => {
            if (homeScreen) {
                homeScreen.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    }

    const navTabDaily = document.getElementById('nav-tab-daily');
    if (navTabDaily) {
        navTabDaily.addEventListener('click', () => {
            DailyChallengeEngine.openModal();
            if (!window.isPremium && typeof AdMobService !== 'undefined') AdMobService.prepareRewarded('DAILY_CHALLENGE');
            if (typeof AdMobService !== 'undefined') AdMobService.showNativeAd('daily_challenge');
        });
    }

    // ═══════════════════════════════════════════════
    //  STARTUP
    // ═══════════════════════════════════════════════

    // Initialize UI state (but do NOT auto-start a game)
    ThemeEngine.init();
    updateLevelUI();
    updateUndoUI();
    updateHintUI();
    updateAutoCheckUI();
    updateContinueButton();

    // Android hardware Back Button listener
    try {
        const handleHardwareBack = () => {
            if (typeof window.UpdateManager !== 'undefined' && window.UpdateManager.isMandatoryUpdateActive()) {
                console.log("[BackNavigation] Ignored: mandatory update active");
                return;
            }
            if (isPaused && pauseModal && !pauseModal.classList.contains('hidden')) {
                console.log("[BackNavigation] triggered (pause modal)");
                resumeGame();
                return;
            }
            if (settingsModal && !settingsModal.classList.contains('hidden')) {
                console.log("[BackNavigation] triggered (settings modal)");
                settingsModal.classList.add('hidden');
                if (!homeScreen.classList.contains('hidden-view') && typeof AdMobService !== 'undefined') {
                    AdMobService.showNativeAd('home');
                }
                return;
            }
            if (statsModal && !statsModal.classList.contains('hidden')) {
                console.log("[BackNavigation] triggered (stats modal)");
                statsModal.classList.add('hidden');
                return;
            }
            if (achievementsModal && !achievementsModal.classList.contains('hidden')) {
                console.log("[BackNavigation] triggered (achievements modal)");
                achievementsModal.classList.add('hidden');
                if (typeof AdMobService !== 'undefined') AdMobService.hideNativeAd();
                if (!homeScreen.classList.contains('hidden-view') && typeof AdMobService !== 'undefined') {
                    AdMobService.showNativeAd('home');
                }
                if (typeof ReviewPromptManager !== 'undefined' && ReviewPromptManager._newAchievementsThisSession) {
                    ReviewPromptManager._newAchievementsThisSession = false;
                    ReviewPromptManager.triggerIfEligible('achievement_unlocked');
                }
                return;
            }
            if (dailyChallengeModal && !dailyChallengeModal.classList.contains('hidden')) {
                console.log("[BackNavigation] triggered (daily challenge modal)");
                if (typeof DailyChallengeEngine !== 'undefined') DailyChallengeEngine.closeModal();
                if (typeof AdMobService !== 'undefined') AdMobService.hideNativeAd();
                if (!homeScreen.classList.contains('hidden-view') && typeof AdMobService !== 'undefined') {
                    AdMobService.showNativeAd('home');
                }
                return;
            }
            if (victoryModal && !victoryModal.classList.contains('hidden')) {
                console.log("[BackNavigation] triggered (victory modal)");
                victoryModal.classList.add('hidden');
                showView('home');
                return;
            }
            if (!gameScreen.classList.contains('hidden-view')) {
                console.log("[BackNavigation] triggered (gameplay to home)");
                goHomeFromActiveGameWithAd();
                return;
            }
        };

        const CapApp = window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins.App : null;
        if (CapApp && typeof CapApp.addListener === 'function') {
            CapApp.addListener('backButton', handleHardwareBack);
        }
        document.addEventListener('backbutton', handleHardwareBack);
    } catch (e) {
        console.warn('Back button listener registration error:', e);
    }

    // Coordinated Splash Screen & Home Transition
    const webSplashScreen = document.getElementById('web-splash-screen');
    const phase1 = document.getElementById('splash-phase-1');
    const phase2 = document.getElementById('splash-phase-2');

    let hasRevealedHome = false;
    const revealHomeScreen = () => {
        if (hasRevealedHome) return;
        if (UpdateManager.isMandatoryUpdateActive()) {
            console.log("[Startup] Home reveal blocked by mandatory update.");
            return;
        }
        hasRevealedHome = true;

        if (webSplashScreen) {
            webSplashScreen.classList.add('fade-out');
            setTimeout(() => {
                webSplashScreen.style.display = 'none';
            }, 500);
        }

        console.log("[Startup] home_view_ready");
        console.log("[Startup] initial_ad_request");
        showView('home');
        trackEvent('app_web_started');

        // Check for flexible update on Home reveal
        UpdateManager.checkStartupUpdate().catch(() => {});

        // Auto-launch tutorial on first visit (only after consent has been accepted)
        if (localStorage.getItem('sudoku-consent-accepted') && !localStorage.getItem('sudoku-tutorial-seen')) {
            showTutorial();
            localStorage.setItem('sudoku-tutorial-seen', 'true');
        }
    };

    if (webSplashScreen && phase1 && phase2) {
        // Optimized splash timing: returning sessions feel snappy (~1.5s), first launches keep full branding
        const isReturningSession = !!(
            localStorage.getItem('sudoku-consent-accepted') ||
            (typeof ReviewPromptManager !== 'undefined' && ReviewPromptManager.getState().sessionCount > 1)
        );

        const phase1Duration = isReturningSession ? 750 : 1400;
        const appOpenWaitMs = isReturningSession ? 1200 : 2200;
        const phase2FallbackHoldMs = isReturningSession ? 750 : 1500;

        setTimeout(() => {
            phase1.classList.add('fade-out');
            phase2.classList.add('active'); // Triggers Phase 2

            (async () => {
                // Priority 1: Check mandatory update before any ads or home initialization
                const updateDecision = await UpdateManager.checkStartupUpdate();
                if (updateDecision && updateDecision.isMandatory) {
                    console.log("[Startup] Normal startup halted by mandatory update.");
                    if (webSplashScreen) {
                        webSplashScreen.classList.add('fade-out');
                        setTimeout(() => { webSplashScreen.style.display = 'none'; }, 500);
                    }
                    return;
                }

                if (!window.isPremium && typeof AdMobService !== 'undefined' && AdMobService.isFeatureEnabled('app_open_ads_enabled')) {
                    // Check if App Open is ready within the startup window
                    const isReady = await AdMobService.waitForAppOpenAvailable(appOpenWaitMs, 150);
                    if (isReady && !hasRevealedHome && !window.isPremium) {
                        console.log("[AppOpen] ready");
                        console.log("[AppOpen] shown");
                        
                        const AppOpenAd = AdMobService.getAppOpenAdPlugin();
                        let dismissListener = null;
                        if (AppOpenAd && AppOpenAd.addListener) {
                            dismissListener = await AppOpenAd.addListener("appOpenDismissed", () => {
                                console.log("[AppOpen] dismissed");
                                if (dismissListener && dismissListener.remove) dismissListener.remove();
                                revealHomeScreen();
                            });
                        }

                        const shown = await AdMobService.showAppOpenAd({ context: 'cold_start', ignoreGameplayCheck: true });
                        if (!shown) {
                            console.log("[AppOpen] skipped reason=show_failed");
                            if (typeof AdMobService !== 'undefined' && typeof AdMobService.notifyColdStartExpired === 'function') {
                                AdMobService.notifyColdStartExpired();
                            }
                            revealHomeScreen();
                        }
                        return;
                    } else {
                        console.log("[AppOpen] skipped reason=not_ready_within_startup_window");
                        if (typeof AdMobService !== 'undefined' && typeof AdMobService.notifyColdStartExpired === 'function') {
                            AdMobService.notifyColdStartExpired();
                        }
                    }
                }

                // If not eligible or not ready, complete splash intro and reveal home cleanly
                setTimeout(() => {
                    if (typeof AdMobService !== 'undefined' && typeof AdMobService.notifyColdStartExpired === 'function') {
                        AdMobService.notifyColdStartExpired();
                    }
                    revealHomeScreen();
                }, phase2FallbackHoldMs);
            })();
        }, phase1Duration);
    } else {
        (async () => {
            const updateDecision = await UpdateManager.checkStartupUpdate();
            if (updateDecision && updateDecision.isMandatory) {
                console.log("[Startup] Normal startup halted by mandatory update.");
                return;
            }
            revealHomeScreen();
        })();
    }
});
