@echo off
cd /d "d:\DOWLOADS PROGRAMAS 2025\Locutores IA"
py test_final.py > test_output.txt 2>&1
type test_output.txt
