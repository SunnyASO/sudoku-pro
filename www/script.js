document.addEventListener('DOMContentLoaded', () => {
    const board = document.getElementById('sudoku-board');
    const undoBtn = document.getElementById('undo-btn');
    const undoCountSpan = document.getElementById('undo-count');
    const newGameBtn = document.getElementById('new-game-btn');
    const hintBtn = document.getElementById('hint-btn');
    const hintCountSpan = document.getElementById('hint-count');
    const numpad = document.getElementById('numpad');
    const timerDisplay = document.getElementById('timer');
    const mistakesDisplay = document.getElementById('mistakes');
    const gameOverModal = document.getElementById('game-over-modal');
    const tryAgainBtn = document.getElementById('try-again-btn');
    const restartGameBtn = document.getElementById('restart-game-btn');
    const tutorialBtn = document.getElementById('tutorial-btn');
    const tutorialModal = document.getElementById('tutorial-modal');
    const tutorialText = document.getElementById('tutorial-text');
    const tutorialStepIndicator = document.getElementById('tutorial-step-indicator');
    const tutorialNextBtn = document.getElementById('tutorial-next-btn');
    const tutorialSkipBtn = document.getElementById('tutorial-skip-btn');
    const muteBtn = document.getElementById('mute-btn');
    
    let selectedCell = null;
    let solvedGrid = [];
    let undoStack = [];
    const MAX_UNDOS = 3;
    const MAX_HINTS = 3;
    let undosRemaining = MAX_UNDOS;
    let hintsRemaining = MAX_HINTS;
    
    let mistakes = 0;
    const MAX_MISTAKES = 3;
    
    let timerInterval = null;
    let secondsElapsed = 0;

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
    const numpadValues = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'X']; // X for clear
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
    newGameBtn.addEventListener('click', startNewGame);
    hintBtn.addEventListener('click', giveHint);
    
    tryAgainBtn.addEventListener('click', tryAgain);
    restartGameBtn.addEventListener('click', restartGame);
    
    tutorialBtn.addEventListener('click', showTutorial);
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
                c.classList.remove('user-input', 'error');
            }
        });
        
        undoStack = [];
        undosRemaining = MAX_UNDOS;
        updateUndoUI();
        hintsRemaining = MAX_HINTS;
        updateHintUI();
        
        startTimer();
    }

    function restartGame() {
        gameOverModal.classList.add('hidden');
        startNewGame();
    }

    function selectCell(cell) {
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

    function setCellValue(cell, value) {
        const currentValue = cell.textContent;
        if (currentValue === value) return;

        // Check for mistake before setting
        if (value !== '') {
            const correctValue = solvedGrid[cell.dataset.index].toString();
            if (value !== correctValue) {
                mistakes++;
                SoundEngine.playBuzz();
                updateMistakeUI();
                if (mistakes >= MAX_MISTAKES) {
                    triggerGameOver();
                }
            } else {
                SoundEngine.playPop();
            }
        } else {
            SoundEngine.playPop(); // Pop sound for clearing as well
        }

        if (undosRemaining > 0) {
            undoStack.push({
                cell: cell,
                prevValue: currentValue
            });
            updateUndoUI();
        }

        cell.textContent = value;
        if (value) {
            cell.classList.add('user-input');
        } else {
            cell.classList.remove('user-input');
        }
        validateBoard();
    }

    function updateMistakeUI() {
        if (mistakesDisplay) {
            mistakesDisplay.textContent = `Mistakes: ${mistakes}/${MAX_MISTAKES}`;
        }
    }

    function triggerGameOver() {
        stopTimer();
        SoundEngine.playGameOver();
        gameOverModal.classList.remove('hidden');
    }

    // --- Validation Logic ---
    function validateBoard() {
        const cells = Array.from(board.children);
        cells.forEach(c => c.classList.remove('error'));

        let hasErrors = false;
        for (let i = 0; i < 81; i++) {
            const val = cells[i].textContent;
            if (!val) continue;

            // Highlight if incorrect against the solution
            const correctVal = solvedGrid[i].toString();
            if (val !== correctVal) {
                cells[i].classList.add('error');
                hasErrors = true;
            }
        }
        
        checkWinCondition(hasErrors);
    }

    function checkWinCondition(hasErrors) {
        const cells = Array.from(board.children);
        const isFull = cells.every(c => c.textContent !== '');

        if (isFull && !hasErrors) {
            stopTimer();
            SoundEngine.playVictory();
            timerDisplay.style.color = '#4a6fa5'; // Win color
            // Small timeout to allow UI to render the last number before alerting
            setTimeout(() => alert(`Congratulations! You solved the puzzle in ${timerDisplay.textContent}.`), 100);
        } else {
            timerDisplay.style.color = ''; // Reset to default
        }
    }

    // --- Undo Logic ---
    function performUndo() {
        if (undosRemaining <= 0 || undoStack.length === 0) return;

        const lastAction = undoStack.pop();
        lastAction.cell.textContent = lastAction.prevValue;
        if (lastAction.prevValue) {
            lastAction.cell.classList.add('user-input');
        } else {
            lastAction.cell.classList.remove('user-input');
        }

        undosRemaining--;
        selectCell(lastAction.cell);
        updateUndoUI();
        validateBoard();
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
        updateHintUI();
    }

    function updateHintUI() {
        if (hintCountSpan) hintCountSpan.textContent = hintsRemaining;
        if (hintsRemaining <= 0) {
            hintBtn.disabled = true;
        } else {
            hintBtn.disabled = false;
        }
    }
    
    // --- Sudoku Generation (Unique Solution) ---
    function startNewGame() {
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
            c.classList.remove('prefilled', 'user-input', 'error', 'crosshair');
        });

        // 1. Generate full solved board
        const grid = new Array(81).fill(0);
        fillGrid(grid);
        
        // Save the solved grid for hints
        solvedGrid = [...grid];

        // 2. Remove cells to create puzzle with unique solution
        // Clues count: ~35-40 for medium. We will aim to remove ~45 cells.
        const attempts = 50; 
        removeCells(grid, attempts);

        // 3. Render
        for (let i = 0; i < 81; i++) {
            if (grid[i] !== 0) {
                cells[i].textContent = grid[i];
                cells[i].classList.add('prefilled');
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

    function stopTimer() {
        clearInterval(timerInterval);
    }

    function updateTimerDisplay() {
        const mins = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
        const secs = (secondsElapsed % 60).toString().padStart(2, '0');
        timerDisplay.textContent = `${mins}:${secs}`;
    }

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

    // Initial state
    updateUndoUI();
    updateHintUI();
    startNewGame();

    // Auto-launch tutorial on first visit
    if (!localStorage.getItem('sudoku-tutorial-seen')) {
        showTutorial();
        localStorage.setItem('sudoku-tutorial-seen', 'true');
    }
});
