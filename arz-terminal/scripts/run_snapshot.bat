@echo off
rem ARZ Terminal — дампы цен каждые 30 минут + автопуш на GitHub (Render сам передеплоит сайт).
rem Задача планировщика Windows: ARZTerminalSnapshots
cd /d "C:\Users\negrozoido\Desktop\arzModMnogoDeneg"
"C:\Users\negrozoido\AppData\Local\Programs\Python\Python315\python.exe" "C:\Users\negrozoido\Desktop\arzModMnogoDeneg\arz-terminal\scripts\snapshot.py"
git add arz-terminal/data/
git diff --cached --quiet || git commit -m "data: scheduled ArzMarket snapshot"
git push origin main
