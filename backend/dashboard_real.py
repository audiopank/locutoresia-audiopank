"""
dashboard_real.py - Dashboard com DADOS REAIS do Supabase
Busca publicações reais do NewPost-IA
"""

from flask import Blueprint, render_template_string, jsonify, request
from datetime import datetime, timedelta
import logging
import os
from collections import Counter

logger = logging.getLogger(__name__)

# Supabase será importado dinamicamente na rota para garantir que o .env esteja carregado
HAS_SUPABASE = None

dashboard_real_bp = Blueprint('dashboard_real', __name__)

REAL_DASHBOARD_HTML = '''
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NewPost-IA | Dashboard Real</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
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
            --radius: 12px;
            --radius-lg: 16px;
        }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: var(--dark);
            line-height: 1.6;
        }
        .dashboard-container { max-width: 1400px; margin: 0 auto; padding: 2rem; }
        .header {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            padding: 2rem;
            border-radius: var(--radius-lg);
            margin-bottom: 2rem;
            box-shadow: var(--shadow-lg);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .header h1 {
            font-size: 2.5rem;
            font-weight: 800;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.5rem;
        }
        .header p { color: var(--gray); font-size: 1.1rem; }
        .warning-box {
            background: rgba(245, 158, 11, 0.1);
            border: 1px solid rgba(245, 158, 11, 0.3);
            color: #92400e;
            padding: 1rem;
            border-radius: var(--radius);
            margin-bottom: 1.5rem;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
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
            transition: all 0.3s ease;
        }
        .stat-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); }
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
        .stat-icon {
            width: 50px;
            height: 50px;
            border-radius: var(--radius);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.25rem;
            margin-bottom: 1rem;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: var(--white);
        }
        .stat-card.success .stat-icon { background: linear-gradient(135deg, var(--success), #059669); }
        .stat-card.warning .stat-icon { background: linear-gradient(135deg, var(--warning), #d97706); }
        .stat-card.info .stat-icon { background: linear-gradient(135deg, var(--info), #2563eb); }
        .stat-value { font-size: 2rem; font-weight: 800; color: var(--dark); margin-bottom: 0.25rem; }
        .stat-label { color: var(--gray); font-size: 0.9rem; font-weight: 500; text-transform: uppercase; }
        .chart-card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            padding: 2rem;
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            border: 1px solid rgba(255, 255, 255, 0.2);
            margin-bottom: 1.5rem;
        }
        .chart-header { margin-bottom: 1.5rem; }
        .chart-title { font-size: 1.25rem; font-weight: 700; color: var(--dark); }
        .chart-subtitle { color: var(--gray); font-size: 0.9rem; }
        .chart-container { position: relative; height: 300px; }
        .publications-list {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            padding: 2rem;
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .publication-item {
            display: flex;
            align-items: start;
            gap: 1rem;
            padding: 1rem;
            background: var(--light);
            border-radius: var(--radius);
            margin-bottom: 1rem;
            border-left: 4px solid var(--primary);
            transition: all 0.3s ease;
        }
        .publication-item:hover { transform: translateX(4px); border-left-color: var(--secondary); }
        .publication-status {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1rem;
            flex-shrink: 0;
        }
        .status-published { background: rgba(16, 185, 129, 0.1); color: var(--success); }
        .status-pending { background: rgba(245, 158, 11, 0.1); color: var(--warning); }
        .status-error { background: rgba(239, 68, 68, 0.1); color: var(--danger); }
        .publication-content { flex: 1; }
        .publication-title { font-weight: 600; color: var(--dark); margin-bottom: 0.25rem; }
        .publication-meta { font-size: 0.85rem; color: var(--gray); }
        .publication-source { 
            display: inline-block;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 600;
            margin-top: 0.5rem;
        }
        .empty-state {
            text-align: center;
            padding: 3rem;
            color: var(--gray);
        }
        .empty-state i { font-size: 3rem; margin-bottom: 1rem; opacity: 0.5; }
        .refresh-btn {
            background: linear-gradient(135deg, var(--primary), var(--primary-dark));
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: var(--radius);
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            margin-bottom: 1.5rem;
        }
        .refresh-btn:hover { transform: translateY(-2px); box-shadow: var(--shadow-lg); }
        .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 1.5rem; }
    </style>
</head>
<body>
    <div class="dashboard-container">
        <div class="header">
            <h1><i class="fas fa-newspaper"></i> NewPost-IA Dashboard</h1>
            <p>Dados reais de publicações e notícias do sistema</p>
        </div>
        
        <div id="warning-box" class="warning-box" style="display: none;">
            <i class="fas fa-exclamation-triangle"></i>
            <span id="warning-text">Carregando dados...</span>
        </div>
        
        <button class="refresh-btn" onclick="refreshData()">
            <i class="fas fa-sync-alt"></i> Atualizar Dados Reais
        </button>
        
        <!-- Estatísticas -->
        <div class="stats-grid">
            <div class="stat-card success">
                <div class="stat-icon"><i class="fas fa-check-circle"></i></div>
                <div class="stat-value" id="total-publications">0</div>
                <div class="stat-label">Publicações Totais</div>
            </div>
            <div class="stat-card info">
                <div class="stat-icon"><i class="fas fa-user"></i></div>
                <div class="stat-value" id="total-authors">0</div>
                <div class="stat-label">Autores</div>
            </div>
            <div class="stat-card warning">
                <div class="stat-icon"><i class="fas fa-clock"></i></div>
                <div class="stat-value" id="pending-count">0</div>
                <div class="stat-label">Pendentes</div>
            </div>
            <div class="stat-card success">
                <div class="stat-icon"><i class="fas fa-share-alt"></i></div>
                <div class="stat-value" id="published-count">0</div>
                <div class="stat-label">Publicadas</div>
            </div>
        </div>
        
        <!-- Gráficos -->
        <div class="grid-2">
            <div class="chart-card">
                <div class="chart-header">
                    <div class="chart-title">Publicações por Fonte</div>
                    <div class="chart-subtitle">Distribuição real das publicações no NewPost-IA</div>
                </div>
                <div class="chart-container">
                    <canvas id="sourcesChart"></canvas>
                </div>
            </div>
            
            <div class="chart-card">
                <div class="chart-header">
                    <div class="chart-title">Status das Publicações</div>
                    <div class="chart-subtitle">Publicadas vs Pendentes vs Erros</div>
                </div>
                <div class="chart-container">
                    <canvas id="statusChart"></canvas>
                </div>
            </div>
        </div>
        
        <!-- Lista de Publicações Recentes -->
        <div class="publications-list">
            <div class="chart-header">
                <div class="chart-title"><i class="fas fa-list"></i> Publicações Recentes</div>
                <div class="chart-subtitle">Últimas publicações do sistema (dados reais do Supabase)</div>
            </div>
            <div id="publications-container">
                <div class="empty-state">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Carregando publicações reais...</p>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        let sourcesChart, statusChart;
        
        async function refreshData() {
            const warningBox = document.getElementById('warning-box');
            const warningText = document.getElementById('warning-text');
            
            warningBox.style.display = 'flex';
            warningText.textContent = 'Buscando dados reais do Supabase...';
            
            try {
                const response = await fetch('/api/real/dashboard-data');
                const data = await response.json();
                
                if (!data.success) {
                    throw new Error(data.error || 'Erro desconhecido');
                }
                
                // Atualizar estatísticas
                document.getElementById('total-publications').textContent = data.stats.total_publications || 0;
                document.getElementById('total-authors').textContent = Object.keys(data.by_source || {}).length || 0;
                document.getElementById('pending-count').textContent = data.stats.pending || 0;
                document.getElementById('published-count').textContent = data.stats.published || 0;
                
                // Atualizar gráficos
                updateSourcesChart(data.by_source || {});
                updateStatusChart(data.by_status || {});
                
                // Atualizar lista de publicações
                updatePublicationsList(data.recent_publications || []);
                
                warningBox.style.display = 'none';
                
            } catch (error) {
                console.error('Erro:', error);
                warningText.textContent = 'Erro: ' + error.message;
                warningBox.style.background = 'rgba(239, 68, 68, 0.1)';
                warningBox.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                warningBox.style.color = '#dc2626';
            }
        }
        
        function updateSourcesChart(data) {
            const ctx = document.getElementById('sourcesChart').getContext('2d');
            if (sourcesChart) sourcesChart.destroy();
            
            const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#84cc16'];
            
            sourcesChart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: Object.keys(data),
                    datasets: [{
                        data: Object.values(data),
                        backgroundColor: colors,
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'right' },
                        tooltip: {
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
                    }
                }
            });
        }
        
        function updateStatusChart(data) {
            const ctx = document.getElementById('statusChart').getContext('2d');
            if (statusChart) statusChart.destroy();
            
            statusChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['Publicadas', 'Pendentes', 'Erros'],
                    datasets: [{
                        data: [data.published || 0, data.pending || 0, data.error || 0],
                        backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
                        borderRadius: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, ticks: { stepSize: 1 } }
                    }
                }
            });
        }
        
        function updatePublicationsList(publications) {
            const container = document.getElementById('publications-container');
            
            if (publications.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-inbox"></i>
                        <p>Nenhuma publicação encontrada no banco de dados</p>
                        <p style="font-size: 0.85rem; margin-top: 0.5rem;">As publicações do NewPost-IA aparecerão aqui</p>
                    </div>
                `;
                return;
            }
            
            container.innerHTML = publications.map(pub => {
                const statusClass = 'status-published';
                const statusIcon = 'fa-check';
                
                return `
                    <div class="publication-item">
                        <div class="publication-status ${statusClass}">
                            <i class="fas ${statusIcon}"></i>
                        </div>
                        <div class="publication-content">
                            <div class="publication-title">${pub.titulo || pub.title || 'Sem título'}</div>
                            <div class="publication-meta">
                                <i class="fas fa-calendar"></i> ${new Date(pub.criado_em || pub.created_at).toLocaleString('pt-BR')}
                                ${pub.autor_id ? `<i class="fas fa-user" style="margin-left: 1rem;"></i> Autor: ${pub.autor_id}` : ''}
                            </div>
                            ${pub.descricao ? `<div style="font-size: 0.9rem; color: #64748b; margin-top: 0.5rem;">${pub.descricao.substring(0, 100)}...</div>` : ''}
                            ${pub.hashtags && Array.isArray(pub.hashtags) && pub.hashtags.length > 0 ? `<div style="margin-top: 0.5rem;">${pub.hashtags.map(tag => `<span style="background: #6366f1; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; margin-right: 4px;">#${tag}</span>`).join('')}</div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }
        
        // Carregar ao iniciar
        document.addEventListener('DOMContentLoaded', refreshData);
    </script>
</body>
</html>
'''

@dashboard_real_bp.route('/dashboard-real', methods=['GET'])
def dashboard_real():
    """Renderiza dashboard com dados reais"""
    return render_template_string(REAL_DASHBOARD_HTML)

@dashboard_real_bp.route('/api/real/dashboard-data', methods=['GET'])
def get_real_dashboard_data():
    """API que retorna dados REAIS do Supabase"""
    try:
        hours = request.args.get('hours', 24, type=int)

        # Dados REAIS via módulo compartilhado (lê o feed hzmt, agrupa por fonte real)
        from backend.news_metrics import compute_news_metrics
        m = compute_news_metrics(hours)

        by_source = m['by_source']
        by_status = m['by_status']
        stats = {
            'total_publications': m['total_news'],
            'total_sources': len(by_source),
            'published': by_status.get('published', 0),
            'pending': by_status.get('pending', 0),
            'error': by_status.get('draft', 0),
        }

        return jsonify({
            'success': True,
            'stats': stats,
            'by_source': by_source,
            'by_status': by_status,
            'recent_publications': m['recent'],
            'sources': list(by_source.keys()),
            'trending_topics': m['trending_topics'][:10],
            'period_hours': hours,
            'generated_at': datetime.now().isoformat(),
            'data_source': 'Supabase hzmtdfojctctvgqjdbex (posts reais, agrupado por fonte)'
        })
        
    except Exception as e:
        logger.error(f"Erro ao buscar dados reais: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'message': 'Verifique se o Supabase está configurado corretamente'
        }), 500

def init_dashboard_real(app):
    """Inicializa dashboard real na aplicação Flask"""
    app.register_blueprint(dashboard_real_bp)
    logger.info("Dashboard com dados REAIS inicializado")
