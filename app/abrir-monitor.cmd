@echo off
rem Abre o monitor de custo do DSH em tempo real (agregador + janela).
start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0abrir-monitor.ps1"
