document.addEventListener('DOMContentLoaded', () => {
    // ═══════════════════════════════════════════════
    //  VIEW SWITCHING
    // ═══════════════════════════════════════════════

    const homeScreen = document.getElementById('home-screen');
    const gameScreen = document.getElementById('game-screen');

    function showView(viewName) {
        if (viewName === 'home') {
            homeScreen.classList.remove('hidden-view');
            gameScreen.classList.add('hidden-view');
            updateContinueButton();
        } else if (viewName === 'game') {
            homeScreen.classList.add('hidden-view');
            gameScreen.classList.remove('hidden-view');
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
        });
    });

    updateDifficultyUI();

    // ═══════════════════════════════════════════════
    //  GAME MODE STATE
    // ═══════════════════════════════════════════════

    let isDailyChallenge = false;   // true when playing today's daily puzzle
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
        },

        openModal() {
            const modal = document.getElementById('daily-challenge-modal');
            const dateDisp = document.getElementById('daily-date-display');
            const statusDisp = document.getElementById('daily-status-display');
            const diffDisp = document.getElementById('daily-diff-value');

            if (!modal) return;

            const todayKey = this.todayKey();
            const completed = this.isCompleted(todayKey);

            // Format date nicely
            const d = new Date();
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            if (dateDisp) dateDisp.textContent = d.toLocaleDateString(undefined, options);
            if (diffDisp) diffDisp.textContent = 'Medium';

            if (statusDisp) {
                if (completed) {
                    statusDisp.textContent = '✅ Completed!';
                    statusDisp.className = 'daily-status completed';
                } else {
                    statusDisp.textContent = 'Not yet played today';
                    statusDisp.className = 'daily-status';
                }
            }

            const playBtn = document.getElementById('daily-play-btn');
            if (playBtn) {
                playBtn.textContent = completed ? '▶ Play Again' : '▶ Play Today';
            }

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

            list.innerHTML = '';
            this.definitions.forEach(def => {
                const isUnlocked = !!unlocked[def.id];
                const item = document.createElement('div');
                item.className = `achievement-item${isUnlocked ? '' : ' locked'}`;

                const progressStr = (!isUnlocked && def.progress) ? def.progress(stats) : '';

                item.innerHTML = `
                    <div class="achievement-icon">${def.icon}</div>
                    <div class="achievement-info">
                        <div class="achievement-title">${def.title}</div>
                        <div class="achievement-desc">${def.desc}</div>
                        ${progressStr ? `<div class="achievement-progress">${progressStr}</div>` : ''}
                    </div>
                    <div class="achievement-check">${isUnlocked ? '✓' : ''}</div>
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
    const numpad = document.getElementById('numpad');
    const timerDisplay = document.getElementById('timer');
    const mistakesDisplay = document.getElementById('mistakes');
    const gameOverModal = document.getElementById('game-over-modal');
    const tryAgainBtn = document.getElementById('try-again-btn');
    const restartGameBtn = document.getElementById('restart-game-btn');
    
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
    const tutorialText = document.getElementById('tutorial-text');
    const tutorialStepIndicator = document.getElementById('tutorial-step-indicator');
    const tutorialNextBtn = document.getElementById('tutorial-next-btn');
    const tutorialSkipBtn = document.getElementById('tutorial-skip-btn');
    
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
    const levelUpModal = document.getElementById('level-up-modal');
    const levelUpText = document.getElementById('level-up-text');
    const levelContinueBtn = document.getElementById('level-continue-btn');
    const pencilBtn = document.getElementById('pencil-btn');

    // Home screen buttons
    const continueGameBtn = document.getElementById('continue-game-btn');
    const newGameHomeBtn = document.getElementById('new-game-home-btn');
    const dailyChallengeBtn = document.getElementById('daily-challenge-btn');
    const homeStatsBtn = document.getElementById('home-stats-btn');
    const achievementsBtn = document.getElementById('achievements-btn');
    const homeSettingsBtn = document.getElementById('home-settings-btn');
    const homeBackBtn = document.getElementById('home-back-btn');

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
    const MAX_HINTS = 3;
    
    // Confetti instance setup
    const confettiCanvas = document.getElementById('confetti-canvas');
    const myConfetti = window.confetti ? window.confetti.create(confettiCanvas, {
        resize: true,
        useWorker: false // Force main thread
    }) : null;
    let undosRemaining = MAX_UNDOS;
    let hintsRemaining = MAX_HINTS;
    
    let mistakes = 0;
    const MAX_MISTAKES = 3;
    
    let timerInterval = null;
    let secondsElapsed = 0;

    let currentLevel = parseInt(localStorage.getItem('sudoku-level')) || 1;

    function updateLevelUI() {
        if (levelDisplay) {
            // Preserve existing difficulty badge if present
            const existingBadge = levelDisplay.querySelector('.difficulty-badge');
            if (existingBadge) {
                // Replace text node only, keep badge
                levelDisplay.childNodes[0].nodeValue = `Level ${currentLevel} `;
            } else {
                levelDisplay.textContent = `Level ${currentLevel}`;
            }
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
        'Every row, column, and 3x3 grid must contain the numbers 1 to 9.',
        'No number can repeat in the same row, column, or square.',
        'Click a cell and type a number or use the number pad.',
        'Careful! 3 mistakes and it is Game Over.'
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
            if (level > 1) {
                this.stats.gamesWon++;
                this.stats.currentStreak++;
                if (this.stats.currentStreak > this.stats.bestStreak) {
                    this.stats.bestStreak = this.stats.currentStreak;
                }
                if (timeSeconds < this.stats.bestTime) {
                    this.stats.bestTime = timeSeconds;
                }
                this.save();
            }
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
    muteBtn.textContent = SoundEngine.isMuted ? '🔈' : '🔊';
    muteBtn.addEventListener('click', () => {
        const muted = SoundEngine.toggleMute();
        muteBtn.textContent = muted ? '🔈' : '🔊';
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
            if (isPencilMode && isHapticEnabled && navigator.vibrate) {
                navigator.vibrate(50);
            }
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
                Array.from(board.children).forEach(c => c.classList.remove('crosshair'));
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
    newGameBtn.addEventListener('click', () => {
        startNewGame();
        saveGameState();
    });
    hintBtn.addEventListener('click', giveHint);
    tryAgainBtn.addEventListener('click', tryAgain);
    restartGameBtn.addEventListener('click', restartGame);
    
    if (levelContinueBtn) {
        levelContinueBtn.addEventListener('click', () => {
            levelUpModal.classList.add('hidden');
            startNewGame();
            saveGameState();
        });
    }

    // Settings logic
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            settingsModal.classList.remove('hidden');
        });
    }

    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => {
            settingsModal.classList.add('hidden');
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
            alert('Remove Ads feature is coming soon!');
        });
    }

    if (nightModeToggle) {
        nightModeToggle.addEventListener('change', (e) => {
            isNightMode = e.target.checked;
            if (isNightMode) {
                document.documentElement.setAttribute('data-theme', 'dark');
            } else {
                document.documentElement.removeAttribute('data-theme');
            }
            localStorage.setItem('sudoku-night-mode', isNightMode);
        });
    }

    if (hapticToggle) {
        hapticToggle.addEventListener('change', (e) => {
            isHapticEnabled = e.target.checked;
            localStorage.setItem('sudoku-haptic', isHapticEnabled);
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
    });

    tutorialNextBtn.addEventListener('click', nextTutorialStep);
    tutorialSkipBtn.addEventListener('click', () => tutorialModal.classList.add('hidden'));

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

    function updateTutorialUI() {
        tutorialText.textContent = tutorialSteps[currentTutorialStep];
        tutorialStepIndicator.textContent = `${currentTutorialStep + 1} / ${tutorialSteps.length}`;
        
        if (currentTutorialStep === tutorialSteps.length - 1) {
            tutorialNextBtn.textContent = 'Start Playing';
            tutorialSkipBtn.style.display = 'none';
        } else {
            tutorialNextBtn.textContent = 'Next';
            tutorialSkipBtn.style.display = 'flex'; // Restore visibility
        }
    }

    function tryAgain() {
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

    function restartGame() {
        gameOverModal.classList.add('hidden');
        startNewGame();
        saveGameState();
    }

    function selectCell(cell) {
        if (cell.classList.contains('locked-group') || cell.classList.contains('prefilled')) {
            cell.classList.remove('locked-pulse');
            void cell.offsetWidth; // Trigger reflow for animation
            cell.classList.add('locked-pulse');
            // Allow selection to continue so users can still see crosshairs
        }

        if (selectedCell) {
            selectedCell.classList.remove('selected');
        }
        
        // Remove old crosshairs
        Array.from(board.children).forEach(c => c.classList.remove('crosshair'));

        selectedCell = cell;
        selectedCell.classList.add('selected');
        
        // Add new crosshairs
        const index = parseInt(cell.dataset.index);
        const row = Math.floor(index / 9);
        const col = index % 9;
        
        Array.from(board.children).forEach((c, i) => {
            const r = Math.floor(i / 9);
            const cCol = i % 9;
            if ((r === row || cCol === col) && i !== index) {
                c.classList.add('crosshair');
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
            validateBoard();
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
        } else {
            // Normal Mode
            const correctValue = solvedGrid[cell.dataset.index].toString();
            if (value !== correctValue) {
                mistakes++;
                mistakesThisGame++;
                SoundEngine.playBuzz();
                if (isHapticEnabled && navigator.vibrate) navigator.vibrate(200);
                updateMistakeUI();
                StatsEngine.recordMistake();
                if (mistakes >= MAX_MISTAKES) {
                    triggerGameOver();
                }
            } else {
                SoundEngine.playPop();
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
        }
        saveGameState();
    }

    function updateMistakeUI() {
        if (mistakesDisplay) {
            mistakesDisplay.textContent = `Mistakes: ${mistakes}/${MAX_MISTAKES}`;
        }
    }

    function triggerGameOver() {
        stopTimer();
        StatsEngine.recordGameOver();
        SoundEngine.playGameOver();
        clearSavedGame();
        gameOverModal.classList.remove('hidden');
    }

    // --- Validation Logic ---
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
        
        // --- Cell Locking Logic ---
        // Only lock if there are no errors on the board (prevents locking a row if an intersecting column is wrong)
        if (!hasErrors) {
            // Check Rows
            for (let r = 0; r < 9; r++) {
                const rowCells = [];
                let isComplete = true;
                for (let c = 0; c < 9; c++) {
                    const idx = r * 9 + c;
                    rowCells.push(cells[idx]);
                    if (!gridState[idx]) isComplete = false;
                }
                if (isComplete) rowCells.forEach(cell => cell.classList.add('locked-group'));
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
                if (isComplete) colCells.forEach(cell => cell.classList.add('locked-group'));
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
                    if (isComplete) blockCells.forEach(cell => cell.classList.add('locked-group'));
                }
            }
        }

        checkWinCondition(hasErrors);
    }

    function checkWinCondition(hasErrors) {
        const cells = Array.from(board.children);
        const isFull = cells.every(c => c.classList.contains('user-input') || c.classList.contains('prefilled'));

        if (isFull && !hasErrors) {
            stopTimer();
            timerDisplay.style.color = '#4a6fa5'; // Win color

            StatsEngine.recordWin(currentLevel, secondsElapsed);
            clearSavedGame();

            // Mark daily challenge completed if applicable
            if (isDailyChallenge) {
                DailyChallengeEngine.markCompleted(DailyChallengeEngine.todayKey());
            }

            // Fire achievement checks
            const winFlags = {
                perfectSolve: mistakesThisGame === 0,
                noHints: hintsUsedThisGame === 0
            };
            AchievementsEngine.onWin(winFlags);

            // Level up (only for non-daily games)
            if (!isDailyChallenge) {
                currentLevel++;
                localStorage.setItem('sudoku-level', currentLevel);
            }

            SoundEngine.playVictory();
            // Small timeout to allow UI to render the last number before alerting
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

                if (levelUpModal && levelUpText) {
                    levelUpText.textContent = isDailyChallenge
                        ? 'Daily Challenge Complete! 🎉'
                        : `You reached Level ${currentLevel}`;
                    levelUpModal.classList.remove('hidden');
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
        selectCell(lastAction.cell);
        updateUndoUI();
        validateBoard();
        saveGameState();
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
    function giveHint() {
        if (hintsRemaining <= 0) return;

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
        validateBoard();

        hintsRemaining--;
        hintsUsedThisGame++;
        updateHintUI();
        saveGameState();
    }

    function updateHintUI() {
        if (hintCountSpan) hintCountSpan.textContent = hintsRemaining;
        if (hintsRemaining <= 0) {
            hintBtn.disabled = true;
        } else {
            hintBtn.disabled = false;
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

        // Reset state
        undoStack = [];
        undosRemaining = MAX_UNDOS;
        hintsRemaining = MAX_HINTS;
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

        if (dailyData) {
            // Daily Challenge: use pre-generated deterministic puzzle
            grid = [...dailyData.grid];
            solvedGrid = [...dailyData.solved];
            diffLabel = 'Daily';
            badgeClass = 'diff-badge-daily';
            console.log('Game: starting Daily Challenge puzzle');
        } else {
            // 1. Generate full solved board
            grid = new Array(81).fill(0);
            fillGrid(grid);
            solvedGrid = [...grid];

            // Record that a new real game has started
            StatsEngine.recordGameStarted(currentLevel);

            // 2. Remove cells to create puzzle with difficulty-aware logic
            let cellsToRemove;
            let attemptsBuffer = 5;

            if (currentLevel === 1) {
                cellsToRemove = 1;
                attemptsBuffer = 0; // Force exactly 1 removal for tutorial
                diffLabel = 'Easy';
                badgeClass = 'diff-badge-easy';
            } else {
                const difficultyBase = {
                    'easy':   { min: 30, max: 38, label: 'Easy',   badge: 'diff-badge-easy' },
                    'medium': { min: 40, max: 48, label: 'Medium', badge: 'diff-badge-medium' },
                    'hard':   { min: 50, max: 56, label: 'Hard',   badge: 'diff-badge-hard' }
                };
                const diff = difficultyBase[selectedDifficulty] || difficultyBase['easy'];
                cellsToRemove = diff.min + Math.floor(Math.random() * (diff.max - diff.min + 1));
                diffLabel = diff.label;
                badgeClass = diff.badge;
                console.log(`Game: starting ${diff.label} puzzle (removing ${cellsToRemove} cells)`);
            }

            // Add a slight buffer to attempts since some removals might break uniqueness and be skipped
            removeCells(grid, cellsToRemove + attemptsBuffer);
        }

        // 3. Render
        for (let i = 0; i < 81; i++) {
            if (grid[i] !== 0) {
                cells[i].textContent = grid[i];
                cells[i].dataset.value = grid[i].toString();
                cells[i].classList.add('prefilled');
            }
        }

        // 4. Update difficulty badge in game header
        if (levelDisplay) {
            levelDisplay.innerHTML = `Level ${currentLevel} <span class="difficulty-badge ${badgeClass}">${diffLabel}</span>`;
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
     * Digs holes in a fully solved grid to create a playable puzzle.
     * It ensures the resulting puzzle still has exactly ONE unique solution.
     * 
     * @param {number[]} grid - The fully solved 1D array board.
     * @param {number} attempts - The number of cells the algorithm should attempt to remove.
     * 
     * Example:
     * removeCells(mySolvedGrid, 40);
     * // mySolvedGrid now has ~40 cells set to 0, ready to be played.
     */
    function removeCells(grid, attempts) {
        while (attempts > 0) {
            let row = Math.floor(Math.random() * 9);
            let col = Math.floor(Math.random() * 9);
            let index = row * 9 + col;
            
            while (grid[index] === 0) {
                row = Math.floor(Math.random() * 9);
                col = Math.floor(Math.random() * 9);
                index = row * 9 + col;
            }
            
            let backup = grid[index];
            grid[index] = 0;
            
            let copyGrid = [...grid];
            let solutions = 0;
            
            function countSolutions(g) {
                for (let i = 0; i < 81; i++) {
                    if (g[i] === 0) {
                        for (let num = 1; num <= 9; num++) {
                            if (isValid(g, i, num)) {
                                g[i] = num;
                                countSolutions(g);
                                g[i] = 0;
                            }
                        }
                        return;
                    }
                }
                solutions++;
            }
            
            countSolutions(copyGrid);
            
            if (solutions !== 1) {
                grid[index] = backup; // Put back if not unique
            }
            attempts--;
        }
    }

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
                secondsElapsed,
                currentLevel,
                selectedDifficulty,
                isDailyChallenge,
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

        // Restore solved grid
        solvedGrid = savedState.solvedGrid || [];
        mistakes = savedState.mistakes || 0;
        undosRemaining = savedState.undosRemaining != null ? savedState.undosRemaining : MAX_UNDOS;
        hintsRemaining = savedState.hintsRemaining != null ? savedState.hintsRemaining : MAX_HINTS;
        secondsElapsed = savedState.secondsElapsed || 0;
        currentLevel = savedState.currentLevel || currentLevel;
        isDailyChallenge = savedState.isDailyChallenge || false;
        hintsUsedThisGame = savedState.hintsUsedThisGame || 0;
        mistakesThisGame = savedState.mistakesThisGame || 0;
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

        // Restore difficulty badge
        const badgeMap = {
            'easy': { label: 'Easy', cls: 'diff-badge-easy' },
            'medium': { label: 'Medium', cls: 'diff-badge-medium' },
            'hard': { label: 'Hard', cls: 'diff-badge-hard' }
        };
        if (levelDisplay) {
            if (isDailyChallenge) {
                levelDisplay.innerHTML = `Level ${currentLevel} <span class="difficulty-badge diff-badge-daily">Daily</span>`;
            } else {
                const b = badgeMap[selectedDifficulty] || badgeMap['easy'];
                levelDisplay.innerHTML = `Level ${currentLevel} <span class="difficulty-badge ${b.cls}">${b.label}</span>`;
            }
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

    function updateContinueButton() {
        if (!continueGameBtn) return;
        const saved = hasSavedGame();
        continueGameBtn.disabled = !saved;
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

    // Home Back Button (game screen → home)
    if (homeBackBtn) {
        homeBackBtn.addEventListener('click', () => {
            saveGameState();
            stopTimer();
            showView('home');
        });
    }

    // Daily Challenge — real engine
    const dailyChallengeModal = document.getElementById('daily-challenge-modal');
    const closeDailyBtn = document.getElementById('close-daily-btn');
    const dailyPlayBtn = document.getElementById('daily-play-btn');

    if (dailyChallengeBtn) {
        dailyChallengeBtn.addEventListener('click', () => {
            DailyChallengeEngine.openModal();
        });
    }

    if (closeDailyBtn) {
        closeDailyBtn.addEventListener('click', () => {
            if (dailyChallengeModal) dailyChallengeModal.classList.add('hidden');
        });
    }

    if (dailyPlayBtn) {
        dailyPlayBtn.addEventListener('click', () => {
            if (dailyChallengeModal) dailyChallengeModal.classList.add('hidden');

            // Warn if normal game in progress
            const saved = loadSavedGame();
            if (saved && !saved.isDailyChallenge) {
                if (!confirm('Starting the Daily Challenge will pause your current game. Continue?')) return;
            }

            const todayKey = DailyChallengeEngine.todayKey();
            const dailyData = DailyChallengeEngine.generateForDate(todayKey);
            startNewGame(dailyData);
            saveGameState();
            showView('game');
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
        });
    }

    if (closeAchievementsBtn) {
        closeAchievementsBtn.addEventListener('click', () => {
            if (achievementsModal) achievementsModal.classList.add('hidden');
        });
    }

    // Home Settings → open existing settings modal
    if (homeSettingsBtn) {
        homeSettingsBtn.addEventListener('click', () => {
            if (settingsModal) settingsModal.classList.remove('hidden');
        });
    }

    // ═══════════════════════════════════════════════
    //  STARTUP
    // ═══════════════════════════════════════════════

    // Initialize UI state (but do NOT auto-start a game)
    updateLevelUI();
    updateUndoUI();
    updateHintUI();
    updateContinueButton();

    // Show home screen as initial view
    showView('home');

    // Auto-launch tutorial on first visit (will show over home screen)
    if (!localStorage.getItem('sudoku-tutorial-seen')) {
        showTutorial();
        localStorage.setItem('sudoku-tutorial-seen', 'true');
    }

    // Web Splash Screen Logic
    const webSplashScreen = document.getElementById('web-splash-screen');
    const phase1 = document.getElementById('splash-phase-1');
    const phase2 = document.getElementById('splash-phase-2');
    
    if (webSplashScreen && phase1 && phase2) {
        // Phase 1 (Studio Intro) lasts for 2 seconds
        setTimeout(() => {
            phase1.classList.add('fade-out');
            phase2.classList.add('active'); // Triggers Phase 2 and progress bar animation
            
            // Phase 2 (Game Intro + Progress Bar) lasts for 3.5 seconds
            setTimeout(() => {
                webSplashScreen.classList.add('fade-out');
                
                // Remove from DOM after overall fade transition completes
                setTimeout(() => {
                    webSplashScreen.style.display = 'none';
                }, 500); 
            }, 3500);
        }, 2000);
    }
});
