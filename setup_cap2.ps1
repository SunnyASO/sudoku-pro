$env:Path = "C:\Program Files\nodejs;" + $env:Path
& "C:\Program Files\nodejs\npx.cmd" cap init "Sudoku Pro" "com.antigravity.sudokupro" --web-dir www
& "C:\Program Files\nodejs\npx.cmd" cap add android
& "C:\Program Files\nodejs\npx.cmd" cap sync
