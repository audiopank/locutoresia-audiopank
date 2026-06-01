"""
dashboard_modern.py - Dashboard Moderno e Profissional
Design inspirado em dashboards modernos com animações e visual melhor
"""

from flask import Blueprint, render_template_string, jsonify, request
from datetime import datetime, timedelta
import logging
import json
import sqlite3
import os
from collections import Counter, defaultdict

logger = logging.getLogger(__name__)

dashboard_modern_bp = Blueprint('dashboard_modern', __name__)

MODERN_DASHBOARD_HTML = '''
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NewsAgent Analytics | Dashboard Profissional</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --secondary: #8b5cf6;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --info: #3b82f6;
            --dark: #1e293b;
            --light: #f8fafc;
            --gray: #64748b;
            --white: #ffffff;
            --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
            --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);
            --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1);
            --radius: 12px;
            --radius-lg: 16px;
            --transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: var(--dark);
            line-height: 1.6;
        }
        
        .dashboard-container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem;
        }
        
        .header {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            padding: 2rem;
            border-radius: var(--radius-lg);
            margin-bottom: 2rem;
            box-shadow: var(--shadow-xl);
            border: 1px solid rgba(255, 255, 255, 0.2);
            position: relative;
            overflow: hidden;
        }
        
        .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, var(--primary), var(--secondary), var(--info));
            animation: shimmer 2s infinite;
        }
        
        @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }
        
        .header h1 {
            font-size: 2.5rem;
            font-weight: 800;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.5rem;
            letter-spacing: -0.02em;
        }
        
        .header p {
            color: var(--gray);
            font-size: 1.1rem;
            font-weight: 400;
        }
        
        .controls {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            padding: 1.5rem;
            border-radius: var(--radius-lg);
            margin-bottom: 2rem;
            box-shadow: var(--shadow-lg);
            display: flex;
            align-items: center;
            gap: 1rem;
            flex-wrap: wrap;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .controls label {
            font-weight: 600;
            color: var(--dark);
        }
        
        .controls select {
            padding: 0.75rem 1rem;
            border: 2px solid var(--gray);
            border-radius: var(--radius);
            font-size: 0.95rem;
            font-weight: 500;
            background: var(--white);
            transition: var(--transition);
            cursor: pointer;
        }
        
        .controls select:hover {
            border-color: var(--primary);
        }
        
        .controls select:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
        
        .controls button {
            padding: 0.75rem 1.5rem;
            background: linear-gradient(135deg, var(--primary), var(--primary-dark));
            color: var(--white);
            border: none;
            border-radius: var(--radius);
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition);
            display: flex;
            align-items: center;
            gap: 0.5rem;
            box-shadow: var(--shadow);
        }
        
        .controls button:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-lg);
        }
        
        .controls button:active {
            transform: translateY(0);
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .stat-card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            padding: 2rem;
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            border: 1px solid rgba(255, 255, 255, 0.2);
            position: relative;
            overflow: hidden;
            transition: var(--transition);
        }
        
        .stat-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow-xl);
        }
        
        .stat-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 4px;
            height: 100%;
            background: linear-gradient(180deg, var(--primary), var(--secondary));
        }
        
        .stat-card.success::before { background: linear-gradient(180deg, var(--success), #059669); }
        .stat-card.warning::before { background: linear-gradient(180deg, var(--warning), #d97706); }
        .stat-card.info::before { background: linear-gradient(180deg, var(--info), #2563eb); }
        .stat-card.danger::before { background: linear-gradient(180deg, var(--danger), #dc2626); }
        
        .stat-icon {
            width: 60px;
            height: 60px;
            border-radius: var(--radius);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            margin-bottom: 1rem;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: var(--white);
            box-shadow: var(--shadow);
        }
        
        .stat-card.success .stat-icon { background: linear-gradient(135deg, var(--success), #059669); }
        .stat-card.warning .stat-icon { background: linear-gradient(135deg, var(--warning), #d97706); }
        .stat-card.info .stat-icon { background: linear-gradient(135deg, var(--info), #2563eb); }
        .stat-card.danger .stat-icon { background: linear-gradient(135deg, var(--danger), #dc2626); }
        
        .stat-value {
            font-size: 2.5rem;
            font-weight: 800;
            color: var(--dark);
            margin-bottom: 0.5rem;
            line-height: 1;
        }
        
        .stat-label {
            color: var(--gray);
            font-size: 0.95rem;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .stat-change {
            margin-top: 0.5rem;
            font-size: 0.9rem;
            font-weight: 600;
        }
        
        .stat-change.positive { color: var(--success); }
        .stat-change.negative { color: var(--danger); }
        .stat-change.neutral { color: var(--gray); }
        
        .charts-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .chart-card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            padding: 2rem;
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .chart-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
        }
        
        .chart-title {
            font-size: 1.25rem;
            font-weight: 700;
            color: var(--dark);
        }
        
        .chart-subtitle {
            color: var(--gray);
            font-size: 0.9rem;
            font-weight: 500;
        }
        
        .chart-container {
            position: relative;
            height: 300px;
        }
        
        .trending-card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            padding: 2rem;
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .trending-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
        }
        
        .trending-title {
            font-size: 1.25rem;
            font-weight: 700;
            color: var(--dark);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .trending-list {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }
        
        .trending-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 1rem;
            background: var(--light);
            border-radius: var(--radius);
            transition: var(--transition);
            border: 1px solid transparent;
        }
        
        .trending-item:hover {
            border-color: var(--primary);
            transform: translateX(4px);
        }
        
        .trending-rank {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: var(--white);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 1.1rem;
        }
        
        .trending-info {
            flex: 1;
            margin: 0 1rem;
        }
        
        .trending-name {
            font-weight: 600;
            color: var(--dark);
            margin-bottom: 0.25rem;
        }
        
        .trending-sources {
            font-size: 0.85rem;
            color: var(--gray);
        }
        
        .trending-mentions {
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: var(--white);
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-weight: 600;
            font-size: 0.9rem;
            box-shadow: var(--shadow);
        }
        
        .loading {
            text-align: center;
            padding: 3rem;
            color: var(--white);
            font-size: 1.2rem;
            font-weight: 500;
        }
        
        .loading i {
            animation: spin 1s linear infinite;
            margin-right: 0.5rem;
        }
        
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        
        .error {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.2);
            color: var(--danger);
            padding: 1rem;
            border-radius: var(--radius);
            margin-bottom: 1.5rem;
            font-weight: 500;
        }
        
        .success-message {
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid rgba(16, 185, 129, 0.2);
            color: var(--success);
            padding: 1rem;
            border-radius: var(--radius);
            margin-bottom: 1.5rem;
            font-weight: 500;
        }
        
        @media (max-width: 768px) {
            .dashboard-container {
                padding: 1rem;
            }
            
            .header h1 {
                font-size: 2rem;
            }
            
            .charts-grid {
                grid-template-columns: 1fr;
            }
            
            .controls {
                flex-direction: column;
                align-items: stretch;
            }
            
            .controls button {
                justify-content: center;
            }
        }
    </style>
</head>
<body>
    <div class="dashboard-container">
        <div class="header">
            <h1>NewsAgent Analytics</h1>
            <p>Dashboard profissional de análise de notícias e tendências em tempo real</p>
        </div>
        
        <div class="controls">
            <label for="hours">Período de análise:</label>
            <select id="hours" onchange="refreshData()">
                <option value="6">Últimas 6 horas</option>
                <option value="12">Últimas 12 horas</option>
                <option value="24" selected>Últimas 24 horas</option>
                <option value="48">Últimas 48 horas</option>
                <option value="72">Últimas 72 horas</option>
                <option value="168">Última semana</option>
            </select>
            <button onclick="refreshData()">
                <i class="fas fa-sync-alt"></i>
                Atualizar dados
            </button>
        </div>
        
        <div id="error" class="error" style="display: none;"></div>
        <div id="success" class="success-message" style="display: none;"></div>
        
        <!-- Estatísticas Principais -->
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon">
                    <i class="fas fa-newspaper"></i>
                </div>
                <div class="stat-value" id="total-news">0</div>
                <div class="stat-label">Total de Notícias</div>
                <div class="stat-change positive" id="news-change">
                    <i class="fas fa-arrow-up"></i> 0% vs período anterior
                </div>
            </div>
            
            <div class="stat-card success">
                <div class="stat-icon">
                    <i class="fas fa-rss"></i>
                </div>
                <div class="stat-value" id="sources-count">0</div>
                <div class="stat-label">Fontes Ativas</div>
                <div class="stat-change neutral" id="sources-change">
                    <i class="fas fa-minus"></i> Estável
                </div>
            </div>
            
            <div class="stat-card warning">
                <div class="stat-icon">
                    <i class="fas fa-fire"></i>
                </div>
                <div class="stat-value" id="topics-count">0</div>
                <div class="stat-label">Tópicos em Alta</div>
                <div class="stat-change positive" id="topics-change">
                    <i class="fas fa-arrow-up"></i> Tendência positiva
                </div>
            </div>
            
            <div class="stat-card info">
                <div class="stat-icon">
                    <i class="fas fa-chart-line"></i>
                </div>
                <div class="stat-value" id="sentiment-general">-</div>
                <div class="stat-label">Sentimento Geral</div>
                <div class="stat-change neutral" id="sentiment-change">
                    <i class="fas fa-equals"></i> Equilibrado
                </div>
            </div>
        </div>
        
        <!-- Gráficos -->
        <div class="charts-grid">
            <div class="chart-card">
                <div class="chart-header">
                    <div>
                        <div class="chart-title">Distribuição por Fonte</div>
                        <div class="chart-subtitle">Notícias coletadas por fonte de notícias</div>
                    </div>
                </div>
                <div class="chart-container">
                    <canvas id="sourcesChart"></canvas>
                </div>
            </div>
            
            <div class="chart-card">
                <div class="chart-header">
                    <div>
                        <div class="chart-title">Análise de Sentimentos</div>
                        <div class="chart-subtitle">Distribuição emocional das notícias</div>
                    </div>
                </div>
                <div class="chart-container">
                    <canvas id="sentimentChart"></canvas>
                </div>
            </div>
        </div>
        
        <div class="charts-grid">
            <div class="chart-card">
                <div class="chart-header">
                    <div>
                        <div class="chart-title">Categorias Mais Populares</div>
                        <div class="chart-subtitle">Distribuição por categoria de notícias</div>
                    </div>
                </div>
                <div class="chart-container">
                    <canvas id="categoriesChart"></canvas>
                </div>
            </div>
            
            <div class="chart-card">
                <div class="chart-header">
                    <div>
                        <div class="chart-title">Palavras-chave em Destaque</div>
                        <div class="chart-subtitle">Termos mais frequentes nas notícias</div>
                    </div>
                </div>
                <div class="chart-container">
                    <canvas id="keywordsChart"></canvas>
                </div>
            </div>
        </div>
        
        <!-- Tópicos em Alta -->
        <div class="trending-card">
            <div class="trending-header">
                <div class="trending-title">
                    <i class="fas fa-fire"></i>
                    Tópicos em Alta
                </div>
                <div class="chart-subtitle">Assuntos mais mencionados nas últimas horas</div>
            </div>
            <div class="trending-list" id="trending-list">
                <div class="loading">
                    <i class="fas fa-spinner"></i>
                    Carregando tópicos em alta...
                </div>
            </div>
        </div>
    </div>
    
    <script>
        // Configuração global do Chart.js
        Chart.defaults.font.family = "'Inter', sans-serif";
        Chart.defaults.color = '#64748b';
        Chart.defaults.plugins.legend.position = 'bottom';
        Chart.defaults.plugins.legend.labels.usePointStyle = true;
        Chart.defaults.plugins.legend.labels.padding = 20;
        
        let sourcesChart, sentimentChart, categoriesChart, keywordsChart;
        let refreshing = false;
        
        async function refreshData() {
            if (refreshing) return;
            
            refreshing = true;
            const hours = document.getElementById('hours').value;
            const errorDiv = document.getElementById('error');
            const successDiv = document.getElementById('success');
            const refreshBtn = document.querySelector('.controls button');
            
            // Mostrar loading
            refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Atualizando...';
            refreshBtn.disabled = true;
            
            try {
                const response = await fetch(`/api/advanced/trends?hours=${hours}`);
                const data = await response.json();
                
                if (!data.success) {
                    throw new Error(data.error);
                }
                
                const trends = data.trends;
                
                // Atualizar estatísticas com animação
                animateValue('total-news', trends.total_news || 0);
                animateValue('sources-count', Object.keys(trends.by_source || {}).length);
                animateValue('topics-count', trends.trending_topics?.length || 0);
                
                // Determinar sentimento geral
                const sentiments = trends.sentiment_distribution || {};
                const maxSentiment = Object.keys(sentiments).reduce((a, b) => 
                    sentiments[a] > sentiments[b] ? a : b, 'neutro');
                const sentimentLabels = {
                    'positivo': 'Positivo',
                    'negativo': 'Negativo', 
                    'neutro': 'Neutro'
                };
                document.getElementById('sentiment-general').textContent = sentimentLabels[maxSentiment] || '—';
                
                // Atualizar gráficos
                updateSourcesChart(trends.by_source || {});
                updateSentimentChart(sentiments);
                updateCategoriesChart(trends.by_category || {});
                updateKeywordsChart(trends.global_keywords || []);
                updateTrendingTopics(trends.trending_topics || []);
                
                // Mostrar sucesso
                successDiv.textContent = `✅ Dados atualizados com sucesso! ${new Date().toLocaleTimeString('pt-BR')}`;
                successDiv.style.display = 'block';
                errorDiv.style.display = 'none';
                
                setTimeout(() => {
                    successDiv.style.display = 'none';
                }, 3000);
                
            } catch (error) {
                console.error('Erro:', error);
                errorDiv.textContent = `❌ Erro ao carregar dados: ${error.message}`;
                errorDiv.style.display = 'block';
                successDiv.style.display = 'none';
            } finally {
                refreshing = false;
                refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Atualizar dados';
                refreshBtn.disabled = false;
            }
        }
        
        function animateValue(id, value) {
            const element = document.getElementById(id);
            const start = parseInt(element.textContent) || 0;
            const duration = 1000;
            const startTime = performance.now();
            
            function update(currentTime) {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                const current = Math.floor(start + (value - start) * progress);
                element.textContent = current;
                
                if (progress < 1) {
                    requestAnimationFrame(update);
                }
            }
            
            requestAnimationFrame(update);
        }
        
        function updateSourcesChart(data) {
            const ctx = document.getElementById('sourcesChart').getContext('2d');
            
            if (sourcesChart) {
                sourcesChart.destroy();
            }
            
            const colors = [
                '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308',
                '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1'
            ];
            
            sourcesChart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: Object.keys(data),
                    datasets: [{
                        data: Object.values(data),
                        backgroundColor: colors.slice(0, Object.keys(data).length),
                        borderWidth: 0,
                        hoverOffset: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                padding: 15,
                                font: {
                                    size: 12
                                }
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(30, 41, 59, 0.95)',
                            titleColor: '#fff',
                            bodyColor: '#fff',
                            padding: 12,
                            cornerRadius: 8,
                            displayColors: true,
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return `${label}: ${value} (${percentage}%)`;
                                }
                            }
                        }
                    },
                    cutout: '60%'
                }
            });
        }
        
        function updateSentimentChart(data) {
            const ctx = document.getElementById('sentimentChart').getContext('2d');
            
            if (sentimentChart) {
                sentimentChart.destroy();
            }
            
            sentimentChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['Positivo', 'Negativo', 'Neutro'],
                    datasets: [{
                        data: [
                            data.positivo || 0,
                            data.negativo || 0,
                            data.neutro || 0
                        ],
                        backgroundColor: [
                            'rgba(16, 185, 129, 0.8)',
                            'rgba(239, 68, 68, 0.8)',
                            'rgba(100, 116, 139, 0.8)'
                        ],
                        borderColor: [
                            'rgb(16, 185, 129)',
                            'rgb(239, 68, 68)',
                            'rgb(100, 116, 139)'
                        ],
                        borderWidth: 2,
                        borderRadius: 8,
                        barThickness: 60
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            backgroundColor: 'rgba(30, 41, 59, 0.95)',
                            callbacks: {
                                label: function(context) {
                                    const value = context.parsed.y;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return `Notícias: ${value} (${percentage}%)`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(100, 116, 139, 0.1)'
                            },
                            ticks: {
                                font: {
                                    size: 12
                                }
                            }
                        },
                        x: {
                            grid: {
                                display: false
                            },
                            ticks: {
                                font: {
                                    size: 12,
                                    weight: 600
                                }
                            }
                        }
                    }
                }
            });
        }
        
        function updateCategoriesChart(data) {
            const ctx = document.getElementById('categoriesChart').getContext('2d');
            
            if (categoriesChart) {
                categoriesChart.destroy();
            }
            
            categoriesChart = new Chart(ctx, {
                type: 'polarArea',
                data: {
                    labels: Object.keys(data),
                    datasets: [{
                        data: Object.values(data),
                        backgroundColor: [
                            'rgba(99, 102, 241, 0.8)',
                            'rgba(139, 92, 246, 0.8)',
                            'rgba(236, 72, 153, 0.8)',
                            'rgba(244, 63, 94, 0.8)'
                        ],
                        borderColor: [
                            'rgb(99, 102, 241)',
                            'rgb(139, 92, 246)',
                            'rgb(236, 72, 153)',
                            'rgb(244, 63, 94)'
                        ],
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                padding: 15,
                                font: {
                                    size: 12
                                }
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(30, 41, 59, 0.95)',
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed;
                                    return `${label}: ${value} notícias`;
                                }
                            }
                        }
                    },
                    scales: {
                        r: {
                            grid: {
                                color: 'rgba(100, 116, 139, 0.1)'
                            },
                            ticks: {
                                font: {
                                    size: 10
                                }
                            }
                        }
                    }
                }
            });
        }
        
        function updateKeywordsChart(keywords) {
            const ctx = document.getElementById('keywordsChart').getContext('2d');
            
            if (keywordsChart) {
                keywordsChart.destroy();
            }
            
            // Simular frequência (em produção viria do servidor)
            const data = keywords.slice(0, 8).map((keyword, index) => 
                Math.max(20, 100 - (index * 10) + Math.random() * 20)
            );
            
            keywordsChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: keywords.slice(0, 8),
                    datasets: [{
                        label: 'Frequência',
                        data: data,
                        backgroundColor: 'rgba(99, 102, 241, 0.8)',
                        borderColor: 'rgb(99, 102, 241)',
                        borderWidth: 2,
                        borderRadius: 8
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            backgroundColor: 'rgba(30, 41, 59, 0.95)',
                            callbacks: {
                                label: function(context) {
                                    return `Frequência: ${context.parsed.x}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(100, 116, 139, 0.1)'
                            },
                            ticks: {
                                font: {
                                    size: 12
                                }
                            }
                        },
                        y: {
                            grid: {
                                display: false
                            },
                            ticks: {
                                font: {
                                    size: 12,
                                    weight: 500
                                }
                            }
                        }
                    }
                }
            });
        }
        
        function updateTrendingTopics(topics) {
            const listDiv = document.getElementById('trending-list');
            
            if (topics.length === 0) {
                listDiv.innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: #64748b;">
                        <i class="fas fa-search" style="font-size: 2rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                        <p>Nenhum tópico em alta detectado no período</p>
                    </div>
                `;
                return;
            }
            
            listDiv.innerHTML = topics.map((topic, idx) => `
                <div class="trending-item">
                    <div class="trending-rank">${idx + 1}</div>
                    <div class="trending-info">
                        <div class="trending-name">${topic.topic}</div>
                        <div class="trending-sources">
                            <i class="fas fa-rss"></i> ${topic.sources.join(', ')}
                        </div>
                    </div>
                    <div class="trending-mentions">
                        ${topic.mentions} menções
                    </div>
                </div>
            `).join('');
        }
        
        // Carregar dados ao iniciar
        document.addEventListener('DOMContentLoaded', function() {
            refreshData();
            
            // Atualizar automático a cada 5 minutos
            setInterval(() => {
                if (!refreshing) {
                    refreshData();
                }
            }, 5 * 60 * 1000);
        });
    </script>
</body>
</html>
'''

@dashboard_modern_bp.route('/dashboard-profissional', methods=['GET'])
def dashboard_profissional():
    """Renderiza dashboard profissional moderno"""
    return render_template_string(MODERN_DASHBOARD_HTML)

@dashboard_modern_bp.route('/api/advanced/trends', methods=['GET'])
def get_trends():
    """API para obter tendências e análises avançadas - DADOS REAIS DO SUPABASE"""
    try:
        hours = request.args.get('hours', 24, type=int)

        # Dados REAIS via módulo compartilhado (lê o feed hzmt, agrupa por fonte real)
        from backend.news_metrics import compute_news_metrics
        m = compute_news_metrics(hours)

        return jsonify({
            'success': True,
            'trends': {
                'total_news': m['total_news'],
                'by_source': m['by_source'],
                'by_category': m['by_category'],
                'sentiment_distribution': m['sentiment_distribution'],
                'global_keywords': m['global_keywords'],
                'trending_topics': m['trending_topics'][:10],
                'period_hours': hours,
                'generated_at': datetime.now().isoformat(),
                'data_source': 'Supabase hzmtdfojctctvgqjdbex (posts reais, agrupado por fonte)'
            }
        })
        
    except Exception as e:
        logger.error(f"Erro ao obter tendências: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def init_dashboard_modern(app):
    """Inicializa dashboard moderno na aplicação Flask"""
    app.register_blueprint(dashboard_modern_bp)
    logger.info("Dashboard moderno initialized")
