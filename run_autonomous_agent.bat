@echo off
echo ====================================================
echo    INICIANDO AGENTE AUTONOMO CONTINUO NEWPOST-IA
echo ====================================================
echo.
echo O agente roda em primeiro plano e a cada 1 hora:
echo - Coleta novas noticias
echo - Seleciona a mais relevante
echo - Gera titulo, legenda, hashtags e emojis com IA
echo - Publica na plataforma NewPost-IA
echo.
echo Para encerrar, pressione CTRL+C.
echo.

py backend\autonomous_news_agent.py
pause
