mkdir www
Move-Item index.html www\
Move-Item style.css www\
Move-Item script.js www\
& "C:\Program Files\nodejs\npm.cmd" init -y
& "C:\Program Files\nodejs\npm.cmd" install @capacitor/core @capacitor/cli @capacitor/android
& "C:\Program Files\nodejs\npx.cmd" cap init "Sudoku Pro" "com.antigravity.sudokupro" --web-dir www
& "C:\Program Files\nodejs\npx.cmd" cap add android
& "C:\Program Files\nodejs\npx.cmd" cap sync
