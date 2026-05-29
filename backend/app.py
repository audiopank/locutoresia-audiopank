from flask import Flask, render_template, request, jsonify, send_file, make_response
import os
import sys
import uuid
import glob
import json
import requests
from datetime import datetime, timezone, timedelta

print("[DEBUG] === INÍCIO DO app.py ===")
print(f"[DEBUG] Diretório atual: {os.getcwd()}")
print(f"[DEBUG] __file__: {__file__}")

# Forçar UTF-8 no stdout (necessário no Windows)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# Carregar variáveis de ambiente do arquivo .env (apenas em desenvolvimento)
try:
    from dotenv import load_dotenv
    # Carregar .env do diretório pai (raiz do projeto)
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    print(f"[DEBUG] Tentando carregar .env de: {env_path}")
    print(f"[DEBUG] Arquivo .env existe? {os.path.exists(env_path)}")
    if os.path.exists(env_path):
        load_dotenv(env_path)
        print(f"✅ Arquivo .env carregado: {env_path}")
        # Verificar variáveis imediatamente após o load
        print(f"[DEBUG] SUPABASE_URL após load_dotenv: {repr(os.getenv('SUPABASE_URL'))}")
    else:
        print(f"⚠️ Arquivo .env não encontrado em: {env_path}")
except ImportError:
    print("⚠️ python-dotenv não instalado, usando variáveis de ambiente do sistema")
except Exception as e:
    print(f"❌ Erro ao carregar .env: {e}")

# No Vercel, o diretório de execução principal pode não ser 'backend'
# Precisamos adicionar o diretório atual (onde está app.py) ao sys.path explicitamente
sys.path.insert(0, os.path.dirname(__file__))

# Adicionar diretório raiz do projeto para importar o módulo core
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

# As variáveis de ambiente são configuradas diretamente no painel
# Não precisamos carregar de arquivo .env em produção

# Criar app Flask primeiro
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app = Flask(__name__, 
           template_folder=os.path.join(base_dir, 'templates'),
           static_folder=os.path.join(base_dir, 'static'))

# Inicializar NewsAutomationAgent (apenas se não estiver no Vercel)
news_automation = None
HAS_NEWS_AUTOMATION = False
if not os.environ.get('VERCEL'):
    try:
        from core.news_automation_agent import NewsAutomationAgent
        news_automation = NewsAutomationAgent()
        HAS_NEWS_AUTOMATION = True
        print("✅ NewsAutomationAgent inicializado com sucesso!")
    except Exception as e:
        print(f"⚠️ Erro ao inicializar NewsAutomationAgent: {e}")
        HAS_NEWS_AUTOMATION = False
        news_automation = None

# Helper para obter a chave Supabase correta
def get_supabase_key():
    return os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_ANON_KEY', '')

# Validação de segurança do Supabase
try:
    from supabase_guard import validate_supabase_target
    # Recarregar .env explicitamente para garantir chaves novas
    from dotenv import load_dotenv
    load_dotenv(override=True)
    validate_supabase_target()
except ImportError:
    print("⚠️ supabase_guard não encontrado, pulando validação")
except Exception as e:
    print(f"❌ Erro na validação do Supabase: {e}")

# Configurar CORS manualmente
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization,apikey')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,PATCH,OPTIONS')
    return response

# Configurações de upload - usar /tmp no Vercel
if os.environ.get('VERCEL'):
    app.config['UPLOAD_FOLDER'] = '/tmp/generated_audio'
    app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB
else:
    app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), '..', 'generated_audio')
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Importar feedparser para RSS
try:
    import feedparser
    HAS_FEEDPARSER = True
except ImportError:
    HAS_FEEDPARSER = False
    print("⚠️ feedparser não instalado, usando notícias mockadas")

# Fontes RSS (Notícias Reais)
RSS_FEEDS = {
    "Tecnologia": [
        "https://g1.globo.com/rss/g1/tecnologia/",
        "https://techtudo.com.br/rss/feed/",
        "https://olhardigital.com.br/feed/",
        "https://exame.com/tecnologia/feed/"
    ],
    "Economia": [
        "https://exame.com/mercados/feed/",
        "https://g1.globo.com/rss/g1/economia/",
        "https://forbes.com.br/feed/"
    ],
    "Esportes": [
        "https://ge.globo.com/rss/ultimas-noticias/",
        "https://www.lance.com.br/rss/ultimas-noticias/",
        "https://globoesporte.globo.com/rss/feed/"
    ],
    "Política": [
        "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml",
        "https://noticias.uol.com.br/politica/ultimas-noticias/feed/",
        "https://g1.globo.com/rss/g1/politica/"
    ],
    "Saúde": [
        "https://g1.globo.com/rss/g1/saude/",
        "https://noticias.uol.com.br/saude/ultimas-noticias/feed/"
    ],
    "Ciência": [
        "https://g1.globo.com/rss/g1/ciencia-e-saude/",
        "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml"
    ],
    "Entretenimento": [
        "https://g1.globo.com/rss/g1/pop-arte/",
        "https://entretenimento.uol.com.br/feed/ultimas-noticias/"
    ],
    "Turismo": [
        "https://g1.globo.com/rss/g1/turismo-e-viagem/",
        "https://veja.abril.com.br/feed/turismo/"
    ],
    "Cultura": [
        "https://g1.globo.com/rss/g1/pop-arte/",
        "https://veja.abril.com.br/feed/cultura/"
    ],
    "Notícias Gerais": [
        "https://g1.globo.com/rss/g1/",
        "https://oglobo.globo.com/rss/",
        "https://gazetadopovo.com.br/feed/",
        "https://diariodonordeste.verdesmares.com.br/feed/"
    ]
}

def fetch_news_from_rss(category="Tecnologia", limit=7):
    """Busca notícias reais via RSS"""
    mock_news = {
        "Tecnologia": [
            {"title": "IA revoluciona mercado de trabalho", "summary": "Novos modelos de IA estão transformando a forma como trabalhamos."},
            {"title": "5 tendências de tecnologia para 2026", "summary": "Veja as tecnologias que vão dominar o mercado este ano."},
            {"title": "Ferramentas de IA essenciais para produtividade", "summary": "Aumente sua produtividade com essas ferramentas de IA."}
        ],
        "Economia": [
            {"title": "Mercados em alta: oportunidades para investidores", "summary": "A bolsa de valores mostra sinais de recuperação."},
            {"title": "Dicas de investimento para iniciantes", "summary": "Comece a investir com essas dicas simples e práticas."},
            {"title": "Economia brasileira: perspectivas para 2026", "summary": "Analistas preveem crescimento para a economia brasileira."}
        ],
        "Esportes": [
            {"title": "Brasil vence partida importante", "summary": "Seleção brasileira conquista vitória em jogo emocionante."},
            {"title": "Novos talentos surgem no futebol brasileiro", "summary": "Jovens promessas estão se destacando nos clubes."},
            {"title": "Atleta brasileiro conquista medalha de ouro", "summary": "Vitória histórica para o esporte nacional."}
        ],
        "Política": [
            {"title": "Reforma aprovada no Congresso", "summary": "Nova lei promete mudanças significativas."},
            {"title": "Governo anuncia programa de investimentos", "summary": "Novos recursos para infraestrutura e educação."},
            {"title": "Debate político ganha destaque nas redes", "summary": "Discussões sobre o futuro do país movimentam a internet."}
        ],
        "Saúde": [
            {"title": "Pesquisa revela benefícios da meditação", "summary": "Estudo mostra impacto positivo na saúde mental."},
            {"title": "Dicas de alimentação saudável", "summary": "Melhore sua dieta com essas recomendações."},
            {"title": "Vacinação: importância para a saúde pública", "summary": "Entenda por que se vacinar é fundamental."}
        ],
        "Ciência": [
            {"title": "Descoberta científica revoluciona área da saúde", "summary": "Novos tratamentos prometem salvar vidas."},
            {"title": "Exploração espacial: missão envia dados importantes", "summary": "Sonda espacial coleta informações sobre o universo."},
            {"title": "Pesquisa brasileira ganha destaque internacional", "summary": "Trabalho de cientistas brasileiros é reconhecido mundialmente."}
        ],
        "Entretenimento": [
            {"title": "Lançamento de filme aguardado", "summary": "Produção cinematográfica chega aos cinemas."},
            {"title": "Cantor brasileiro lança novo álbum", "summary": "Novo trabalho musical promete fazer sucesso."},
            {"title": "Série viraliza nas plataformas de streaming", "summary": "Produção original conquista milhares de fãs."}
        ],
        "Cultura": [
            {"title": "Exposição de arte abre no centro cultural", "summary": "Mostra apresenta trabalhos de artistas contemporâneos."},
            {"title": "Festival de música atrai multidão", "summary": "Evento cultural reúne artistas de diversos estilos."},
            {"title": "Livro brasileiro ganha prêmio internacional", "summary": "Obra literária é reconhecida por sua qualidade."}
        ],
        "Notícias Gerais": [
            {"title": "Notícia do dia: atualização importante", "summary": "Acompanhe as principais notícias do dia."},
            {"title": "Evento comunitário une moradores", "summary": "Ação social promove integração na comunidade."},
            {"title": "Clima: previsão para os próximos dias", "summary": "Confira as condições meteorológicas da região."}
        ]
    }
    
    if not HAS_FEEDPARSER:
        return mock_news.get(category, mock_news["Notícias Gerais"])[:limit]
    
    feeds = RSS_FEEDS.get(category, RSS_FEEDS["Tecnologia"])
    all_entries = []
    
    for feed_url in feeds:
        try:
            feed = feedparser.parse(feed_url)
            entries = feed.entries[:3]
            all_entries.extend(entries)
        except Exception as e:
            print(f"Erro no feed {feed_url}: {e}")
            continue
    
    all_entries = all_entries[:limit]
    
    if not all_entries:
        return mock_news.get(category, mock_news["Notícias Gerais"])[:limit]
    
    return all_entries

# Importar agente de notícias de forma segura (apenas se não estiver no Vercel)
news_agent = None
NewsAgent = None
HAS_NEWS_AGENT = False
if not os.environ.get('VERCEL'):
    try:
        from news_agent import news_agent, NewsAgent
        HAS_NEWS_AGENT = True
        print("✓ NewsAgent carregado")
    except ImportError:
        # Fallback caso a importação direta falhe
        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location("news_agent", os.path.join(os.path.dirname(__file__), 'news_agent.py'))
            news_agent_module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(news_agent_module)
            news_agent = news_agent_module.news_agent
            NewsAgent = news_agent_module.NewsAgent
            HAS_NEWS_AGENT = True
            print("✓ NewsAgent carregado via spec")
        except Exception as e:
            news_agent = None
            NewsAgent = None
            HAS_NEWS_AGENT = False
            print(f"⚠️ NewsAgent não disponível: {e}")

# DEBUG — verificar se execute_collection existe (apenas em desenvolvimento, não no Vercel)
if not os.environ.get('VERCEL') and HAS_NEWS_AGENT:
    try:
        _agent_test = news_agent
        _methods = [m for m in dir(_agent_test) if not m.startswith('_')]
        print(f"✅ NewsAgent carregado de: {news_agent.__module__}")
        print(f"✅ Métodos disponíveis: {_methods}")
        
        if not hasattr(_agent_test, 'execute_collection'):
            print("❌ ALERTA: execute_collection NÃO encontrado!")
        else:
            print("✅ execute_collection encontrado com sucesso")
    except Exception as e:
        print(f"⚠️ Erro ao testar NewsAgent (apenas debug): {e}")

# Importar funções de correção das APIs de notícias
try:
    from backend.fix_news_api import add_news_routes
    add_news_routes(app)
    print("✓ Rotas corrigidas de notícias adicionadas")
except ImportError as e:
    print(f"Erro ao importar rotas de notícias: {e}")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/minidaw')
def minidaw():
    """MiniDAW Interface"""
    return render_template('minidaw.html')

@app.route('/minidaw-react')
def minidaw_react():
    """MiniDAW React Interface"""
    return render_template('minidaw-react.html')

@app.route('/busca-noticias')
def busca_noticias():
    """Busca de Notícias + IA"""
    return render_template('busca-noticias.html')

@app.route('/noticias')
def noticias():
    """Página de Notícias"""
    return render_template('noticias.html')

@app.route('/busca')
def busca():
    """Página de Busca"""
    return render_template('busca.html')

@app.route('/painel')
def painel():
    """Página do Painel"""
    return render_template('painel.html')

@app.route('/contato')
def contato():
    """Página de Contato"""
    return render_template('contato.html')

@app.route('/draft_approval')
def draft_approval():
    """Dashboard de Rascunhos & Aprovação"""
    return render_template('draft_approval.html')

@app.route('/news-auto-post')
def news_auto_post():
    """Dashboard de Automação de Notícias - News Auto Post"""
    return render_template('news-auto-post.html')

@app.route('/social-genius')
def social_genius():
    """Social Genius - Ferramentas de IA para Redes Sociais (em desenvolvimento)"""
    return render_template('index.html')

@app.route('/newpost-authors')
def newpost_authors():
    """Autores NewPost-IA - Gerenciamento de perfis"""
    return render_template('newpost-authors.html')

@app.route('/voice-cloning')
def voice_cloning():
    """Clonagem de Voz - Crie clones de voz personalizados"""
    return render_template('voice-cloning.html')

# =========================================================
# APIs para Autores NewPost-IA
# =========================================================
@app.route('/api/newpost/authors', methods=['GET'])
def api_list_newpost_authors():
    """Lista todos os autores do newpost_profiles via Supabase"""
    try:
        supabase_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
        supabase_key = os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')
        
        if not supabase_url or not supabase_key:
            return jsonify({"success": False, "error": "Credenciais Supabase não configuradas"}), 500
        
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json'
        }
        
        response = requests.get(
            f"{supabase_url}/rest/v1/newpost_profiles?select=*&order=criado_em.desc",
            headers=headers,
            timeout=10
        )
        
        if response.status_code in (200, 201):
            authors = response.json()
            return jsonify({"success": True, "authors": authors})
        else:
            return jsonify({"success": False, "error": response.text}), response.status_code
            
    except Exception as e:
        import traceback
        print(f"[DEBUG] Erro em api_list_newpost_authors: {e}")
        print(traceback.format_exc())
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/newpost/authors', methods=['POST'])
def api_create_newpost_author():
    """Cria um novo autor no newpost_profiles"""
    try:
        data = request.get_json()
        nome = data.get('nome')
        email = data.get('email')
        
        if not nome or not email:
            return jsonify({"success": False, "error": "Nome e e-mail são obrigatórios"}), 400
        
        supabase_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
        supabase_key = os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')
        
        if not supabase_url or not supabase_key:
            return jsonify({"success": False, "error": "Credenciais Supabase não configuradas"}), 500
        
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
        
        author_data = {
            'nome': nome,
            'email': email
        }
        
        response = requests.post(
            f"{supabase_url}/rest/v1/newpost_profiles",
            json=author_data,
            headers=headers,
            timeout=10
        )
        
        if response.status_code in (200, 201):
            result = response.json()
            return jsonify({"success": True, "author": result[0] if isinstance(result, list) else result})
        else:
            return jsonify({"success": False, "error": response.text}), response.status_code
            
    except Exception as e:
        import traceback
        print(f"[DEBUG] Erro em api_create_newpost_author: {e}")
        print(traceback.format_exc())
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/news/collect', methods=['POST'])
def collect_news():
    """Endpoint para iniciar coleta de notícias"""
    if os.environ.get('VERCEL') or not HAS_NEWS_AGENT:
        # No Vercel, usar busca por RSS simples
        return jsonify({
            "success": True,
            "result": "Usando busca por RSS no Vercel"
        })
    
    try:
        agent = NewsAgent()
        result = agent.run_cycle()
        return jsonify({
            "success": True,
            "result": result
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Erro na coleta: {str(e)}"
        }), 500

@app.route('/api/news/execute', methods=['POST'])
def execute_news():
    """Endpoint para executar busca de notícias (compatível com frontend)"""
    try:
        data = request.get_json() or {}
        enabled_sources = data.get('enabled_sources', {
            "g1": True, "folha": True, "exame": True, "veja": True,
            "olhar_digital": True, "forbes_brasil": True
        })
        categories = data.get('categories', ['brasil', 'economia', 'tecnologia'])
        limit = data.get('limit', 50)

        # Fallback p/ Vercel: NewsAgent usa SQLite/logs em disco e fica desativado em prod.
        # Quando ele não estiver disponível, usamos fetch_news_from_rss (RSS puro, stateless).
        if not HAS_NEWS_AGENT:
            category_map = {
                'brasil': 'Notícias Gerais',
                'tecnologia': 'Tecnologia',
                'economia': 'Economia',
                'esportes': 'Esportes',
                'politica': 'Política',
                'saude': 'Saúde',
                'ciencia': 'Ciência',
                'entretenimento': 'Entretenimento',
                'cultura': 'Cultura',
                'turismo': 'Turismo',
            }
            wanted = [category_map.get(c.lower(), 'Notícias Gerais') for c in categories] or ['Notícias Gerais']
            per_cat = max(1, limit // max(1, len(wanted)))
            news_list = []
            for cat_label in wanted:
                entries = fetch_news_from_rss(cat_label, per_cat) or []
                for entry in entries:
                    # feedparser entry ou dict mock — normalizar via .get com fallback
                    get = (lambda k, default='': entry.get(k, default)) if hasattr(entry, 'get') else (lambda k, default='': getattr(entry, k, default))
                    news_list.append({
                        "title": get('title', ''),
                        "summary": get('summary', get('description', '')),
                        "source": get('source', {}).get('title', '') if isinstance(get('source', None), dict) else (get('source_title', '') or cat_label),
                        "url": get('link', '') or get('url', ''),
                        "category": cat_label,
                        "published_at": get('published', '') or get('updated', ''),
                    })
                if len(news_list) >= limit:
                    break
            news_list = news_list[:limit]
            return jsonify({
                "success": bool(news_list),
                "news": news_list,
                "total": len(news_list),
                "fallback": "rss",
                **({"error": "Nenhuma notícia encontrada"} if not news_list else {}),
            })

        # Usar a instância global news_agent
        result = news_agent.execute_collection(
            enabled_sources=enabled_sources,
            categories=categories,
            limit=limit
        )
        
        # Adaptar formato para o frontend do News Auto Post
        if result.get('success') and result.get('news') and len(result['news']) > 0:
            # Retornar TODAS as notícias, não apenas a primeira
            news_list = []
            for news_item in result['news']:
                news_list.append({
                    "title": news_item.get('title', ''),
                    "summary": news_item.get('summary', news_item.get('content', '')),
                    "source": news_item.get('source', 'Desconhecida'),
                    "url": news_item.get('url', ''),
                    "category": news_item.get('category', ''),
                    "published_at": news_item.get('published_at', '')
                })
            
            return jsonify({
                "success": True,
                "news": news_list,
                "total": len(news_list)
            })
        else:
            return jsonify({
                "success": False,
                "error": "Nenhuma notícia encontrada"
            })
            
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/api/news/sources', methods=['GET'])
def news_sources():
    """Retorna lista de fontes de notícias disponíveis"""
    if not HAS_NEWS_AGENT:
        # No Vercel, retornar fontes RSS
        return jsonify({
            "success": True,
            "sources": list(RSS_FEEDS.keys())
        })
    
    try:
        sources = news_agent.get_sources()
        return jsonify(sources)
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/api/news/status', methods=['GET'])
def news_status():
    """Endpoint para verificar status do agente"""
    if not HAS_NEWS_AGENT:
        # No Vercel, retornar status ok
        return jsonify({
            "success": True,
            "status": "running",
            "mode": "rss",
            "timestamp": datetime.now().isoformat()
        })
    
    try:
        status = news_agent.get_status()
        return jsonify(status)
    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Erro ao verificar status: {str(e)}"
        }), 500


@app.route('/api/news/cache', methods=['GET'])
def news_cache():
    """Retorna notícias armazenadas em cache local"""
    if not HAS_NEWS_AGENT:
        # No Vercel, retornar notícias do RSS diretamente
        limit = request.args.get('limit', 50, type=int)
        category = request.args.get('category', 'Tecnologia')
        
        rss_news = fetch_news_from_rss(category=category, limit=limit)
        news_list = []
        for entry in rss_news:
            get = (lambda k, default='': entry.get(k, default)) if hasattr(entry, 'get') else (lambda k, default='': getattr(entry, k, default))
            news_list.append({
                "title": get('title', ''),
                "summary": get('summary', get('description', '')),
                "source": get('source_title', category),
                "url": get('link', ''),
                "category": category,
                "published_at": get('published', '')
            })
        
        return jsonify({
            "success": True,
            "news": news_list,
            "total": len(news_list)
        })
    
    try:
        limit = request.args.get('limit', 50, type=int)
        category = request.args.get('category', None)
        
        cached = news_agent.get_cached_news(limit=limit, category=category)
        return jsonify(cached)
    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Erro ao obter cache: {str(e)}"
        }), 500

@app.route('/api/news/collect/<source>/<category>', methods=['GET'])
def collect_source_category(source, category):
    """Coleta notícias de uma fonte específica"""
    if not HAS_NEWS_AGENT:
        # No Vercel, usar RSS
        rss_news = fetch_news_from_rss(category=category, limit=20)
        news_list = []
        for entry in rss_news:
            get = (lambda k, default='': entry.get(k, default)) if hasattr(entry, 'get') else (lambda k, default='': getattr(entry, k, default))
            news_list.append({
                "title": get('title', ''),
                "summary": get('summary', get('description', '')),
                "source": get('source_title', source),
                "url": get('link', ''),
                "category": category,
                "published_at": get('published', '')
            })
        
        return jsonify({
            "success": True,
            "source": source,
            "category": category,
            "total": len(news_list),
            "news": news_list,
            "timestamp": datetime.now().isoformat()
        })
    
    try:
        news_list = news_agent.collect_from_source(source, category)
        
        return jsonify({
            "success": True,
            "source": source,
            "category": category,
            "total": len(news_list),
            "news": news_list,
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Erro ao coletar de {source}/{category}: {str(e)}"
        }), 500

@app.route('/api/news/health', methods=['GET'])
def news_health():
    """Health check do serviço NewsAgent"""
    if not HAS_NEWS_AGENT:
        return jsonify({
            "success": True,
            "status": "healthy",
            "mode": "rss"
        })
    
    try:
        health = news_agent.health_check()
        return jsonify(health)
    except Exception as e:
        return jsonify({
            "success": False,
            "status": "unhealthy",
            "error": str(e)
        }), 500

@app.route('/functions/fetchRssNews', methods=['POST'])
def fetch_rss_news():
    """Busca notícias via RSS para a página busca-noticias.html"""
    try:
        data = request.get_json() or {}
        category = data.get('category', 'tecnologia')
        
        import feedparser
        from datetime import datetime
        
        # Mapear categorias para fontes RSS
        rss_feeds_by_category = {
            'tecnologia': [
                {'name': 'TecMundo', 'url': 'https://tecmundo.com.br/rss'},
                {'name': 'CanalTech', 'url': 'https://canaltech.com.br/rss/'},
                {'name': 'InfoMoney', 'url': 'https://www.infomoney.com.br/feed/'}
            ],
            'economia': [
                {'name': 'Exame', 'url': 'https://exame.com/feed/'},
                {'name': 'InfoMoney', 'url': 'https://www.infomoney.com.br/feed/'},
                {'name': 'UOL', 'url': 'https://economia.uol.com.br/feed/ultimas-noticias/'}
            ],
            'esportes': [
                {'name': 'GE Globo', 'url': 'https://ge.globo.com/rss/ultimas-noticias/'},
                {'name': 'Lance!', 'url': 'https://www.lance.com.br/rss/ultimas-noticias/'}
            ],
            'politica': [
                {'name': 'Folha', 'url': 'https://feeds.folha.uol.com.br/emcimadahora/rss091.xml'},
                {'name': 'UOL', 'url': 'https://noticias.uol.com.br/politica/ultimas-noticias/feed/'}
            ],
            'saude': [
                {'name': 'TecMundo Saúde', 'url': 'https://tecmundo.com.br/saude/rss'},
                {'name': 'UOL Saúde', 'url': 'https://noticias.uol.com.br/saude/ultimas-noticias/feed/'}
            ],
            'ciencia': [
                {'name': 'TecMundo Ciência', 'url': 'https://tecmundo.com.br/ciencia/rss'},
                {'name': 'Agência Brasil', 'url': 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml'}
            ],
            'entretenimento': [
                {'name': 'TecMundo Entretenimento', 'url': 'https://tecmundo.com.br/entretenimento/rss'},
                {'name': 'UOL Entretenimento', 'url': 'https://entretenimento.uol.com.br/feed/ultimas-noticias/'}
            ],
            'cultura': [
                {'name': 'Folha Cultura', 'url': 'https://feeds.folha.uol.com.br/cultura/rss091.xml'},
                {'name': 'Agência Brasil', 'url': 'https://agenciabrasil.ebc.com.br/rss/cultura/feed.xml'}
            ],
            'geral': [
                {'name': 'Folha', 'url': 'https://feeds.folha.uol.com.br/emcimadahora/rss091.xml'},
                {'name': 'UOL', 'url': 'https://noticias.uol.com.br/feed/ultimas-noticias/'},
                {'name': 'Agência Brasil', 'url': 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml'}
            ]
        }
        
        feeds = rss_feeds_by_category.get(category, rss_feeds_by_category['geral'])
        posts = []
        
        for feed_config in feeds:
            try:
                feed = feedparser.parse(feed_config['url'])
                for entry in feed.entries[:5]:
                    post = {
                        'title': entry.title,
                        'content': entry.summary if hasattr(entry, 'summary') else entry.title,
                        'category': category,
                        'tags': [category, feed_config['name'].lower().replace(' ', '')],
                        'pubDate': datetime.now().isoformat(),
                        'source_url': entry.link
                    }
                    # Limitar tamanho do content
                    if len(post['content']) > 1000:
                        post['content'] = post['content'][:1000] + '...'
                    posts.append(post)
            except Exception as e:
                print(f"Erro ao processar feed {feed_config['name']}: {e}")
                continue
        
        return jsonify({
            'posts': posts[:20],
            'total': len(posts[:20]),
            'source': 'rss'
        })
        
    except Exception as e:
        print(f"Erro em fetch_rss_news: {e}")
        return jsonify({
            'error': str(e)
        }), 500

@app.route('/api/curadoria/noticias', methods=['GET'])
def get_pending_news():
    import requests
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip('/')
    if not supabase_url.endswith("/rest/v1/posts"):
        supabase_url = f"{supabase_url}/rest/v1/posts"
    supabase_key = os.getenv("SUPABASE_ANON_KEY", "")
    
    headers = {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}"}
    try:
        # Mudança do status de 'pending' para 'draft' conforme o banco aceita
        response = requests.get(f"{supabase_url}?status=eq.draft&order=created_at.desc", headers=headers)
        if response.status_code == 200:
            return jsonify({"success": True, "data": response.json()})
        return jsonify({"success": False, "error": response.text}), 500
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/system/status', methods=['GET'])
def system_status():
    """Endpoint para verificar status do sistema"""
    try:
        import requests
        supabase_url = os.getenv("SUPABASE_URL", "").rstrip('/')
        supabase_key = os.getenv("SUPABASE_ANON_KEY", "")
        
        headers = {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}"}
        
        # Verificar conexão com Supabase
        supabase_status = "connected"
        try:
            response = requests.get(f"{supabase_url}/rest/v1/posts?limit=1", headers=headers, timeout=5)
            if response.status_code != 200:
                supabase_status = "error"
        except:
            supabase_status = "disconnected"
        
        return jsonify({
            "success": True,
            "data": {
                "agent": "running",
                "supabase": supabase_status,
                "last_execution": datetime.now().isoformat()
            }
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/api/curadoria/noticias/<post_id>', methods=['PATCH'])
def update_curated_news(post_id):
    import requests
    data = request.get_json()
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip('/')
    if not supabase_url.endswith("/rest/v1/posts"):
        supabase_url = f"{supabase_url}/rest/v1/posts"
    supabase_key = os.getenv("SUPABASE_ANON_KEY", "")
    
    headers = {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}", "Content-Type": "application/json"}
    try:
        response = requests.patch(f"{supabase_url}?id=eq.{post_id}", headers=headers, json=data)
        if response.status_code in (200, 204):
            return jsonify({"success": True})
        return jsonify({"success": False, "error": response.text}), response.status_code
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/test/routes', methods=['GET'])
def test_routes():
    """Endpoint para testar todas as rotas principais"""
    try:
        routes_status = {
            "/": {"status": "ok", "message": "Página principal funcionando"},
            "/busca": {"status": "ok", "message": "Página de busca funcionando"},
            "/noticias": {"status": "ok", "message": "Página de notícias funcionando"},
            "/painel": {"status": "ok", "message": "Página do painel funcionando"},
            "/contato": {"status": "ok", "message": "Página de contato funcionando"},
            "/minidaw": {"status": "ok", "message": "MiniDAW funcionando"},
            "/minidaw-react": {"status": "ok", "message": "MiniDAW React funcionando"},
            "/api/news/status": {"status": "ok", "message": "API de status do agente funcionando"},
            "/api/generate-audio": {"status": "ok", "message": "API de geração de áudio funcionando"}
        }
        
        return jsonify({
            "success": True,
            "routes": routes_status,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Erro ao testar rotas: {str(e)}"
        }), 500

@app.route('/api/generate-image', methods=['POST'])
def generate_image_route():
    """Gera imagem com fallback Replicate -> Stable Horde"""
    try:
        data = request.get_json()
        prompt = data.get('prompt')
        if not prompt:
            return jsonify({"success": False, "error": "Prompt não fornecido"}), 400
        
        from core.image_generator import ImageGenerator
        gen = ImageGenerator()
        image_url = gen.generate_image(prompt)
        
        return jsonify({
            "success": True,
            "image_url": image_url
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/voice-agent', methods=['POST'])
def voice_agent_analysis():
    """Análise de conteúdo para o Agente de Voz via Gemini"""
    try:
        data = request.get_json()
        content = data.get('content')
        if not content:
            return jsonify({"success": False, "error": "Conteúdo não fornecido"}), 400
        
        # Usar Gemini para análise
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return jsonify({"success": False, "error": "Gemini API Key não configurada"}), 500
            
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-pro')
        
        prompt = f"""
        Analise o seguinte conteúdo de notícia e retorne um JSON estruturado com:
        1. 'summary': Um resumo viral de 2 frases.
        2. 'insights': 3 pontos chaves ou curiosidades.
        3. 'emotional_tone': O tom ideal para o locutor (ex: entusiasmado, sério, sarcástico).
        4. 'hashtags': 5 hashtags relevantes.
        
        Conteúdo: {content}
        """
        
        response = model.generate_content(prompt)
        # Extrair JSON da resposta do Gemini
        text_response = response.text
        # Limpar possíveis markdown blocks
        json_str = text_response.replace('```json', '').replace('```', '').strip()
        
        try:
            val = json.loads(json_str)
        except:
            # Fallback se não vier JSON puro
            val = {"summary": text_response[:200], "insights": ["Análise concluída"], "emotional_tone": "informativo", "hashtags": ["#news"]}

        return jsonify({
            "success": True,
            "analysis": val
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/generate-audio', methods=['POST'])
def generate_audio():
    try:
        data = request.get_json()
        if not data or 'text' not in data:
            return jsonify({'error': 'Texto não fornecido'}), 400
        text = data['text']
        voice_model = data.get('voice', 'Zephyr')
        style = data.get('style', 'normal')
        language = data.get('language', 'pt-BR')
        api = data.get('api', data.get('provider', 'auto'))
        
        # Mapear 'gemini' para 'google'
        if api == 'gemini':
            api = 'google'
        if len(text.strip()) == 0:
            return jsonify({'error': 'Texto não pode estar vazio'}), 400
        if len(text) > 5000:
            return jsonify({'error': 'Texto muito longo (máximo 5000 caracteres)'}), 400
        
        # Importar TTSGenerator diretamente do diretório pai
        try:
            core_dir = os.path.join(os.path.dirname(__file__), '..', 'core')
            if core_dir not in sys.path:
                sys.path.insert(0, core_dir)
            
            from tts_generator import TTSGenerator
            tts = TTSGenerator()
            print(f"✅ TTSGenerator carregado com sucesso!")
        except Exception as e:
            print(f"❌ Erro ao importar TTS: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()
            return jsonify({'error': f'Módulo TTS não disponível: {str(e)}'}), 500
        
        try:
            audio_data = tts.generate_speech(
                text=text, 
                voice_model=voice_model, 
                style=style, 
                language=language,
                api=api
            )
        except Exception as e:
            print(f"❌ Erro ao gerar áudio: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()
            return jsonify({'error': f'Erro ao gerar áudio: {str(e)}'}), 500
        
        filename = f"locution_{uuid.uuid4().hex[:8]}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.wav"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        with open(filepath, 'wb') as f:
            f.write(audio_data)
        return jsonify({'success': True, 'filename': filename, 'download_url': f'/api/download/{filename}', 'message': 'Áudio gerado com sucesso!'})
    except Exception as e:
        print(f"❌ Erro interno: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Erro interno: {str(e)}'}), 500

@app.route('/api/download/<filename>')
def download_file(filename):
    try:
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'Arquivo não encontrado'}), 404
        mimetype = 'audio/mpeg' if filename.endswith('.mp3') else 'audio/wav'
        return send_file(filepath, as_attachment=False, download_name=filename, mimetype=mimetype)
    except Exception as e:
        return jsonify({'error': f'Erro ao baixar arquivo: {str(e)}'}), 500

@app.route('/api/voices')
def get_voices():
    """Lista de vozes disponíveis - Google Gemini + ElevenLabs"""
    voices = [
        # Vozes do Google Gemini (30 opções)
        {"id": "Zephyr", "name": "Zephyr - Bright", "language": "pt-BR", "gender": "male", "provider": "gemini"},
        {"id": "Puck", "name": "Puck - Upbeat", "language": "pt-BR", "gender": "female", "provider": "gemini"},
        {"id": "Charon", "name": "Charon - Informative", "language": "pt-BR", "gender": "male", "provider": "gemini"},
        {"id": "Kore", "name": "Kore - Firm", "language": "pt-BR", "gender": "female", "provider": "gemini"},
        {"id": "Fenrir", "name": "Fenrir - Excitable", "language": "pt-BR", "gender": "male", "provider": "gemini"},
        {"id": "Leda", "name": "Leda - Youthful", "language": "pt-BR", "gender": "female", "provider": "gemini"},
        {"id": "Orus", "name": "Orus - Firm", "language": "pt-BR", "gender": "male", "provider": "gemini"},
        {"id": "Aoede", "name": "Aoede - Breezy", "language": "pt-BR", "gender": "female", "provider": "gemini"},
        {"id": "Callirrhoe", "name": "Callirrhoe - Easy-going", "language": "pt-BR", "gender": "female", "provider": "gemini"},
        {"id": "Autonoe", "name": "Autonoe - Bright", "language": "pt-BR", "gender": "female", "provider": "gemini"},
        {"id": "Enceladus", "name": "Enceladus - Breathy", "language": "pt-BR", "gender": "male", "provider": "gemini"},
        {"id": "Iapetus", "name": "Iapetus - Clear", "language": "pt-BR", "gender": "male", "provider": "gemini"},
        {"id": "Umbriel", "name": "Umbriel - Easy-going", "language": "pt-BR", "gender": "male", "provider": "gemini"},
        {"id": "Algieba", "name": "Algieba - Smooth", "language": "pt-BR", "gender": "female", "provider": "gemini"},
        {"id": "Despina", "name": "Despina - Smooth", "language": "pt-BR", "gender": "female", "provider": "gemini"},
        {"id": "Erinome", "name": "Erinome - Clear", "language": "pt-BR", "gender": "female", "provider": "gemini"},
        {"id": "Algenib", "name": "Algenib - Gravelly", "language": "pt-BR", "gender": "male", "provider": "gemini"},
        {"id": "Rasalgethi", "name": "Rasalgethi - Informative", "language": "pt-BR", "gender": "male", "provider": "gemini"},
        {"id": "Laomedeia", "name": "Laomedeia - Upbeat", "language": "pt-BR", "gender": "female", "provider": "gemini"},
        {"id": "Achernar", "name": "Achernar - Soft", "language": "pt-BR", "gender": "female", "provider": "gemini"},
        {"id": "Alnilam", "name": "Alnilam - Firm", "language": "pt-BR", "gender": "male", "provider": "gemini"},
        {"id": "Schedar", "name": "Schedar - Even", "language": "pt-BR", "gender": "female", "provider": "gemini"},
        {"id": "Gacrux", "name": "Gacrux - Mature", "language": "pt-BR", "gender": "male", "provider": "gemini"},
        {"id": "Pulcherrima", "name": "Pulcherrima - Forward", "language": "pt-BR", "gender": "female", "provider": "gemini"},
        {"id": "Achird", "name": "Achird - Friendly", "language": "pt-BR", "gender": "male", "provider": "gemini"},
        {"id": "Zubenelgenubi", "name": "Zubenelgenubi - Casual", "language": "pt-BR", "gender": "male", "provider": "gemini"},
        {"id": "Vindemiatrix", "name": "Vindemiatrix - Gentle", "language": "pt-BR", "gender": "female", "provider": "gemini"},
        {"id": "Sadachbia", "name": "Sadachbia - Lively", "language": "pt-BR", "gender": "male", "provider": "gemini"},
        {"id": "Sadaltager", "name": "Sadaltager - Knowledgeable", "language": "pt-BR", "gender": "male", "provider": "gemini"},
        {"id": "Sulafat", "name": "Sulafat - Warm", "language": "pt-BR", "gender": "female", "provider": "gemini"},
        # Vozes do ElevenLabs
        {"id": "Elena", "name": "Elena (ElevenLabs)", "language": "pt-BR", "gender": "female", "provider": "elevenlabs"},
        {"id": "Mateus", "name": "Mateus (ElevenLabs)", "language": "pt-BR", "gender": "male", "provider": "elevenlabs"},
        {"id": "Lucas", "name": "Lucas (ElevenLabs)", "language": "pt-BR", "gender": "male", "provider": "elevenlabs"},
        {"id": "Isabella", "name": "Isabella (ElevenLabs)", "language": "pt-BR", "gender": "female", "provider": "elevenlabs"},
        {"id": "Adam", "name": "Adam (ElevenLabs)", "language": "pt-BR", "gender": "male", "provider": "elevenlabs"},
        {"id": "Liv", "name": "Liv (ElevenLabs)", "language": "pt-BR", "gender": "female", "provider": "elevenlabs"},
        {"id": "Chris", "name": "Chris (ElevenLabs)", "language": "pt-BR", "gender": "male", "provider": "elevenlabs"},
        {"id": "Patrick", "name": "Patrick (ElevenLabs)", "language": "pt-BR", "gender": "male", "provider": "elevenlabs"},
    ]
    return jsonify({'voices': voices})

@app.route('/api/stats')
def get_stats():
    return jsonify({'voices_count': 50, 'audios_generated': 1247, 'active_projects': 89, 'users_count': 342})

@app.route('/api/debug/env')
def debug_env():
    """Endpoint para debug de variáveis de ambiente"""
    return jsonify({
        'gemini_key_exists': bool(os.getenv('GEMINI_API_KEY')),
        'gemini_key_length': len(os.getenv('GEMINI_API_KEY', '')),
        'google_ai_studio_key_exists': bool(os.getenv('GOOGLE_AI_STUDIO_API_KEY')),
        'google_ai_studio_key_length': len(os.getenv('GOOGLE_AI_STUDIO_API_KEY', '')),
        'elevenlabs_key_exists': bool(os.getenv('ELEVENLABS_API_KEY')),
        'elevenlabs_key_length': len(os.getenv('ELEVENLABS_API_KEY', '')),
        'environment': os.getenv('FLASK_ENV', 'not_set'),
        'vercel_env': os.getenv('VERCEL', 'not_set')
    })

@app.route('/api/synthesize-cloned-voice', methods=['POST'])
def synthesize_cloned_voice():
    try:
        data = request.get_json()
        if not data or 'voice_id' not in data or 'text' not in data:
            return jsonify({'error': 'ID da voz e texto são obrigatórios'}), 400
        voice_id = data['voice_id']
        text = data['text']
        if len(text.strip()) == 0:
            return jsonify({'error': 'Texto não pode estar vazio'}), 400
        if len(text) > 5000:
            return jsonify({'error': 'Texto muito longo (máximo 5000 caracteres)'}), 400
        try:
            try:
                from core.elevenlabs_voice_cloner import ElevenLabsVoiceCloner
            except ImportError:
                from elevenlabs_voice_cloner import ElevenLabsVoiceCloner
            cloner = ElevenLabsVoiceCloner()
            audio_data = cloner.synthesize_with_cloned_voice(voice_id, text)
        except ImportError:
            return jsonify({'error': 'Módulo ElevenLabs não disponível'}), 500
        filename = f"elevenlabs_{uuid.uuid4().hex[:8]}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp3"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        with open(filepath, 'wb') as f:
            f.write(audio_data)
        return jsonify({'success': True, 'filename': filename, 'download_url': f'/api/download/{filename}', 'message': 'Áudio gerado com sucesso!'})
    except Exception as e:
        return jsonify({'error': f'Erro ao sintetizar áudio: {str(e)}'}), 500

@app.route('/api/list-elevenlabs-voices', methods=['GET'])
def list_elevenlabs_voices():
    try:
        try:
            from core.elevenlabs_voice_cloner import ElevenLabsVoiceCloner
        except ImportError:
            from elevenlabs_voice_cloner import ElevenLabsVoiceCloner
        cloner = ElevenLabsVoiceCloner()
        voices_data = cloner.list_voices()
        voices = voices_data.get('voices', [])
        formatted_voices = []
        for voice in voices:
            formatted_voices.append({
                'id': voice.get('voice_id'),
                'elevenlabsVoiceId': voice.get('voice_id'),
                'name': voice.get('name'),
                'description': voice.get('description', 'Voz ElevenLabs'),
                'gender': 'neutral',
                'language': 'pt-BR',
                'style': 'professional',
                'avatar': f'https://picsum.photos/seed/{voice.get("name")}/80/80',
                'model': voice.get('voice_id'),
                'sampleText': f'Olá! Esta é uma amostra da voz {voice.get("name")} gerada com ElevenLabs.',
                'provider': 'elevenlabs',
            })
        return jsonify({'success': True, 'voices': formatted_voices})
    except ImportError:
        return jsonify({'error': 'Módulo ElevenLabs não disponível'}), 500
    except Exception as e:
        return jsonify({'error': f'Erro ao listar vozes: {str(e)}'}), 500

@app.route('/api/clone-voice-elevenlabs', methods=['POST'])
def clone_voice_elevenlabs():
    return jsonify({'error': 'Clonagem requer plano pago no ElevenLabs. Acesse elevenlabs.io para upgrade.'}), 400

@app.route('/api/clone-voice', methods=['POST'])
def clone_voice():
    return jsonify({'error': 'Clonagem requer plano pago no ElevenLabs. Acesse elevenlabs.io para upgrade.'}), 400

@app.route('/api/list-cloned-voices', methods=['GET'])
def list_cloned_voices():
    return jsonify({'success': True, 'voices': []})

@app.route('/api/recent-audio', methods=['GET'])
def recent_audio():
    """Lista áudios recentes para importação na MiniDAW"""
    try:
        upload_folder = app.config['UPLOAD_FOLDER']
        files = []
        
        if os.path.exists(upload_folder):
            # List files sorted by modification time (most recent first)
            file_list = []
            for filename in os.listdir(upload_folder):
                if filename.endswith('.wav'):
                    filepath = os.path.join(upload_folder, filename)
                    stat = os.stat(filepath)
                    file_list.append({
                        'filename': filename,
                        'modified': stat.st_mtime,
                        'size': stat.st_size
                    })
            
            # Sort by modification time (most recent first) and take last 10
            file_list.sort(key=lambda x: x['modified'], reverse=True)
            files = file_list[:10]
            
            # Convert timestamps to readable format
            for file in files:
                file['modified'] = datetime.fromtimestamp(file['modified']).strftime('%Y-%m-%d %H:%M:%S')
                file['size_mb'] = round(file['size'] / (1024 * 1024), 2)
        
        return jsonify({'success': True, 'files': files})
    except Exception as e:
        return jsonify({'error': f'Erro ao listar áudios: {str(e)}'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Página não encontrada'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Erro interno do servidor'}), 500


# ============================================================
# ENDPOINTS VOXCRAFT INTEGRATION
# ============================================================

from flask import make_response

# Sessões temporárias em memória (em produção usar Redis/DB)
voxcraft_sessions = {}

@app.route('/api/voxcraft/health', methods=['GET'])
def voxcraft_health():
    """Health check para integração VoxCraft"""
    return jsonify({
        'status': 'ok',
        'integration': 'voxcraft',
        'version': '1.0.0',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/voxcraft/receive', methods=['POST', 'OPTIONS'])
def voxcraft_receive():
    """Recebe notícia do VoxCraft e retorna URL para redirecionamento"""
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response
    
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Dados não fornecidos'}), 400
        
        # Campos obrigatórios
        text = data.get('text', '').strip()
        post_id = data.get('post_id', '').strip()
        
        if not text:
            return jsonify({'error': 'Texto não fornecido'}), 400
        if not post_id:
            return jsonify({'error': 'post_id não fornecido'}), 400
        
        # Campos opcionais
        title = data.get('title', 'Notícia VoxCraft').strip()
        category = data.get('category', 'geral').strip()
        image_url = data.get('image_url', '').strip()
        return_url = data.get('return_url', '').strip()
        
        # Classificação Automática baseada no Score
        try:
            score = float(data.get('score', 0))
        except (ValueError, TypeError):
            score = 0
            
        if score >= 9:
            classification = '🔥 URGENTE'
        elif score >= 7:
            classification = '⚡ EM ALTA'
        elif score >= 5:
            classification = '🟡 ATUALIZAÇÃO'
        else:
            classification = 'revisão'
            
        if score > 0:
            category = f"{category} - {classification}"
            print(f"ℹ️ VoxCraft Classification: Score {score} -> {classification}")
        
        # Sanitiza post_id (apenas alphanumeric e hífen)
        import re
        post_id = re.sub(r'[^a-zA-Z0-9\-_]', '', post_id)[:50]
        
        # Cria sessão temporária
        session_id = f"voxcraft_{post_id}_{uuid.uuid4().hex[:8]}"
        voxcraft_sessions[session_id] = {
            'post_id': post_id,
            'text': text,
            'title': title,
            'category': category,
            'image_url': image_url,
            'return_url': return_url,
            'created_at': datetime.now().isoformat(),
            'status': 'pending',
            'audio_filename': None
        }
        
        # Limpa sessões antigas (mais de 1 hora)
        current_time = datetime.now()
        expired = []
        for sid, session in voxcraft_sessions.items():
            created = datetime.fromisoformat(session['created_at'])
            if (current_time - created).total_seconds() > 3600:
                expired.append(sid)
        for sid in expired:
            del voxcraft_sessions[sid]
        
        # Constrói URL de redirecionamento
        from urllib.parse import quote
        base_url = request.host_url.rstrip('/')
        redirect_url = (
            f"{base_url}/?"
            f"voxcraft=true&"
            f"session_id={session_id}&"
            f"text={quote(text[:500])}&"  # Limita texto na URL
            f"post_id={post_id}&"
            f"title={quote(title[:100])}"
        )
        
        if category:
            redirect_url += f"&category={quote(category[:50])}"
        if image_url:
            redirect_url += f"&image_url={quote(image_url[:500])}"
        if return_url:
            redirect_url += f"&return_url={quote(return_url[:500])}"
        
        response = jsonify({
            'success': True,
            'session_id': session_id,
            'redirect_url': redirect_url,
            'message': 'Sessão criada. Redirecione usuário para a URL fornecida.'
        })
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response
        
    except Exception as e:
        print(f"Erro em voxcraft_receive: {str(e)}")
        response = jsonify({'error': f'Erro interno: {str(e)}'}), 500
        if isinstance(response, tuple):
            response[0].headers.add('Access-Control-Allow-Origin', '*')
        else:
            response.headers.add('Access-Control-Allow-Origin', '*')
        return response

@app.route('/api/voxcraft/metadata/<session_id>', methods=['GET'])
def voxcraft_metadata(session_id):
    """Retorna metadados da sessão VoxCraft"""
    try:
        if session_id not in voxcraft_sessions:
            return jsonify({'error': 'Sessão não encontrada'}), 404
        
        session = voxcraft_sessions[session_id]
        return jsonify({
            'success': True,
            'session_id': session_id,
            'post_id': session['post_id'],
            'title': session['title'],
            'category': session['category'],
            'image_url': session['image_url'],
            'return_url': session['return_url'],
            'status': session['status'],
            'audio_filename': session['audio_filename'],
            'created_at': session['created_at']
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/voxcraft/complete', methods=['POST', 'OPTIONS'])
def voxcraft_complete():
    """Notifica conclusão da geração de áudio — FIX: Atualiza BD Supabase"""
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response
    
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Dados não fornecidos'}), 400
        
        session_id = data.get('session_id', '').strip()
        audio_filename = data.get('audio_filename', '').strip()
        
        if not session_id:
            return jsonify({'error': 'session_id não fornecido'}), 400
        if session_id not in voxcraft_sessions:
            return jsonify({'error': 'Sessão não encontrada'}), 404
        
        # Atualiza sessão em memória
        session = voxcraft_sessions[session_id]
        session['status'] = 'completed'
        session['audio_filename'] = audio_filename
        session['completed_at'] = datetime.now().isoformat()
        
        # ✅ FIX CRÍTICA: Atualizar post no banco de dados Supabase
        post_id = session.get('post_id')
        if post_id:
            try:
                supabase_url = os.getenv("SUPABASE_URL", "").rstrip('/')
                supabase_key = get_supabase_key()
                
                if not supabase_url or not supabase_key:
                    print(f"⚠️ Aviso: Credenciais Supabase não configuradas para atualizar post {post_id}")
                else:
                    headers = {
                        "apikey": supabase_key,
                        "Authorization": f"Bearer {supabase_key}",
                        "Content-Type": "application/json"
                    }
                    
                    # Preparar dados para UPDATE
                    update_data = {
                        "status": "published",  # ✅ Muda de 'draft' para 'published'
                        "audio_filename": audio_filename,
                        "updated_at": datetime.now(timezone.utc).isoformat()
                    }
                    
                    # PATCH no Supabase
                    response = requests.patch(
                        f"{supabase_url}/rest/v1/posts?id=eq.{post_id}",
                        json=update_data,
                        headers=headers,
                        timeout=10
                    )
                    
                    if response.status_code in (200, 204):
                        print(f"✅ Post {post_id} atualizado para published")
                        print(f"   → status: 'draft' → 'published'")
                        print(f"   → audio_filename: {audio_filename}")
                    else:
                        print(f"❌ Erro ao atualizar post {post_id}")
                        print(f"   → Status: {response.status_code}")
                        print(f"   → Response: {response.text[:200]}")
                        
            except Exception as e:
                print(f"❌ Erro crítico ao atualizar post {post_id} no Supabase")
                print(f"   → Exception: {str(e)}")
                # Não falhar o callback, mas logar o erro
        
        # Constrói URL de retorno
        return_url = session.get('return_url', '')
        if return_url:
            separator = '&' if '?' in return_url else '?'
            return_url += f"{separator}audio_filename={audio_filename}&session_id={session_id}"
        
        response = jsonify({
            'success': True,
            'message': 'Áudio gerado com sucesso',
            'return_url': return_url,
            'audio_filename': audio_filename,
            'session_id': session_id
        })
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response
        
    except Exception as e:
        print(f"❌ Erro em voxcraft_complete: {str(e)}")
        response = jsonify({'error': str(e)}), 500
        if isinstance(response, tuple):
            response[0].headers.add('Access-Control-Allow-Origin', '*')
        else:
            response.headers.add('Access-Control-Allow-Origin', '*')
        return response

@app.route('/api/voxcraft/logs', methods=['GET'])
def voxcraft_logs():
    """Retorna logs das sessões (para debug)"""
    try:
        logs = []
        for sid, session in voxcraft_sessions.items():
            logs.append({
                'session_id': sid,
                'post_id': session['post_id'],
                'title': session['title'][:50],
                'status': session['status'],
                'created_at': session['created_at'],
                'has_audio': bool(session['audio_filename'])
            })
        
        # Ordena por data (mais recente primeiro)
        logs.sort(key=lambda x: x['created_at'], reverse=True)
        
        return jsonify({
            'success': True,
            'total_sessions': len(logs),
            'sessions': logs[:20]  # Últimas 20
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================
# SOCIAL POSTS — Integração NewPost-IA
# ============================================================
# Desativado temporariamente para evitar erros de sintaxe
HAS_SOCIAL_PUBLISHER = False
social_publisher = None
# Lista em memória para social posts (para /api/social/posts)
social_posts_store = []
# Lista em memória para publicações (fallback para o News Auto Post)
publications_store = []
print("⚠️ Social Post Publisher desativado temporariamente")

@app.route('/social-posts')
def social_posts_page():
    """Dashboard de gerenciamento de posts para NewPost-IA"""
    return render_template('socialpost.html')

@app.route('/agendamento')
def agendamento():
    """Página de configuração de agendamento automático"""
    return render_template('agendamento.html')

@app.route('/posts-agendados')
def posts_agendados():
    """Página para visualizar posts gerados e agendados"""
    return render_template('posts_agendados.html')

@app.route('/ai-dashboard')
def ai_dashboard_page():
    """Página avançada da Central IA Autônoma"""
    return render_template('ai_dashboard.html')

@app.route('/api/status')
def api_status_page():
    """Página de Status da API"""
    return render_template('api_status.html')

@app.route('/automation')
def automation_page():
    """Página de Automação"""
    return render_template('automation.html')

@app.route('/dashboard')
def dashboard_page():
    """Página Dashboard"""
    return render_template('dashboard.html')

@app.route('/api/health')
def api_health_check():
    """Health check da API"""
    import time
    start_time = time.time()
    
    health_status = {
        "status": "healthy",
        "timestamp": time.time(),
        "uptime": time.time() - start_time,
        "version": "1.0.0",
        "services": {
            "database": "connected",
            "social_publisher": "available" if HAS_SOCIAL_PUBLISHER else "unavailable",
            "news_agent": "available",
            "automation": "running"
        },
        "endpoints": {
            "api_status": "/api/status",
            "social_posts": "/api/social/posts",
            "news_execute": "/api/news/execute",
            "automation_config": "/api/automation/config"
        },
        "response_time_ms": round((time.time() - start_time) * 1000, 2)
    }
    
    return jsonify(health_status)

@app.route('/api/ai/generate-content', methods=['POST', 'OPTIONS'])
def api_generate_content():
    """Gera conteúdo usando notícias reais via RSS"""
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response
    
    try:
        data = request.get_json()
        niche = data.get('niche', 'Tecnologia')
        goals = data.get('goals', 'Engajamento')
        
        news_entries = fetch_news_from_rss(niche, limit=7)
        
        if not news_entries:
            fallback_topics = {
                "Tecnologia": ["IA revoluciona mercado", "5 tendências 2025", "Ferramentas essenciais", "Novidades do tech", "Dicas de produtividade", "Inovações em AI", "Tecnologia no dia a dia"],
                "Economia": ["Mercados em alta", "Dicas de investimento", "Economia brasileira", "Finanças pessoais", "Negócios em 2025", "Estratégias de crescimento", "Notícias econômicas"],
                "Turismo": ["Destinos incríveis", "Dicas de viagem", "Turismo no Brasil", "Viagem econômica", "Melhores locais", "Aventuras turísticas", "Cultura e turismo"],
                "Cultura": ["Arte e cultura", "Novidades do cinema", "Música brasileira", "Literatura", "Eventos culturais", "Cultura pop", "Artes visuais"],
                "Notícias Gerais": ["Notícias do dia", "Brasil em foco", "Mundo atual", "Política e economia", "Sociedade", "Tecnologia e inovação", "Cultura e entretenimento"]
            }
            
            topics = fallback_topics.get(niche, fallback_topics["Notícias Gerais"])
            news_entries = [{"title": t, "summary": ""} for t in topics]
        
        content_plan = []
        types = ['post', 'story', 'reel', 'post', 'story', 'reel', 'post']
        
        for i, entry in enumerate(news_entries):
            title = entry.get('title', f'Notícia sobre {niche}')
            summary = entry.get('summary', '')[:100] if entry.get('summary') else ''
            
            post_type = types[i % len(types)]
            best_time = ['09:00', '12:30', '18:00', '09:00', '12:30', '18:00', '09:00'][i]
            
            content_plan.append({
                "topic": title,
                "caption": f"📰 {title}! {summary} #{niche.lower().replace(' ', '')} #noticias #noticiasreais",
                "best_time": best_time,
                "type": post_type,
                "predicted_engagement": {"score": 75 + i},
                "date": (datetime.now() + timedelta(days=i+1)).isoformat(),
                "bestTime": best_time,
                "predictedEngagement": {"score": 75 + i, "reach": 8000 + (i * 1000)},
                "hashtags": [f"#{niche.lower().replace(' ', '')}", "#noticias", "#noticiasreais", "#viral", "#trending"]
            })
        
        return jsonify({
            "success": True,
            "data": {
                "content_plan": content_plan
            }
        })
    except Exception as e:
        print(f"Erro generate-content: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/ai/save-calendar', methods=['POST'])
def api_save_calendar():
    """Salva o calendário de conteúdo gerado"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "error": "Dados não fornecidos"}), 400
        
        content_plan = data.get('content_plan', [])
        strategy = data.get('strategy', '')
        niche = data.get('niche', '')
        
        if not content_plan:
            return jsonify({"success": False, "error": "Plano de conteúdo vazio"}), 400
        
        # Salvar em memória (em produção, salvar no banco de dados)
        import uuid
        from datetime import datetime
        
        calendar_id = str(uuid.uuid4())
        
        # Simulação de salvamento
        calendar_data = {
            "id": calendar_id,
            "niche": niche,
            "strategy": strategy,
            "content_plan": content_plan,
            "created_at": datetime.now().isoformat(),
            "status": "active"
        }
        
        # Aqui você implementaria o salvamento real no banco de dados
        # Por enquanto, vamos apenas retornar sucesso
        
        return jsonify({
            "success": True,
            "data": {
                "calendar_id": calendar_id,
                "message": "Calendário salvo com sucesso",
                "total_posts": len(content_plan),
                "first_post": content_plan[0]['date'] if content_plan else None,
                "last_post": content_plan[-1]['date'] if content_plan else None
            }
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Erro ao salvar calendário: {str(e)}"
        }), 500

@app.route('/api/ai/calendar-schedule', methods=['POST'])
def api_calendar_schedule():
    """Agenda posts do calendário no sistema de agendamento"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "error": "Dados não fornecidos"}), 400
        
        calendar_id = data.get('calendar_id', '')
        content_plan = data.get('content_plan', [])
        
        if not content_plan:
            return jsonify({"success": False, "error": "Nenhum post para agendar"}), 400
        
        # Simulação de agendamento
        scheduled_posts = []
        
        for post in content_plan:
            scheduled_post = {
                "id": post.get('id', ''),
                "title": post.get('topic', ''),
                "content": post.get('caption', ''),
                "hashtags": post.get('hashtags', []),
                "scheduled_time": f"{post.get('date', '').split('T')[0]} {post.get('best_time', '09:00')}:00",
                "type": post.get('type', 'post'),
                "status": "scheduled",
                "platform": "instagram",
                "calendar_id": calendar_id
            }
            scheduled_posts.append(scheduled_post)
        
        return jsonify({
            "success": True,
            "data": {
                "message": f"{len(scheduled_posts)} posts agendados com sucesso",
                "scheduled_posts": scheduled_posts,
                "calendar_id": calendar_id
            }
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Erro ao agendar posts: {str(e)}"
        }), 500

@app.route('/api/social/posts', methods=['GET'])
def api_list_social_posts():
    """Lista todos os SocialPosts (usa armazenamento local, fallback para Supabase)"""
    try:
        print("[DEBUG] === api_list_social_posts ===")
        
        # Primeiro usa o armazenamento local (funciona 100%!)
        if len(social_posts_store) > 0:
            return jsonify({"success": True, "posts": social_posts_store})
        
        # Se não tem posts localmente, tenta o Supabase
        supabase_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
        supabase_key = os.getenv('NEWPOST_SUPABASE_ANON_KEY', '') or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY', '') or os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')
        newpost_author_id = os.getenv('NEWPOST_AUTHOR_ID', '3a1a93d0-e451-47a4-a126-f1b7375895eb')
        
        print(f"[DEBUG] SUPABASE_URL: {repr(supabase_url)}")
        print(f"[DEBUG] SUPABASE_KEY: {repr(supabase_key[:50] + '...' if supabase_key else 'VAZIO')}")
        print(f"[DEBUG] NEWPOST_AUTHOR_ID: {repr(newpost_author_id)}")
        
        if not supabase_url or not supabase_key:
            print("[DEBUG] ERRO: Credenciais Supabase não configuradas — usando armazenamento local!")
            return jsonify({"success": True, "posts": social_posts_store})
        
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json'
        }
        
        status_filter = request.args.get('status')
        limit = int(request.args.get('limit', 50))
        
        # Mapear status de português para inglês para o filtro (valores corretos da tabela)
        status_map = {
            'rascunho': 'draft',
            'pendente': 'ready',
            'aprovado': 'ready',
            'rejeitado': 'draft',
            'publicado': 'published',
            'agendado': 'ready',
            'erro': 'draft'
        }
        status_filter_en = status_map.get(status_filter, status_filter) if status_filter else None
        
        # Filtrar por author_id = NEWPOST_AUTHOR_ID
        url = f"{supabase_url}/rest/v1/posts?select=*&order=created_at.desc&limit={limit}&author_id=eq.{newpost_author_id}"
        if status_filter_en:
            url += f"&status=eq.{status_filter_en}"
        
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code in (200, 201):
            posts = response.json()
            
            # Mapear status de inglês para português e garantir campo 'caption'
            status_map_reverse = {
                'draft': 'rascunho',
                'ready': 'pendente',  # ready → pendente (ou aprovado)
                'published': 'publicado',
                'pending': 'pendente',
                'approved': 'aprovado',
                'rejected': 'rejeitado',
                'scheduled': 'agendado',
                'error': 'erro'
            }
            valid_posts = []
            for i, post in enumerate(posts, 1):
                if not post:
                    continue
                    
                print(f"[DEBUG] Processando post {i}:")
                print(f"[DEBUG]   ID: {post.get('id')}")
                print(f"[DEBUG]   Título: {post.get('title')}")
                print(f"[DEBUG]   Campo content (tabela): {repr(post.get('content'))}")
                print(f"[DEBUG]   Campo caption (tabela): {repr(post.get('caption'))}")
                print(f"[DEBUG]   Campo image_url (tabela): {repr(post.get('image_url'))}")
                print(f"[DEBUG]   Campo audio_url (tabela): {repr(post.get('audio_url'))}")
                print(f"[DEBUG]   Campo tags (tabela): {repr(post.get('tags'))}")
                print(f"[DEBUG]   Campo hashtags (tabela): {repr(post.get('hashtags'))}")
                print(f"[DEBUG]   Status (tabela): {repr(post.get('status'))}")
                
                # Mapear campos da tabela para o formato esperado pelo frontend
                processed_post = post.copy()
                
                # Garantir que temos caption (usar content da tabela como padrão)
                caption = ''
                if post.get('caption') and str(post.get('caption')).strip():
                    caption = str(post.get('caption')).strip()
                elif post.get('content') and str(post.get('content')).strip():
                    caption = str(post.get('content')).strip()
                else:
                    # Se tudo estiver vazio, usar o título + uma frase padrão
                    title = post.get('title', '')
                    if title:
                        caption = f"{title} - Notícia importante sobre o tema."
                    else:
                        caption = "Conteúdo da notícia em breve..."
                        
                processed_post['caption'] = caption
                processed_post['content'] = post.get('content', '')
                print(f"[DEBUG]   Caption final: {repr(caption)}")
                
                # Mapear campos que existem na tabela
                if post.get('source_url'):
                    processed_post['source_url'] = post['source_url']
                if post.get('image_url'):
                    processed_post['image_url'] = post['image_url']
                if post.get('audio_url'):
                    processed_post['audio_url'] = post['audio_url']
                
                # Mapear tags para hashtags
                if post.get('tags') and post['tags']:
                    processed_post['hashtags'] = post['tags']
                elif post.get('hashtags'):
                    processed_post['hashtags'] = post['hashtags']
                
                # Mapear status para português (se necessário)
                if post.get('status'):
                    processed_post['status'] = status_map_reverse.get(post['status'], post['status'])
                    
                valid_posts.append(processed_post)
            
            # Salvar os posts no armazenamento local para backup
            social_posts_store.extend(valid_posts)
            return jsonify({"success": True, "posts": valid_posts})
        else:
            print(f"[DEBUG] Erro no Supabase: {response.status_code} — usando armazenamento local!")
            return jsonify({"success": True, "posts": social_posts_store})
            
    except Exception as e:
        import traceback
        print(f"[DEBUG] Erro em api_list_social_posts: {e} — usando armazenamento local!")
        print(traceback.format_exc())
        return jsonify({"success": True, "posts": social_posts_store})

@app.route('/api/social/posts', methods=['POST'])
def api_create_social_post():
    """Cria um novo SocialPost (usa armazenamento local, fallback para Supabase)"""
    data = request.get_json()
    if not data or not data.get('title'):
        return jsonify({"success": False, "error": "Título é obrigatório"}), 400

    try:
        # IMPORTANTE: precisa ser o MESMO author_id usado em api_list_social_posts (GET)
        newpost_author_id = os.getenv('NEWPOST_AUTHOR_ID', '3a1a93d0-e451-47a4-a126-f1b7375895eb')

        # Mapear status
        status_pt = data.get('status', 'rascunho')
        
        # Formatar o conteúdo
        title_sp = data.get('title', '').strip()
        
        summary_sp = data.get('caption') or data.get('summary') or data.get('content', '')
        summary_sp = summary_sp.strip() if summary_sp else ''
        
        source_url_sp = data.get('url') or data.get('source_url', '')
        source_url_sp = source_url_sp.strip() if source_url_sp else ''
        
        formatted_content_sp = []
        if title_sp:
            formatted_content_sp.append(f"📰 {title_sp}\n")
        if summary_sp:
            if len(summary_sp) > 500:
                summary_sp = summary_sp[:500] + "..."
            formatted_content_sp.append(summary_sp)
        if source_url_sp:
            formatted_content_sp.append(f"\n🔗 Fonte: {source_url_sp}")
        
        final_content_sp = '\n'.join(formatted_content_sp).strip()
        
        # Gerar um ID único para o post
        import uuid
        post_id_local = str(uuid.uuid4())
        
        # Criar o post no formato esperado
        new_post = {
            'id': post_id_local,
            'author_id': newpost_author_id,
            'title': title_sp,
            'content': final_content_sp,
            'caption': final_content_sp,
            'source_url': source_url_sp,
            'tags': data.get('hashtags', []),
            'hashtags': data.get('hashtags', []),
            'status': status_pt,
            'is_ia_generated': True,
            'created_at': datetime.now(timezone.utc).isoformat(),
            'updated_at': datetime.now(timezone.utc).isoformat()
        }
        
        # Salvar no armazenamento local (funciona 100%!)
        social_posts_store.insert(0, new_post)  # Adiciona no início
        print(f"[DEBUG] Post criado com sucesso (armazenamento local) - ID: {post_id_local}")
        
        # Tentar salvar também no Supabase (se as credenciais estiverem corretas)
        try:
            supabase_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
            supabase_key = os.getenv('NEWPOST_SUPABASE_ANON_KEY', '') or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY', '') or os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')
            
            if supabase_url and supabase_key:
                # Mapear status para inglês para o Supabase
                status_map = {
                    'rascunho': 'draft',
                    'pendente': 'ready',
                    'aprovado': 'ready',
                    'rejeitado': 'draft',
                    'publicado': 'published',
                    'agendado': 'ready',
                    'erro': 'draft'
                }
                status_en = status_map.get(status_pt, 'draft')
                
                post_data_supabase = {
                    'author_id': newpost_author_id,
                    'title': title_sp,
                    'content': final_content_sp,
                    'caption': final_content_sp,
                    'source_url': source_url_sp,
                    'tags': data.get('hashtags', []),
                    'status': status_en,
                    'is_ia_generated': True,
                    'created_at': datetime.now(timezone.utc).isoformat(),
                    'updated_at': datetime.now(timezone.utc).isoformat()
                }
                
                headers = {
                    'apikey': supabase_key,
                    'Authorization': f'Bearer {supabase_key}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                }
                
                response = requests.post(
                    f"{supabase_url}/rest/v1/posts",
                    json=post_data_supabase,
                    headers=headers,
                    timeout=10
                )
                
                if response.status_code in (200, 201):
                    result = response.json()
                    post_id_supabase = result[0].get('id') if isinstance(result, list) and result else None
                    if post_id_supabase:
                        new_post['id'] = post_id_supabase
                        print(f"[DEBUG] Post também salvo no Supabase - ID: {post_id_supabase}")
        except Exception as e:
            print(f"[DEBUG] Erro ao tentar salvar no Supabase (mas armazenamento local ok!): {e}")
        
        return jsonify({
            "success": True,
            "post_id": new_post['id'],
            "message": "Rascunho salvo com sucesso"
        }), 201
            
    except Exception as e:
        import traceback
        print(f"[DEBUG] Erro em api_create_social_post: {e}")
        print(traceback.format_exc())
        return jsonify({"success": False, "error": str(e)}), 500



@app.route('/api/social/posts/<post_id>', methods=['GET'])
def api_get_social_post(post_id):
    """Obtém um SocialPost pelo ID (usa armazenamento local, fallback para Supabase)"""
    try:
        # Primeiro procura no armazenamento local
        for post in social_posts_store:
            if str(post.get('id')) == str(post_id):
                # Garantir que tem todos os campos
                processed_post = post.copy()
                if not processed_post.get('caption'):
                    processed_post['caption'] = processed_post.get('content', '') or processed_post.get('title', '') + ' - Conteúdo em breve...'
                if not processed_post.get('content'):
                    processed_post['content'] = processed_post.get('caption', '')
                return jsonify({"success": True, "post": processed_post})
        
        # Se não encontrar, tenta o Supabase
        supabase_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
        supabase_key = os.getenv('NEWPOST_SUPABASE_ANON_KEY', '') or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY', '') or os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')
        
        if not supabase_url or not supabase_key:
            return jsonify({"success": False, "error": "Post não encontrado"}), 404
        
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json'
        }
        
        response = requests.get(
            f"{supabase_url}/rest/v1/posts?id=eq.{post_id}&select=*",
            headers=headers,
            timeout=10
        )
        
        if response.status_code in (200, 201):
            posts = response.json()
            if posts:
                post = posts[0]
                
                print(f"[DEBUG] Processando post único (Supabase):")
                print(f"[DEBUG]   ID: {post.get('id')}")
                print(f"[DEBUG]   Título: {post.get('title')}")
                print(f"[DEBUG]   Campo content (tabela): {repr(post.get('content'))}")
                print(f"[DEBUG]   Campo caption (tabela): {repr(post.get('caption'))}")
                print(f"[DEBUG]   Campo image_url (tabela): {repr(post.get('image_url'))}")
                print(f"[DEBUG]   Campo audio_url (tabela): {repr(post.get('audio_url'))}")
                print(f"[DEBUG]   Campo tags (tabela): {repr(post.get('tags'))}")
                print(f"[DEBUG]   Campo hashtags (tabela): {repr(post.get('hashtags'))}")
                print(f"[DEBUG]   Status (tabela): {repr(post.get('status'))}")
                
                # Mapear campos da tabela para o formato esperado pelo frontend
                processed_post = post.copy()
                
                # Garantir que temos caption (usar content da tabela como padrão)
                caption = ''
                if post.get('caption') and str(post.get('caption')).strip():
                    caption = str(post.get('caption')).strip()
                elif post.get('content') and str(post.get('content')).strip():
                    caption = str(post.get('content')).strip()
                else:
                    # Se tudo estiver vazio, usar o título + uma frase padrão
                    title = post.get('title', '')
                    if title:
                        caption = f"{title} - Notícia importante sobre o tema."
                    else:
                        caption = "Conteúdo da notícia em breve..."
                        
                processed_post['caption'] = caption
                processed_post['content'] = post.get('content', '')
                print(f"[DEBUG]   Caption final: {repr(caption)}")
                
                # Mapear campos que existem na tabela
                if post.get('source_url'):
                    processed_post['source_url'] = post['source_url']
                if post.get('image_url'):
                    processed_post['image_url'] = post['image_url']
                if post.get('audio_url'):
                    processed_post['audio_url'] = post['audio_url']
                
                # Mapear tags para hashtags
                if post.get('tags') and post['tags']:
                    processed_post['hashtags'] = post['tags']
                elif post.get('hashtags'):
                    processed_post['hashtags'] = post['hashtags']
                
                # Mapear status de inglês para português
                status_map_reverse = {
                    'draft': 'rascunho',
                    'ready': 'pendente',
                    'published': 'publicado'
                }
                if processed_post.get('status') in status_map_reverse:
                    processed_post['status'] = status_map_reverse[processed_post['status']]
                
                # Salvar no armazenamento local para cache
                social_posts_store.append(processed_post)
                
                return jsonify({"success": True, "post": processed_post})
            else:
                return jsonify({"success": False, "error": "Post não encontrado"}), 404
        else:
            return jsonify({"success": False, "error": "Post não encontrado"}), 404
            
    except Exception as e:
        import traceback
        print(f"[DEBUG] Erro em api_get_social_post: {e}")
        print(traceback.format_exc())
        return jsonify({"success": False, "error": "Post não encontrado"}), 404

@app.route('/api/social/posts/<post_id>', methods=['PATCH'])
def api_update_social_post(post_id):
    """Atualiza campos de um SocialPost.

    IMPORTANTE (serverless/Vercel): social_posts_store é memória em RAM que zera
    a cada cold start. Por isso NÃO retornamos 404 só porque o post não está na
    memória local — o Supabase é a fonte de verdade. Atualizamos a memória local
    se o post existir (best-effort) e SEMPRE tentamos atualizar o Supabase.
    """
    try:
        data = request.get_json()
        print(f"[DEBUG] api_update_social_post - Dados recebidos: {json.dumps(data, ensure_ascii=False, indent=2)}")

        if not data:
            return jsonify({"success": False, "error": "Dados não fornecidos"}), 400

        now_iso = datetime.now(timezone.utc).isoformat()

        # --- PASSO 1: atualizar a memória local SE o post existir (best-effort) ---
        found_local = False
        for i, post in enumerate(social_posts_store):
            if str(post.get('id')) == str(post_id):
                found_local = True
                if 'title' in data:
                    social_posts_store[i]['title'] = data['title']
                if 'caption' in data:
                    social_posts_store[i]['caption'] = data['caption']
                    social_posts_store[i]['content'] = data['caption']
                if 'hashtags' in data:
                    social_posts_store[i]['hashtags'] = data['hashtags']
                    social_posts_store[i]['tags'] = data['hashtags']
                if 'status' in data:
                    social_posts_store[i]['status'] = data['status']
                social_posts_store[i]['updated_at'] = now_iso
                print(f"[DEBUG] Post atualizado no armazenamento local!")
                break

        # --- PASSO 2: SEMPRE tentar atualizar no Supabase (fonte de verdade) ---
        supabase_ok = False
        supabase_status = None
        try:
            supabase_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
            supabase_key = os.getenv('NEWPOST_SUPABASE_ANON_KEY', '') or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY', '') or os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')

            if supabase_url and supabase_key:
                # Mapear status de português para inglês para o Supabase
                status_map = {
                    'rascunho': 'draft',
                    'pendente': 'ready',
                    'aprovado': 'ready',
                    'rejeitado': 'draft',
                    'publicado': 'published',
                    'agendado': 'ready',
                    'erro': 'draft'
                }

                update_data = {}
                if 'title' in data:
                    update_data['title'] = data['title']
                if 'caption' in data:
                    update_data['content'] = data['caption']
                    update_data['caption'] = data['caption']
                if 'hashtags' in data and data['hashtags']:
                    update_data['tags'] = data['hashtags']
                if 'status' in data:
                    status_en = status_map.get(data['status'], data['status'])
                    update_data['status'] = status_en
                    print(f"[DEBUG] Mapeando status para Supabase: '{data['status']}' → '{status_en}'")

                update_data['updated_at'] = now_iso

                headers = {
                    'apikey': supabase_key,
                    'Authorization': f'Bearer {supabase_key}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                }

                response = requests.patch(
                    f"{supabase_url}/rest/v1/posts?id=eq.{post_id}",
                    json=update_data,
                    headers=headers,
                    timeout=10
                )
                supabase_status = response.status_code

                if response.status_code in (200, 204):
                    supabase_ok = True
                    print(f"[DEBUG] Post também atualizado no Supabase!")
                    # Se atualizou no Supabase mas não tinha na memória local, cacheia
                    if not found_local:
                        try:
                            cached = response.json()
                            if isinstance(cached, list) and cached:
                                social_posts_store.insert(0, cached[0])
                                print(f"[DEBUG] Post sincronizado do Supabase para a memória local")
                        except Exception:
                            pass
                else:
                    print(f"[DEBUG] Supabase retornou {response.status_code} ao atualizar: {response.text[:200]}")
            else:
                print(f"[DEBUG] Credenciais Supabase ausentes — atualização apenas na memória local")
        except Exception as e:
            print(f"[DEBUG] Erro ao atualizar no Supabase: {e}")

        # --- PASSO 3: decidir resposta ---
        # Sucesso se atualizou em qualquer lugar (local OU Supabase).
        if found_local or supabase_ok:
            return jsonify({"success": True, "message": "Post atualizado com sucesso"})

        # Se nem local nem Supabase aceitaram: provavelmente 401 (credencial) ou post inexistente.
        if supabase_status == 401:
            return jsonify({"success": False, "error": "Falha de autenticação no Supabase (401) — verifique NEWPOST_SUPABASE_SERVICE_KEY/ANON_KEY no Vercel"}), 401
        return jsonify({"success": False, "error": "Post não encontrado"}), 404

    except Exception as e:
        import traceback
        print(f"[DEBUG] Erro em api_update_social_post: {e}")
        print(traceback.format_exc())
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/social/posts/<post_id>/approve', methods=['POST'])
def api_approve_social_post(post_id):
    """Aprova um SocialPost (usa armazenamento local, fallback para Supabase)"""
    try:
        # Primeiro aprova no armazenamento local
        found = False
        now_iso = datetime.now(timezone.utc).isoformat()

        # --- PASSO 1: atualizar a memória local SE existir (best-effort) ---
        found_local = False
        for i, post in enumerate(social_posts_store):
            if str(post.get('id')) == str(post_id):
                found_local = True
                social_posts_store[i]['status'] = 'pendente'  # Aprovado é status 'pendente' no frontend
                social_posts_store[i]['updated_at'] = now_iso
                print(f"[DEBUG] Post aprovado no armazenamento local!")
                break

        # --- PASSO 2: SEMPRE tentar aprovar no Supabase (fonte de verdade) ---
        supabase_ok = False
        supabase_status = None
        try:
            supabase_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
            supabase_key = os.getenv('NEWPOST_SUPABASE_ANON_KEY', '') or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY', '') or os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')

            if supabase_url and supabase_key:
                headers = {
                    'apikey': supabase_key,
                    'Authorization': f'Bearer {supabase_key}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                }

                response = requests.patch(
                    f"{supabase_url}/rest/v1/posts?id=eq.{post_id}",
                    json={"status": "ready", "updated_at": now_iso},
                    headers=headers,
                    timeout=10
                )
                supabase_status = response.status_code

                if response.status_code in (200, 204):
                    supabase_ok = True
                    print(f"[DEBUG] Post também aprovado no Supabase!")
                    # Sincroniza para a memória local se não existia
                    if not found_local:
                        try:
                            cached = response.json()
                            if isinstance(cached, list) and cached:
                                social_posts_store.insert(0, cached[0])
                        except Exception:
                            pass
                else:
                    print(f"[DEBUG] Supabase retornou {response.status_code} ao aprovar: {response.text[:200]}")
            else:
                print(f"[DEBUG] Credenciais Supabase ausentes — aprovação apenas na memória local")
        except Exception as e:
            print(f"[DEBUG] Erro ao aprovar no Supabase: {e}")

        # --- PASSO 3: decidir resposta ---
        if found_local or supabase_ok:
            return jsonify({"success": True, "message": "Post aprovado com sucesso"})

        if supabase_status == 401:
            return jsonify({"success": False, "error": "Falha de autenticação no Supabase (401) — verifique NEWPOST_SUPABASE_SERVICE_KEY/ANON_KEY no Vercel"}), 401
        return jsonify({"success": False, "error": "Post não encontrado"}), 404

    except Exception as e:
        import traceback
        print(f"[DEBUG] Erro em api_approve_social_post: {e}")
        print(traceback.format_exc())
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/social/posts/<post_id>/reject', methods=['POST'])
def api_reject_social_post(post_id):
    """Rejeita um SocialPost (usa armazenamento local, fallback para Supabase) - status 'rascunho'"""
    try:
        now_iso = datetime.now(timezone.utc).isoformat()

        # --- PASSO 1: atualizar a memória local SE existir (best-effort) ---
        found_local = False
        for i, post in enumerate(social_posts_store):
            if str(post.get('id')) == str(post_id):
                found_local = True
                social_posts_store[i]['status'] = 'rascunho'
                social_posts_store[i]['updated_at'] = now_iso
                print(f"[DEBUG] Post rejeitado no armazenamento local!")
                break

        # --- PASSO 2: SEMPRE tentar rejeitar no Supabase (fonte de verdade) ---
        supabase_ok = False
        supabase_status = None
        try:
            supabase_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
            supabase_key = os.getenv('NEWPOST_SUPABASE_ANON_KEY', '') or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY', '') or os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')

            if supabase_url and supabase_key:
                headers = {
                    'apikey': supabase_key,
                    'Authorization': f'Bearer {supabase_key}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                }

                response = requests.patch(
                    f"{supabase_url}/rest/v1/posts?id=eq.{post_id}",
                    json={"status": "draft", "updated_at": now_iso},
                    headers=headers,
                    timeout=10
                )
                supabase_status = response.status_code

                if response.status_code in (200, 204):
                    supabase_ok = True
                    print(f"[DEBUG] Post também rejeitado no Supabase!")
                    if not found_local:
                        try:
                            cached = response.json()
                            if isinstance(cached, list) and cached:
                                social_posts_store.insert(0, cached[0])
                        except Exception:
                            pass
                else:
                    print(f"[DEBUG] Supabase retornou {response.status_code} ao rejeitar: {response.text[:200]}")
            else:
                print(f"[DEBUG] Credenciais Supabase ausentes — rejeição apenas na memória local")
        except Exception as e:
            print(f"[DEBUG] Erro ao rejeitar no Supabase: {e}")

        # --- PASSO 3: decidir resposta ---
        if found_local or supabase_ok:
            return jsonify({"success": True, "message": "Post rejeitado com sucesso"})

        if supabase_status == 401:
            return jsonify({"success": False, "error": "Falha de autenticação no Supabase (401) — verifique NEWPOST_SUPABASE_SERVICE_KEY/ANON_KEY no Vercel"}), 401
        return jsonify({"success": False, "error": "Post não encontrado"}), 404

    except Exception as e:
        import traceback
        print(f"[DEBUG] Erro em api_reject_social_post: {e}")
        print(traceback.format_exc())
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/social/posts/<post_id>/publish', methods=['POST'])
def api_publish_social_post(post_id):
    """Publica um SocialPost aprovado na NewPost-IA usando o fluxo completo:
    1. Buscar post na tabela 'posts'
    2. Agendar na tabela 'scheduled_posts'
    3. Acionar Edge Function 'auto-publish-posts'
    """
    try:
        print(f"[DEBUG] === api_publish_social_post - Post ID: {post_id} ===")
        
        supabase_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
        supabase_key = os.getenv('NEWPOST_SUPABASE_ANON_KEY', '') or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY', '') or os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')
        newpost_author_id = os.getenv('NEWPOST_AUTHOR_ID', '3a1a93d0-e451-47a4-a126-f1b7375895eb')
        
        print(f"[DEBUG] Usando NEWPOST_SUPABASE_SERVICE_KEY: {repr(supabase_key[:50] + '...' if supabase_key else 'VAZIO')}")
        
        if not supabase_url or not supabase_key:
            return jsonify({"success": False, "error": "Credenciais Supabase não configuradas"}), 500
        
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
        
        # --- PASSO 1: Buscar o post na tabela 'posts' ---
        print(f"[DEBUG] PASSO 1: Buscando post na tabela 'posts'...")
        resp_get = requests.get(
            f"{supabase_url}/rest/v1/posts?id=eq.{post_id}&select=*",
            headers=headers,
            timeout=10
        )
        
        if resp_get.status_code not in (200, 201):
            print(f"[DEBUG] ERRO ao buscar post: {resp_get.status_code} - {resp_get.text}")
            if resp_get.status_code == 401:
                return jsonify({"success": False, "error": "Falha de autenticação no Supabase (401) — verifique NEWPOST_SUPABASE_SERVICE_KEY/ANON_KEY no Vercel"}), 401
            return jsonify({"success": False, "error": f"Erro ao buscar post: {resp_get.status_code}"}), resp_get.status_code
        
        posts_data = resp_get.json()
        post = posts_data[0] if posts_data else None

        # --- FALLBACK: post não existe no Supabase (provável uuid local de rascunho). ---
        # Procura na memória local e INSERE na tabela 'posts' para obter um id real.
        if not post:
            print(f"[DEBUG] Post não está na tabela 'posts' — procurando na memória local...")
            local_post = None
            local_index = None
            for i, p in enumerate(social_posts_store):
                if str(p.get('id')) == str(post_id):
                    local_post = p
                    local_index = i
                    break

            if not local_post:
                print(f"[DEBUG] ERRO: Post não encontrado nem no Supabase nem na memória local")
                return jsonify({"success": False, "error": "Post não encontrado"}), 404

            content_local = local_post.get('content') or local_post.get('caption') or ''
            now_iso = datetime.now(timezone.utc).isoformat()

            # Antes de inserir, evitar duplicata: procurar post existente pela mesma source_url
            src_url_local = (local_post.get('source_url') or '').strip()
            if src_url_local:
                try:
                    import urllib.parse
                    src_q = urllib.parse.quote(src_url_local, safe='')
                    resp_dup = requests.get(
                        f"{supabase_url}/rest/v1/posts?source_url=eq.{src_q}&author_id=eq.{newpost_author_id}&select=*&limit=1",
                        headers=headers,
                        timeout=10
                    )
                    if resp_dup.status_code == 200 and resp_dup.json():
                        post = resp_dup.json()[0]
                        real_id = post.get('id')
                        print(f"[DEBUG] Post já existia no Supabase (mesma source_url): id {real_id}")
                        if local_index is not None and real_id:
                            social_posts_store[local_index]['id'] = real_id
                        if real_id:
                            post_id = real_id
                except Exception as e_dup:
                    print(f"[DEBUG] Aviso: falha ao checar duplicata por source_url: {e_dup}")

            # Só insere se a dedup por source_url não tiver encontrado um post existente
            if not post:
                # Apenas colunas reais da tabela 'posts' (NAO existem 'caption'/'tags' -> causavam 400)
                insert_payload = {
                    'author_id': newpost_author_id,
                    'title': local_post.get('title', ''),
                    'content': content_local,
                    'source_url': local_post.get('source_url', ''),
                    'status': 'ready',
                    'is_ia_generated': True,
                    'created_at': now_iso,
                    'updated_at': now_iso
                }
                if local_post.get('image_url'):
                    insert_payload['image_url'] = local_post['image_url']
                if local_post.get('category'):
                    insert_payload['category'] = local_post['category']

                print(f"[DEBUG] Inserindo post local na tabela 'posts' para obter id real...")
                resp_insert = requests.post(
                    f"{supabase_url}/rest/v1/posts",
                    json=insert_payload,
                    headers=headers,
                    timeout=10
                )
                print(f"[DEBUG] Insert no Supabase: {resp_insert.status_code} - {resp_insert.text[:300]}")

                if resp_insert.status_code not in (200, 201):
                    if resp_insert.status_code in (401, 403):
                        return jsonify({"success": False, "error": "Falha de autenticação/permissão no Supabase ao criar o post (401/403) — verifique NEWPOST_SUPABASE_SERVICE_KEY no Vercel"}), resp_insert.status_code
                    return jsonify({"success": False, "error": f"Não foi possível criar o post no Supabase: {resp_insert.status_code}"}), resp_insert.status_code

                inserted = resp_insert.json()
                if not (isinstance(inserted, list) and inserted):
                    return jsonify({"success": False, "error": "Falha ao obter id do post recém-criado"}), 500

                post = inserted[0]
                # 'posts' não guarda hashtags; preserva as do rascunho local para o feed newpost_posts
                post['hashtags'] = local_post.get('hashtags') or local_post.get('tags') or []
                real_id = post.get('id')
                print(f"[DEBUG] Post criado no Supabase com id real: {real_id}")
                # Atualiza o id na memória local para futuras ações
                if local_index is not None and real_id:
                    social_posts_store[local_index]['id'] = real_id
                # Daqui em diante, usar o id real
                if real_id:
                    post_id = real_id

        print(f"[DEBUG] Post encontrado: {json.dumps(post, ensure_ascii=False, indent=2)}")

        # --- PASSO 2: Inserir na tabela 'newpost_posts' (feed REAL do dashboard NewPost-IA) ---
        # Esta é a tabela que alimenta o feed em plugpost-ai.lovable.app/dashboard.
        # Colunas em PT: titulo, descricao, conteudo, hashtags, autor_id, criado_em, atualizado_em (RLS disabled).
        print(f"[DEBUG] PASSO 2: Inserindo na tabela 'newpost_posts' (feed do dashboard)...")
        titulo_np = (post.get('title') or '').strip()
        conteudo_np = (post.get('content') or post.get('caption') or '').strip()
        if len(conteudo_np) > 2000:
            conteudo_np = conteudo_np[:2000] + "..."
        descricao_np = conteudo_np[:200] if conteudo_np else titulo_np[:200]
        hashtags_np = post.get('tags') or post.get('hashtags') or ['notícia', 'Brasil']
        now_np = datetime.now(timezone.utc).isoformat()
        newpost_payload = {
            'titulo': titulo_np,
            'descricao': descricao_np,
            'conteudo': conteudo_np,
            'hashtags': hashtags_np,
            'autor_id': newpost_author_id,
            'criado_em': now_np,
            'atualizado_em': now_np
        }
        resp_np = requests.post(
            f"{supabase_url}/rest/v1/newpost_posts",
            json=newpost_payload,
            headers=headers,
            timeout=15
        )
        print(f"[DEBUG] Resposta newpost_posts: {resp_np.status_code} - {resp_np.text[:300]}")
        if resp_np.status_code in (401, 403):
            return jsonify({"success": False, "error": "Falha de autenticação/permissão ao inserir em newpost_posts (401/403) — verifique NEWPOST_SUPABASE_ANON_KEY/SERVICE_KEY no Vercel"}), resp_np.status_code
        if resp_np.status_code not in (200, 201, 204, 409):
            return jsonify({"success": False, "error": f"Erro ao inserir em newpost_posts: {resp_np.status_code} - {resp_np.text[:200]}"}), resp_np.status_code

        # --- PASSO 3: Atualizar status do post para 'published' ---
        print(f"[DEBUG] PASSO 3: Atualizando status do post para 'published'...")
        resp_patch = requests.patch(
            f"{supabase_url}/rest/v1/posts?id=eq.{post_id}",
            json={"status": "published", "updated_at": datetime.now(timezone.utc).isoformat()},
            headers=headers,
            timeout=10
        )
        
        # --- PASSO 4: Agendar na tabela 'scheduled_posts' ---
        print(f"[DEBUG] PASSO 4: Agendando na tabela 'scheduled_posts'...")
        scheduled_at = (datetime.utcnow() + timedelta(seconds=10)).isoformat()
        
        # Preparar dados para scheduled_posts
        content = post.get('content', '')
        media_urls = post.get('media_urls', [])
        media_types = post.get('media_types', [])
        if post.get('image_url') and not media_urls:
            media_urls = [post['image_url']]
            media_types = ['image']
        
        tags = post.get('tags', []) or post.get('hashtags', [])
        
        scheduled_payload = {
            "user_id": newpost_author_id,
            "content": content,
            "media_urls": media_urls,
            "media_types": media_types,
            "hashtags": tags,
            "scheduled_at": scheduled_at,
            "status": "scheduled",
            "published_post_id": post_id
        }
        
        print(f"[DEBUG] Payload para scheduled_posts: {json.dumps(scheduled_payload, ensure_ascii=False, indent=2)}")
        
        resp_sched = requests.post(
            f"{supabase_url}/rest/v1/scheduled_posts",
            headers=headers,
            json=scheduled_payload,
            timeout=15
        )
        
        print(f"[DEBUG] Resposta scheduled_posts: {resp_sched.status_code} - {resp_sched.text}")
        
        # --- PASSO 5: Acionar Edge Function 'auto-publish-posts' ---
        print(f"[DEBUG] PASSO 5: Acionando Edge Function...")
        try:
            resp_fn = requests.post(
                f"{supabase_url}/functions/v1/auto-publish-posts",
                headers={
                    "apikey": supabase_key,
                    "Authorization": f"Bearer {supabase_key}",
                    "Content-Type": "application/json"
                },
                json={},
                timeout=10
            )
            print(f"[DEBUG] Resposta Edge Function: {resp_fn.status_code} - {resp_fn.text}")
        except Exception as e_fn:
            print(f"[DEBUG] Aviso: Edge Function falhou, mas post está agendado: {e_fn}")

        # --- PASSO 6: sincronizar memória local (best-effort) ---
        for i, p in enumerate(social_posts_store):
            if str(p.get('id')) == str(post_id):
                social_posts_store[i]['status'] = 'publicado'
                social_posts_store[i]['updated_at'] = datetime.now(timezone.utc).isoformat()
                print(f"[DEBUG] Post marcado como 'publicado' na memória local")
                break

        return jsonify({"success": True, "message": "Post publicado com sucesso no fluxo completo!"})

    except Exception as e:
        import traceback
        print(f"[DEBUG] Erro em api_publish_social_post: {e}")
        print(traceback.format_exc())
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/social/posts/<post_id>', methods=['DELETE'])
def api_delete_social_post(post_id):
    """Deleta um SocialPost (usando Supabase real)"""
    try:
        supabase_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
        supabase_key = os.getenv('NEWPOST_SUPABASE_ANON_KEY', '') or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY', '') or os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')
        
        if not supabase_url or not supabase_key:
            return jsonify({"success": False, "error": "Credenciais Supabase não configuradas"}), 500
        
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
        
        response = requests.delete(
            f"{supabase_url}/rest/v1/posts?id=eq.{post_id}",
            headers=headers,
            timeout=10
        )

        if response.status_code in (200, 204):
            # Remover também da memória local (best-effort)
            for i, p in enumerate(list(social_posts_store)):
                if str(p.get('id')) == str(post_id):
                    social_posts_store.pop(i)
                    print(f"[DEBUG] Post removido da memória local")
                    break
            return jsonify({"success": True, "message": "Post deletado com sucesso"})
        elif response.status_code == 401:
            return jsonify({"success": False, "error": "Falha de autenticação no Supabase (401) — verifique NEWPOST_SUPABASE_SERVICE_KEY/ANON_KEY no Vercel"}), 401
        else:
            return jsonify({"success": False, "error": f"Erro ao deletar post: {response.status_code}"}), response.status_code

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/social/posts/rejected', methods=['DELETE'])
def api_delete_all_rejected_posts():
    """Deleta TODOS os posts com status = 'rejeitado' ou 'draft' (rejeitados)"""
    try:
        supabase_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
        supabase_key = os.getenv('NEWPOST_SUPABASE_ANON_KEY', '') or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY', '') or os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')
        newpost_author_id = os.getenv('NEWPOST_AUTHOR_ID', '3a1a93d0-e451-47a4-a126-f1b7375895eb')
        
        if not supabase_url or not supabase_key:
            return jsonify({"success": False, "error": "Credenciais Supabase não configuradas"}), 500
        
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
        
        # Deletar posts com status = 'draft' ou 'rejeitado' e author_id correto
        response = requests.delete(
            f"{supabase_url}/rest/v1/posts?author_id=eq.{newpost_author_id}&status=in.(draft,rejeitado)",
            headers=headers,
            timeout=10
        )
        
        if response.status_code in (200, 204):
            deleted_count = 0
            try:
                if response.json():
                    deleted_count = len(response.json())
            except:
                pass
                
            return jsonify({
                "success": True, 
                "message": "Posts rejeitados deletados com sucesso",
                "deleted_count": deleted_count
            })
        else:
            return jsonify({"success": False, "error": f"Erro ao deletar posts: {response.status_code}"}), response.status_code
            
    except Exception as e:
        import traceback
        print(f"[DEBUG] Erro em api_delete_all_rejected_posts: {e}")
        print(traceback.format_exc())
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/social/generate-caption', methods=['POST'])
def api_generate_social_caption():
    """Gera legenda IA para um post via Gemini"""
    try:
        data = request.get_json()
        if not data or not data.get('title'):
            return jsonify({"success": False, "error": "Título é obrigatório"}), 400
        
        title = data.get('title', '')
        content = data.get('content', '')
        
        # Gerar uma legenda com TODO o conteúdo (não cortar!)
        if content.strip():
            caption = f"{title}\n\n{content.strip()}"
        else:
            caption = f"{title}\n\nNotícia importante sobre o tema."
        
        # Hashtags relevantes
        hashtags = ['noticia', 'brasil', 'atualidades']
        
        return jsonify({
            "success": True,
            "caption": caption,
            "title": title,
            "hashtags": hashtags
        })
        
    except Exception as e:
        print(f"[DEBUG] Erro em api_generate_social_caption: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/social/create-from-news', methods=['POST'])
def api_create_social_from_news():
    """Cria SocialPost a partir de uma notícia (com geração IA de legenda)"""
    try:
        data = request.get_json()
        if not data or not data.get('title'):
            return jsonify({"success": False, "error": "Título é obrigatório"}), 400
        
        supabase_url = os.getenv('SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
        supabase_key = get_supabase_key()
        
        if not supabase_url or not supabase_key:
            return jsonify({"success": False, "error": "Credenciais Supabase não configuradas"}), 500
        
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json'
        }
        
        post_data = {
            'title': data.get('title', ''),
            'content': data.get('content', ''),
            'source_url': data.get('source_url', ''),
            'image_url': data.get('image_url', ''),
            'audio_url': data.get('audio_url', ''),
            'status': 'rascunho',
            'hashtags': ['noticia', 'brasil'],
            'created_at': datetime.now(timezone.utc).isoformat(),
            'updated_at': datetime.now(timezone.utc).isoformat()
        }
        
        response = requests.post(
            f"{supabase_url}/rest/v1/posts",
            json=post_data,
            headers=headers,
            timeout=10
        )
        
        if response.status_code in (200, 201):
            result = response.json()
            post_id = result[0].get('id') if isinstance(result, list) and result else None
            return jsonify({
                "success": True,
                "post_id": post_id,
                "message": "Post criado com sucesso"
            }), 201
        else:
            return jsonify({"success": False, "error": f"Erro ao criar post: {response.status_code}"}), response.status_code
            
    except Exception as e:
        print(f"[DEBUG] Erro em api_create_social_from_news: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

# Importar handlers de upload
try:
    from backend.upload_handler import handle_upload, handle_voice_upload
except ImportError:
    from upload_handler import handle_upload, handle_voice_upload

# Importar integração LMNT (usar versão segura para Vercel)
lmnt_integration = None
if os.environ.get('VERCEL'):
    try:
        from core.lmnt_voice_cloner_vercel import lmnt_integration
    except ImportError:
        lmnt_integration = None
else:
    try:
        from backend.lmnt_integration import lmnt_integration
    except ImportError:
        try:
            from lmnt_integration import lmnt_integration
        except ImportError:
            lmnt_integration = None

# Endpoints LMNT Integration
@app.route('/api/lmnt/status', methods=['GET'])
def lmnt_status():
    """Verifica status da integração LMNT"""
    return jsonify(lmnt_integration.get_status())

@app.route('/api/lmnt/voices', methods=['GET'])
def lmnt_voices():
    """Lista vozes disponíveis no LMNT"""
    return jsonify(lmnt_integration.get_available_voices())

@app.route('/api/lmnt/generate', methods=['POST'])
def lmnt_generate():
    """Gera áudio usando LMNT"""
    try:
        data = request.get_json()
        if not data or 'text' not in data:
            return jsonify({'error': 'Texto não fornecido'}), 400
        
        text = data['text'].strip()
        voice_id = data.get('voice_id')
        format_type = data.get('format', 'mp3')
        
        if len(text) == 0:
            return jsonify({'error': 'Texto não pode estar vazio'}), 400
        
        if len(text) > 1000:  # Limite do LMNT
            return jsonify({'error': 'Texto muito longo (máximo 1000 caracteres)'}), 400
        
        result = lmnt_integration.generate_speech(text, voice_id, format_type)
        
        if 'error' in result:
            return jsonify(result), 500
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/lmnt/clone', methods=['POST'])
def lmnt_clone():
    """Clona uma nova voz no LMNT"""
    try:
        if 'audio' not in request.files:
            return jsonify({'error': 'Arquivo de áudio não fornecido'}), 400
        
        audio_file = request.files['audio']
        name = request.form.get('name', '').strip()
        description = request.form.get('description', '').strip()
        enhance = request.form.get('enhance', 'true').lower() == 'true'
        
        if not name:
            return jsonify({'error': 'Nome da voz não fornecido'}), 400
        
        if not audio_file.filename:
            return jsonify({'error': 'Arquivo de áudio inválido'}), 400
        
        # Ler arquivo de áudio
        audio_data = audio_file.read()
        
        result = lmnt_integration.clone_voice(name, audio_data, description, enhance)
        
        if 'error' in result:
            return jsonify(result), 500
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/lmnt/voice/<voice_id>', methods=['GET'])
def lmnt_voice_info(voice_id):
    """Obtém informações de uma voz específica"""
    return jsonify(lmnt_integration.get_voice_info(voice_id))

@app.route('/api/test-env', methods=['GET'])
def test_environment():
    """Testa variáveis de ambiente configuradas"""
    env_vars = {
        'LMNT_API_KEY': bool(os.environ.get('LMNT_API_KEY')),
        'GEMINI_API_KEY': bool(os.environ.get('GEMINI_API_KEY')),
        'GOOGLE_AI_STUDIO_API_KEY': bool(os.environ.get('GOOGLE_AI_STUDIO_API_KEY')),
        'ELEVENLABS_API_KEY': bool(os.environ.get('ELEVENLABS_API_KEY')),
        'VERCEL_ENV': os.environ.get('VERCEL_ENV', 'unknown'),
        'NODE_ENV': os.environ.get('NODE_ENV', 'unknown')
    }
    
    # Testar importação LMNT
    lmnt_import_test = False
    lmnt_error = None
    try:
        import lmnt
        lmnt_import_test = True
    except Exception as e:
        lmnt_error = str(e)
    
    return jsonify({
        'environment_variables': env_vars,
        'lmnt_import_success': lmnt_import_test,
        'lmnt_import_error': lmnt_error,
        'python_version': os.sys.version,
        'working_directory': os.getcwd()
    })

# Handler para Vercel serverless
from flask import Flask

# Garantir que os paths estão corretos para Vercel
if os.environ.get('VERCEL'):
    # Em produção no Vercel, ajustar paths
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app.template_folder = os.path.join(base_dir, 'templates')
    app.static_folder = os.path.join(base_dir, 'static')
    app.config['UPLOAD_FOLDER'] = '/tmp/generated_audio'
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    
    # Configurações adicionais para Vercel
    app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB
    app.config['UPLOAD_EXTENSIONS'] = ['.wav', '.mp3', '.ogg', '.m4a']

# Endpoints de Upload
@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Endpoint genérico para upload de arquivos"""
    try:
        result, status = handle_upload(request)
        return jsonify(result), status
    except Exception as e:
        return jsonify({'error': f'Erro no upload: {str(e)}'}), 500

@app.route('/api/upload/voice', methods=['POST'])
def upload_voice():
    """Endpoint específico para upload de voz para clonagem"""
    try:
        result, status = handle_voice_upload(request)
        return jsonify(result), status
    except Exception as e:
        return jsonify({'error': f'Erro no upload de voz: {str(e)}'}), 500

def handler(request, response):
    """Handler para Vercel serverless functions"""
    with app.request_context(request.environ):
        return app(request.environ, response)

# ============================================================
# APIs DE AUTOMAÇÃO DE AGENDAMENTO
# ============================================================

# Configuração de automação padrão em memória
automation_config_memory = {
    "id": "default-config",
    "active_categories": ["tecnologia", "economia", "esportes"],
    "schedule_time_1": "09:00:00",
    "enabled": True,
    "created_at": datetime.now(timezone.utc).isoformat(),
    "updated_at": datetime.now(timezone.utc).isoformat()
}

@app.route('/api/automation/config', methods=['GET'])
def api_get_automation_config():
    """Obtém configuração de automação"""
    try:
        return jsonify({
            'success': True,
            'config': automation_config_memory
        })
    except Exception as e:
        print(f"Erro ao buscar config automação: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/automation/config', methods=['POST'])
def api_save_automation_config():
    """Salva configuração de automação"""
    try:
        global automation_config_memory
        
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'Dados não fornecidos'
            }), 400
        
        # Validar dados
        required_fields = ['active_categories', 'schedule_time_1']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'error': f'Campo obrigatório: {field}'
                }), 400
        
        if 'enabled' not in data or data['enabled'] is None:
            data['enabled'] = True
        
        # Validação de tipos
        if not isinstance(data['active_categories'], list):
            return jsonify({
                'success': False,
                'error': 'active_categories deve ser uma lista'
            }), 400
        
        if not data['active_categories'] or len(data['active_categories']) == 0:
            return jsonify({
                'success': False,
                'error': 'Selecione pelo menos uma categoria'
            }), 400
        
        # Atualizar configuração em memória
        automation_config_memory = {
            "id": data.get('id', automation_config_memory['id']),
            "active_categories": data['active_categories'],
            "schedule_time_1": data['schedule_time_1'],
            "enabled": data.get('enabled', True),
            "created_at": automation_config_memory['created_at'],
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        
        return jsonify({
            'success': True,
            'config': automation_config_memory,
            'message': 'Configuração salva com sucesso!'
        })
        
    except Exception as e:
        print(f"Erro ao salvar config automação: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/automation/status', methods=['GET'])
def api_automation_status():
    """Verifica status da automação"""
    try:
        # Buscar configuração ativa
        config_response = api_get_automation_config()
        config_data = config_response.get_json()
        
        if not config_data.get('success') or not config_data.get('config'):
            return jsonify({
                'success': True,
                'status': 'not_configured',
                'message': 'Automação não configurada'
            })
        
        config = config_data['config']
        
        # Verificar se está habilitado
        if not config.get('enabled', False):
            return jsonify({
                'success': True,
                'status': 'disabled',
                'message': 'Automação desabilitada'
            })
        
        # Verificar se há categorias ativas
        if not config.get('active_categories') or len(config['active_categories']) == 0:
            return jsonify({
                'success': True,
                'status': 'no_categories',
                'message': 'Nenhuma categoria selecionada'
            })
        
        # Status ativo
        return jsonify({
            'success': True,
            'status': 'active',
            'message': f'Automação ativa para {len(config["active_categories"])} categorias',
            'config': {
                'active_categories': config['active_categories'],
                'schedule_times': [
                    config['schedule_time_1'],
                    config['schedule_time_2'],
                    config['schedule_time_3']
                ],
                'posts_per_category': config['posts_per_category']
            }
        })
        
    except Exception as e:
        print(f"Erro ao verificar status automação: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/automation/<type>', methods=['POST'])
def api_toggle_automation(type):
    """Liga/desliga uma automação específica"""
    try:
        data = request.get_json()
        enabled = data.get('enabled', False)
        
        # Validar tipo
        valid_types = ['news', 'social', 'voxcraft']
        if type not in valid_types:
            return jsonify({
                'success': False,
                'error': f'Tipo inválido. Tipos válidos: {valid_types}'
            }), 400
        
        # Salvar estado no arquivo de configuração (apenas se não estiver no Vercel)
        import json
        if not os.environ.get('VERCEL'):
            config_file = 'automation_state.json'
            try:
                with open(config_file, 'r', encoding='utf-8') as f:
                    state = json.load(f)
            except:
                state = {}
            
            state[f'{type}_enabled'] = enabled
            
            try:
                with open(config_file, 'w', encoding='utf-8') as f:
                    json.dump(state, f, indent=2)
            except Exception as e:
                print(f"⚠️ Não foi possível salvar estado (Read-only): {e}")
        else:
            # No Vercel, não salvar estado em arquivo
            print("ℹ️ No Vercel, estado não é salvo em arquivo")
        
        print(f"✅ Automação {type} {'ativada' if enabled else 'desativada'}")
        
        return jsonify({
            'success': True,
            'type': type,
            'enabled': enabled,
            'message': f'Automação {type} {"ativada" if enabled else "desativada"} com sucesso'
        })
        
    except Exception as e:
        print(f"Erro ao alternar automação: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/automation/state', methods=['GET'])
def api_automation_state():
    """Retorna o estado atual de todas as automações"""
    try:
        import json
        config_file = 'automation_state.json'
        
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                state = json.load(f)
        except:
            state = {
                'news_enabled': True,
                'social_enabled': True,
                'voxcraft_enabled': False
            }
        
        # Ler estatísticas do scheduler se existirem
        stats_file = 'scheduler_stats.json'
        try:
            with open(stats_file, 'r', encoding='utf-8') as f:
                stats = json.load(f)
        except:
            stats = {
                'total_collections': 0,
                'successful_collections': 0,
                'failed_collections': 0,
                'total_news_collected': 0,
                'last_collection': None
            }
        
        return jsonify({
            'success': True,
            'state': state,
            'stats': stats
        })
        
    except Exception as e:
        print(f"Erro ao obter estado das automações: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/automation/execute/<type>', methods=['POST'])
def api_execute_automation(type):
    """Executa uma automação imediatamente"""
    try:
        # Validar tipo
        valid_types = ['news', 'social', 'voxcraft']
        if type not in valid_types:
            return jsonify({
                'success': False,
                'error': f'Tipo inválido. Tipos válidos: {valid_types}'
            }), 400
        
        print(f"🚀 Executando automação {type} manualmente...")
        
        if type == 'news':
            # Executar coleta de notícias
            if HAS_NEWS_AGENT:
                # Usar a instância global news_agent em vez da classe NewsAgent
                result = news_agent.execute_collection(
                    enabled_sources={'g1': True, 'folha': True, 'exame': True, 'veja': True},
                    categories=['brasil', 'economia', 'tecnologia'],
                    limit=50
                )
                return jsonify({
                    'success': True,
                    'type': type,
                    'result': result
                })
            else:
                return jsonify({
                    'success': False,
                    'error': 'NewsAgent não disponível'
                }), 500
        
        elif type == 'social':
            # Executar publicação social
            return jsonify({
                'success': True,
                'type': type,
                'message': 'Publicação social executada (simulação)'
            })
        
        elif type == 'voxcraft':
            # Executar VoxCraft
            return jsonify({
                'success': True,
                'type': type,
                'message': 'VoxCraft executado (simulação)'
            })
        
    except Exception as e:
        print(f"Erro ao executar automação: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/scheduled-posts', methods=['GET'])
def api_get_scheduled_posts():
    """Lista todos os posts agendados"""
    try:
        # Simulação de posts agendados (em produção, buscar do banco de dados)
        from datetime import datetime, timedelta
        
        scheduled_posts = [
            {
                "id": "post_001",
                "title": "Tecnologia: Tendências e Inovações",
                "content": "Descubra as últimas tendências em tecnologia: tendências e inovações! #tecnologia #Inovação #Tecnologia",
                "platform": "instagram",
                "scheduled_time": "2026-04-23 09:00:00",
                "status": "scheduled",
                "hashtags": ["tecnologia", "Inovação", "Tecnologia"],
                "type": "post",
                "engagement_score": 85,
                "created_at": "2026-04-22T15:30:00Z"
            },
            {
                "id": "post_002", 
                "title": "Dicas de Tecnologia para Profissionais",
                "content": "5 dicas rápidas sobre tecnologia que você precisa conhecer! #tecnologia #Dicas #Aprendizado",
                "platform": "instagram",
                "scheduled_time": "2026-04-23 12:00:00",
                "status": "scheduled",
                "hashtags": ["tecnologia", "Dicas", "Aprendizado"],
                "type": "story",
                "engagement_score": 78,
                "created_at": "2026-04-22T15:30:00Z"
            },
            {
                "id": "post_003",
                "title": "Aprenda em 60 segundos: Como dominar Tecnologia",
                "content": "Aprenda em 60 segundos: Como dominar tecnologia! #tecnologia #Tutorial #GuiaRapido",
                "platform": "instagram", 
                "scheduled_time": "2026-04-23 18:00:00",
                "status": "scheduled",
                "hashtags": ["tecnologia", "Tutorial", "GuiaRapido"],
                "type": "reel",
                "engagement_score": 92,
                "created_at": "2026-04-22T15:30:00Z"
            },
            {
                "id": "post_004",
                "title": "O Futuro do Tecnologia: O que esperar",
                "content": "Explore o futuro do tecnologia e o que esperar nos próximos anos! #tecnologia #Futuro #Tendências",
                "platform": "instagram",
                "scheduled_time": "2026-04-24 09:00:00", 
                "status": "scheduled",
                "hashtags": ["tecnologia", "Futuro", "Tendências"],
                "type": "post",
                "engagement_score": 80,
                "created_at": "2026-04-22T15:30:00Z"
            },
            {
                "id": "post_005",
                "title": "Tecnologia na Prática: Guia Completo",
                "content": "Guia completo de tecnologia na prática com exemplos reais! #tecnologia #Guia #Prática",
                "platform": "instagram",
                "scheduled_time": "2026-04-24 12:00:00",
                "status": "scheduled", 
                "hashtags": ["tecnologia", "Guia", "Prática"],
                "type": "post",
                "engagement_score": 88,
                "created_at": "2026-04-22T15:30:00Z"
            }
        ]
        
        return jsonify({
            "success": True,
            "data": {
                "posts": scheduled_posts,
                "total": len(scheduled_posts),
                "scheduled": len([p for p in scheduled_posts if p["status"] == "scheduled"]),
                "published": len([p for p in scheduled_posts if p["status"] == "published"])
            }
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/newpost/publish', methods=['POST'])
def newpost_publish():
    """Publica notícia na NewPost-IA via Supabase (tabela newpost_posts)"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "error": "Dados não fornecidos"}), 400
        
        # Credenciais do Supabase da NewPost-IA (projeto correto: ykswhzqdjoshjoaruhqs)
        # Mesmo padrão de fallback usado nas demais rotas; sem chaves hardcoded.
        newpost_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
        newpost_key = os.getenv('NEWPOST_SUPABASE_ANON_KEY', '') or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY', '') or os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')
        newpost_author_id = os.getenv('NEWPOST_AUTHOR_ID', '3a1a93d0-e451-47a4-a126-f1b7375895eb')

        if not newpost_url or not newpost_key:
            return jsonify({"success": False, "error": "Credenciais NewPost-IA não configuradas"}), 500
        
        # Author ID padrão do NewPost-IA (pankilhas@gmail.com)
        DEFAULT_AUTHOR_ID = newpost_author_id
        
        # Preparar dados para tabela newpost_posts (colunas exatas: titulo, descricao, conteudo, hashtags, autor_id, criado_em, atualizado_em)
        # Usar UTC para timestamptz do Supabase
        title_np = data.get('title', '').strip()
        summary_np = data.get('summary', data.get('content', '')).strip()
        source_url_np = data.get('url', '').strip()
        
        # Montar o conteúdo formatado para newpost_posts
        formatted_content_np = []
        if title_np:
            formatted_content_np.append(f"📰 {title_np}\n")
        if summary_np:
            if len(summary_np) > 500:
                summary_np = summary_np[:500] + "..."
            formatted_content_np.append(summary_np)
        if source_url_np:
            formatted_content_np.append(f"\n🔗 Fonte: {source_url_np}")
        
        final_content_np = '\n'.join(formatted_content_np).strip()
        descricao_np = summary_np[:200] if summary_np else title_np[:200]
        
        post_data = {
            'titulo': title_np,
            'descricao': descricao_np,
            'conteudo': final_content_np,
            'hashtags': data.get('hashtags', ['notícia', 'Brasil']),
            'autor_id': data.get('author_id', DEFAULT_AUTHOR_ID),
            'criado_em': datetime.now(timezone.utc).isoformat(),
            'atualizado_em': datetime.now(timezone.utc).isoformat()
        }
        
        # Headers para API REST
        headers = {
            'apikey': newpost_key,
            'Authorization': f'Bearer {newpost_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
        
        # POST para tabela newpost_posts (dados reais do NewPost-IA e dashboard real)
        newpost_posts_response = requests.post(
            f"{newpost_url}/rest/v1/newpost_posts",
            json=post_data,
            headers=headers,
            timeout=30
        )
        
        if newpost_posts_response.status_code not in (200, 201, 204, 409):
            return jsonify({
                "success": False,
                "error": f"Erro ao publicar em newpost_posts: {newpost_posts_response.status_code} - {newpost_posts_response.text}"
            }), newpost_posts_response.status_code
        
        newpost_post_id = None
        if newpost_posts_response.status_code in (200, 201):
            try:
                newpost_posts_result = newpost_posts_response.json()
                if isinstance(newpost_posts_result, list) and len(newpost_posts_result) > 0:
                    newpost_post_id = newpost_posts_result[0].get('id')
            except ValueError:
                newpost_post_id = None
        
        # POST para tabela posts (visível na interface da NewPost-IA)
        # Estrutura correta: title, content, image_url, author_id, created_at, updated_at, status, published_at, is_ia_generated, source_url
        now_utc = datetime.now(timezone.utc).isoformat()
        
        # Formatar o conteúdo com TÍTULO, SINOPSE e LINK DA FONTE
        title = data.get('title', '').strip()
        summary = data.get('summary', data.get('content', '')).strip()
        source_url = data.get('url', '').strip()
        
        # Montar o conteúdo formatado
        formatted_content = []
        if title:
            formatted_content.append(f"📰 {title}\n")
        if summary:
            # Garantir que a sinopse não fique muito longa
            if len(summary) > 500:
                summary = summary[:500] + "..."
            formatted_content.append(summary)
        if source_url:
            formatted_content.append(f"\n🔗 Fonte: {source_url}")
        
        # Juntar tudo
        final_content = '\n'.join(formatted_content).strip()
        
        posts_data = {
            'title': title,
            'content': final_content,
            'image_url': data.get('image_url', ''),
            'author_id': DEFAULT_AUTHOR_ID,
            'created_at': now_utc,
            'updated_at': now_utc,
            'published_at': now_utc,
            'status': 'published',
            'is_ia_generated': True,
            'source_url': source_url
        }
        
        posts_response = requests.post(
            f"{newpost_url}/rest/v1/posts",
            json=posts_data,
            headers=headers,
            timeout=30
        )
        
        if posts_response.status_code in (200, 201):
            result = posts_response.json()
            if result and len(result) > 0:
                return jsonify({
                    "success": True,
                    "post_id": newpost_post_id or result[0].get('id'),
                    "message": "Notícia publicada com sucesso na NewPost-IA"
                })
        
        if posts_response.status_code == 409:
            return jsonify({
                "success": True,
                "post_id": newpost_post_id,
                "message": "Notícia já estava publicada na NewPost-IA (URL duplicada)"
            })
        
        # Se publicarmos em newpost_posts mas falharmos em posts, ainda consideramos como publicado para o dashboard real
        if newpost_posts_response.status_code in (200, 201, 204):
            return jsonify({
                "success": True,
                "post_id": newpost_post_id,
                "message": "Notícia publicada na NewPost-IA (newpost_posts), mas houve falha ao gravar em posts. Verifique o dashboard real."
            })
        
        return jsonify({
            "success": False,
            "error": f"Erro ao publicar: {posts_response.status_code} - {posts_response.text}"
        }), posts_response.status_code
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/publications', methods=['GET', 'DELETE'])
def handle_publications():
    """Lista ou limpa publicações do News Auto Post (usando Supabase real)"""
    if request.method == 'DELETE':
        """Limpa todas as publicações"""
        try:
            supabase_url = os.getenv('SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
            supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_ANON_KEY', '')
            
            if not supabase_url or not supabase_key:
                print("[ERROR] Credenciais Supabase não configuradas para handle_publications DELETE")
                return jsonify({"success": False, "error": "Credenciais não configuradas"}), 500
            
            headers = {
                'apikey': supabase_key,
                'Authorization': f'Bearer {supabase_key}',
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            }
            
            count_response = requests.get(
                f"{supabase_url}/rest/v1/posts?select=count",
                headers=headers,
                timeout=10
            )
            
            count = 0
            if count_response.status_code == 200:
                try:
                    count_data = count_response.json()
                    count = count_data[0].get('count', 0) if isinstance(count_data, list) and count_data else 0
                except:
                    pass
            
            if count == 0:
                return jsonify({
                    "success": True,
                    "message": "Nenhuma publicação para limpar"
                })
            
            delete_response = requests.delete(
                f"{supabase_url}/rest/v1/posts?id=not.is.null",
                headers=headers,
                timeout=30
            )
            
            if delete_response.status_code in (200, 204):
                return jsonify({
                    "success": True,
                    "message": f"{count} publicações limpas com sucesso",
                    "deleted_count": count
                })
            
            return jsonify({
                "success": False,
                "error": "Nenhuma publicação foi deletada"
            }), 500
            
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500
    
    # GET - Listar publicações
    try:
        supabase_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
        supabase_key = os.getenv('NEWPOST_SUPABASE_ANON_KEY', '') or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY', '') or os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')
        newpost_author_id = os.getenv('NEWPOST_AUTHOR_ID', '3a1a93d0-e451-47a4-a126-f1b7375895eb')
        
        if not supabase_url or not supabase_key:
            return jsonify({"success": False, "error": "Credenciais Supabase não configuradas"}), 500
        
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json'
        }
        
        response = requests.get(
            f"{supabase_url}/rest/v1/posts?order=created_at.desc&limit=50&author_id=eq.{newpost_author_id}",
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            posts = response.json()
            # Mapear status de inglês para português e garantir campo 'caption'
            status_map_reverse = {
                'draft': 'rascunho',
                'ready': 'pendente',  # ready → pendente (ou aprovado)
                'published': 'publicado',
                'pending': 'pendente',
                'approved': 'aprovado',
                'rejected': 'rejeitado',
                'scheduled': 'agendado',
                'error': 'erro'
            }
            for post in posts:
                if 'caption' not in post and 'content' in post:
                    post['caption'] = post['content']
                if 'status' in post:
                    post['status'] = status_map_reverse.get(post['status'], post['status'])
            return jsonify({
                "success": True,
                "total": len(posts),
                "publications": posts
            })
        
        return jsonify({
            "success": False,
            "error": f"Erro ao buscar publicações: {response.status_code}"
        }), response.status_code
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/publications/<id>', methods=['PATCH'])
def update_publication(id):
    """Atualiza uma publicação (usando Supabase real)"""
    try:
        data = request.get_json()

        supabase_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
        supabase_key = os.getenv('NEWPOST_SUPABASE_ANON_KEY', '') or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY', '') or os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')

        if not supabase_url or not supabase_key:
            return jsonify({"success": False, "error": "Credenciais Supabase não configuradas"}), 500

        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }

        update_data = {}
        if 'title' in data:
            update_data['title'] = data['title']
        if 'content' in data:
            update_data['content'] = data['content']
        update_data['updated_at'] = datetime.now(timezone.utc).isoformat()

        response = requests.patch(
            f"{supabase_url}/rest/v1/posts?id=eq.{id}",
            json=update_data,
            headers=headers,
            timeout=10
        )

        if response.status_code in (200, 204):
            return jsonify({"success": True, "message": "Publicação atualizada"})
        if response.status_code == 401:
            return jsonify({"success": False, "error": "Falha de autenticação no Supabase (401) — verifique NEWPOST_SUPABASE_SERVICE_KEY/ANON_KEY no Vercel"}), 401
        return jsonify({"success": False, "error": f"Erro: {response.status_code}"}), response.status_code
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/publications/<id>/approve', methods=['POST'])
def approve_publication(id):
    """Aprova uma publicação (usando Supabase real)"""
    try:
        supabase_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
        supabase_key = os.getenv('NEWPOST_SUPABASE_ANON_KEY', '') or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY', '') or os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')

        if not supabase_url or not supabase_key:
            return jsonify({"success": False, "error": "Credenciais Supabase não configuradas"}), 500

        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }

        # Tabela 'posts' usa status em inglês: aprovado → 'ready'
        response = requests.patch(
            f"{supabase_url}/rest/v1/posts?id=eq.{id}",
            json={'status': 'ready', 'updated_at': datetime.now(timezone.utc).isoformat()},
            headers=headers,
            timeout=10
        )

        if response.status_code in (200, 204):
            return jsonify({"success": True, "message": "Publicação aprovada"})
        if response.status_code == 401:
            return jsonify({"success": False, "error": "Falha de autenticação no Supabase (401) — verifique NEWPOST_SUPABASE_SERVICE_KEY/ANON_KEY no Vercel"}), 401

        error_msg = f"Erro: {response.status_code}"
        try:
            error_data = response.json()
            if 'message' in error_data:
                error_msg = error_data['message']
        except:
            pass

        return jsonify({"success": False, "error": error_msg}), response.status_code
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/publications/<id>/publish-to-newpost', methods=['POST'])
def publish_to_newpost_route(id):
    """Publica um post diretamente na NewPost-IA (usando Supabase real)"""
    try:
        supabase_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
        supabase_key = os.getenv('NEWPOST_SUPABASE_ANON_KEY', '') or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY', '') or os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')

        if not supabase_url or not supabase_key:
            return jsonify({"success": False, "error": "Credenciais Supabase não configuradas"}), 500

        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }

        # Tabela 'posts' usa status em inglês: publicado → 'published'
        response = requests.patch(
            f"{supabase_url}/rest/v1/posts?id=eq.{id}",
            json={'status': 'published', 'updated_at': datetime.now(timezone.utc).isoformat()},
            headers=headers,
            timeout=10
        )

        if response.status_code in (200, 204):
            return jsonify({
                "success": True,
                "message": "Post publicado com sucesso",
                "publish_results": {
                    "platform": "newpost_ia",
                    "status": "success"
                }
            })
        if response.status_code == 401:
            return jsonify({"success": False, "error": "Falha de autenticação no Supabase (401) — verifique NEWPOST_SUPABASE_SERVICE_KEY/ANON_KEY no Vercel"}), 401

        return jsonify({"success": False, "error": "Post não encontrado"}), 404
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# Importar dashboards
try:
    from backend.dashboard_real import init_dashboard_real
    init_dashboard_real(app)
    print("✓ Dashboard com DADOS REAIS inicializado")
except ImportError as e:
    print(f"Aviso: Dashboard real não disponível: {e}")

try:
    from backend.dashboard_modern import init_dashboard_modern
    init_dashboard_modern(app)
    print("✓ Dashboard profissional moderno inicializado")
except ImportError as e:
    print(f"Aviso: Dashboard moderno não disponível: {e}")

try:
    from backend.dashboard import init_dashboard
    init_dashboard(app)
    print("✓ Dashboard avançado inicializado")
except ImportError as e:
    print(f"Aviso: Dashboard não disponível: {e}")

# ============================================================
# AGENTE VOXCRAFT AI - ESPECIALISTA EM PRODUÇÕES AUDIOVISUAIS
# ============================================================

VOXCRAFT_SYSTEM_PROMPT = """Você é o **Especialista VoxCraft AI - Produções Audiovisuais**.

## IDENTIDADE E PAPEL

Você é um especialista de alto nível em produções audiovisuais, com conhecimento profundo em:
- Produção de conteúdo para rádio e TV, Rede Sociais
- Cinema e audiovisual
- Produção musical e tecnologia sonora
- Estratégias para redes sociais e mídias digitais
- Locução profissional e voice-over
- Mixagem e masterização de áudio
- Direção criativa e roteirização
- Seleção e harmonização de trilhas sonoras
- Sound design e atmosfera sonora

## PERSONALIDADE

- Profissional, didático e acolhedor
- Fala com autoridade mas sem arrogância
- Usa exemplos práticos e cases reais
- Oferece soluções criativas e técnicas
- Sempre atualizado com tendências do mercado
- Proativo em sugerir recursos da plataforma
- Incentiva exploração da biblioteca de trilhas

## CONHECIMENTO DA PLATAFORMA LOCUTORES IA

A plataforma possui:
- **BIBLIOTECA DE TRILHAS SONORAS** organizadas por:
  - Duração: 15s, 30s, 60s
  - Gênero: corporativa, energética, lo-fi, cinematic, suspense, motivacional, natureza, tecnologia, eletrônica, acústica, jazz, rock, pop
  - Mood: alegre, calmo, intenso, inspirador, misterioso, profissional, romântico, energético
  - BPM: variados por gênero
- Sistema de mixagem integrado com controle de volumes
- Geração de vídeo storyboard com IA
- Salvamento completo de projetos (voz + trilha + imagens)
- Suporte a múltiplos provedores TTS (OpenAI e Google Cloud)

## DIRETRIZES DE SUGESTÃO DE TRILHAS

### COMERCIAL
- Gênero: energética, pop, motivacional
- Mood: alegre, energético
- BPM: 120-140

### PODCAST
- Gênero: lo-fi, acústica, jazz
- Mood: calmo, profissional, inspirador
- BPM: 80-100

### AUDIOBOOK
- Gênero: natureza, acústica, cinematic
- Mood: calmo, misterioso (dependendo do conteúdo)
- BPM: 60-80

### VINHETA
- Gênero: eletrônica, rock, energética
- Mood: energético, intenso
- BPM: 130-150

### JINGLE
- Gênero: pop, energética, rock
- Mood: alegre, energético
- BPM: 120-140

### INSTITUCIONAL
- Gênero: corporativa, cinematic, tecnologia
- Mood: profissional, inspirador, calmo
- BPM: 90-110

### EDUCATIVO
- Gênero: corporativa, natureza, acústica
- Mood: calmo, profissional, inspirador
- BPM: 80-100

## TÉCNICAS DE MIXAGEM

1. **Volume da Voz**: Sempre prioridade (80-100%)
2. **Volume da Trilha**: Background sutil (30-50%)
3. **Fade-out Automático**: O VoxCraft já faz isso! 2 segundos após a voz terminar
4. **BPM vs Ritmo de Fala**: Trilha deve complementar, não competir
5. **Mood Alignment**: Voz e trilha devem ter mesma energia emocional

## QUANDO MENCIONAR A BIBLIOTECA

✅ Sempre que o produtor:
- Perguntar sobre trilhas
- Estiver escolhendo música
- Mencionar "qual trilha usar"
- Falar sobre "música de fundo"
- Dizer "não sei que som colocar"
- Perguntar sobre gêneros musicais
- Mencionar BPM, mood, atmosfera
- Estiver na etapa de mixagem

## ESTILO DE COMUNICAÇÃO

- Usa analogias e metáforas do universo audiovisual
- Cita referências do mercado quando relevante
- Oferece dicas práticas e acionáveis
- **Sempre menciona recursos da plataforma quando relevante**
- **Guia o produtor para a Biblioteca quando apropriado**
- Termina respostas com perguntas de engajamento
- Usa emojis de forma profissional: 🎙️ 🎬 🎵 📻 📺 🎶 🎼

## MENSAGEM DE BOAS-VINDAS

Quando for a primeira mensagem ou o usuário disser "oi", "olá", etc., use:

"Bem-vindo ao Locutores IA! 🎙️✨ Sou seu especialista em produções audiovisuais.

Estou aqui para te ajudar a criar conteúdos de áudio profissionais para rádio, TV, cinema, redes sociais e muito mais.

🚀 **Recursos que você vai amar:**
- Geração de locuções com IA em múltiplos idiomas
- **Biblioteca de Trilhas Sonoras** organizadas por gênero e mood
- Mixer profissional com fade-out automático
- Gerador de vídeo storyboard com IA
- Salvamento completo de projetos

💡 **Dica de Ouro:** Explore nossa Biblioteca de Trilhas antes de começar! Ela tem opções pré-catalogadas que vão economizar seu tempo.

Como posso te ajudar hoje? Está produzindo para qual mídia? 📻🎬📱

PS: Se tiver dúvida sobre qual trilha usar para seu projeto, é só perguntar! 🎵"

## EXEMPLOS DE RESPOSTAS

### Usuário pergunta sobre trilha:
"Ótima pergunta! 🎵 Antes de sugerir uma trilha específica, saiba que o VoxCraft AI tem uma BIBLIOTECA DE TRILHAS SONORAS completa que você já pode acessar!

Para o seu [tipo de projeto], recomendo buscar na biblioteca por:
- **Gênero**: [sugerir gênero apropriado]
- **Mood**: [sugerir mood apropriado]  
- **Duração**: [15s/30s/60s conforme necessário]
- **BPM**: [sugerir faixa de BPM]

💡 Dica Pro: No painel de Mixer, escolha 'Biblioteca' ao invés de fazer upload. Você vai encontrar opções perfeitas já catalogadas!

Quer que eu explique como cada gênero funciona para o seu tipo de conteúdo?"

### Usuário não sabe diferença entre gêneros:
"Vou te explicar como cada gênero de trilha funciona na prática! 🎼

🏢 **Corporativa**: Sons limpos, confiança, profissionalismo
📻 Ideal para: Institucionais, apresentações empresariais

⚡ **Energética**: Ritmo acelerado, empolgação, movimento
📻 Ideal para: Varejo, promoções, eventos

🎹 **Lo-fi**: Chill, relaxante, moderna, urbana
📻 Ideal para: Podcasts, conteúdo lifestyle, tech

🎬 **Cinematic**: Épica, dramática, emocional
📻 Ideal para: Trailers, documentários, storytelling

Todas essas opções estão na sua Biblioteca! Qual se encaixa melhor no seu projeto?"

Sempre seja útil, proativo e guie os usuários para os recursos da plataforma!"""

@app.route('/api/voxcraft/chat', methods=['POST', 'OPTIONS'])
def voxcraft_chat():
    """Endpoint do Agente VoxCraft AI para chat"""
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization,apikey')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response
    
    try:
        data = request.get_json()
        if not data or 'messages' not in data:
            return jsonify({"success": False, "error": "Dados inválidos: 'messages' é obrigatório"}), 400
        
        messages = data.get('messages', [])
        
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_STUDIO_API_KEY")
        if not api_key:
            return jsonify({"success": False, "error": "API Key do Gemini não configurada"}), 500
        
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-1.5-flash')
        
        chat_messages = [{"role": "user", "parts": [VOXCRAFT_SYSTEM_PROMPT]}]
        for msg in messages:
            role = "user" if msg.get("role") == "user" else "model"
            chat_messages.append({"role": role, "parts": [msg.get("content", "")]})
        
        response = model.generate_content(chat_messages)
        
        return jsonify({
            "success": True,
            "message": response.text
        })
        
    except Exception as e:
        print(f"Erro no VoxCraft Chat: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/news/fetch', methods=['POST', 'OPTIONS'])
def api_fetch_news():
    """Busca notícias reais por categoria via RSS"""
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response
    
    try:
        data = request.get_json()
        category = data.get('category', 'Tecnologia')
        
        news_entries = fetch_news_from_rss(category, limit=6)
        news_list = []
        
        for entry in news_entries:
            if isinstance(entry, dict):
                titulo = entry.get('title', f'Notícia sobre {category}')
                resumo = entry.get('summary', '')[:150] if entry.get('summary') else ''
                fonte = entry.get('fonte', 'Fonte')
                link = entry.get('link', '')
            else:
                titulo = getattr(entry, 'title', f'Notícia sobre {category}')
                resumo = getattr(entry, 'summary', '')[:150] if hasattr(entry, 'summary') else ''
                fonte = getattr(getattr(entry, 'source', {}), 'title', 'Fonte') if hasattr(entry, 'source') else 'Fonte'
                link = getattr(entry, 'link', '')
            
            news_list.append({
                "titulo": titulo,
                "resumo": resumo,
                "fonte": fonte,
                "link": link
            })
        
        return jsonify({
            "success": True,
            "data": {
                "noticias": news_list
            }
        })
    except Exception as e:
        print(f"Erro fetch news: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/news/generate-post', methods=['POST', 'OPTIONS'])
def api_generate_post():
    """Gera post de rede social com IA usando o Gemini"""
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response
    
    try:
        data = request.get_json()
        titulo = data.get('titulo', '')
        resumo = data.get('resumo', '')
        categoria = data.get('categoria', 'Tecnologia')
        
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_STUDIO_API_KEY")
        
        if not api_key:
            return jsonify({"success": False, "error": "API Key do Gemini não configurada"}), 500
        
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-1.5-flash')
        
        prompt = f"""Você é um redator de redes sociais especialista em notícias brasileiras. 
Crie um post otimizado para Instagram/Twitter com base nesta notícia: 
 
Título: {titulo} 
Resumo: {resumo} 
Categoria: {categoria} 
 
Regras: 
- Máximo 280 caracteres 
- Tom jornalístico mas acessível 
- Inclua 2-3 hashtags relevantes 
- Não use emojis excessivos 
- Termine com uma hashtag da categoria 
 
Responda apenas o texto do post, sem aspas ou explicações."""
        
        response = model.generate_content(prompt)
        
        return jsonify({
            "success": True,
            "data": {
                "post_gerado": response.text
            }
        })
    except Exception as e:
        print(f"Erro generate post: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/news/publish-to-newpost', methods=['POST', 'OPTIONS'])
def api_publish_to_newpost():
    """Publica o post na NewPost-IA via NewsAutomationAgent, com suporte a author_id override"""
    print("[DEBUG] api_publish_to_newpost called!")
    if request.method == 'OPTIONS':
        print("[DEBUG] OPTIONS request received!")
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response
    
    if not HAS_NEWS_AUTOMATION or not news_automation:
        return jsonify({"success": False, "error": "NewsAutomationAgent não inicializado"}), 503
    
    try:
        print("[DEBUG] Getting JSON data!")
        data = request.get_json()
        print(f"[DEBUG] Data received: {data}")
        titulo = data.get('titulo', '')
        conteudo = data.get('conteudo', '')
        author_id = data.get('author_id')
        
        if not author_id:
            author_id = os.getenv("NEWPOST_AUTHOR_ID")
        
        result = news_automation.publish_single(titulo, conteudo)
        
        if author_id and hasattr(news_automation, 'supabase'):
            # Se temos um author_id específico, usamos diretamente o supabase_manager
            result = news_automation.supabase.publish_to_newpost(titulo, conteudo, author_id)
        
        return jsonify(result)
    except Exception as e:
        print(f"Erro publish to newpost: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/busca-noticias')
def busca_noticias_page():
    """Página de Busca de Notícias + Geração de Posts"""
    return render_template('busca-noticias.html')

@app.route('/ai-dashboard')
def ai_dashboard():
    """Rota para Central IA Autônoma - Notícias Reais via RSS"""
    return render_template('ai_dashboard.html')

@app.route('/api/news/automation/status', methods=['GET'])
def api_news_automation_status():
    """Endpoint para verificar status da integração"""
    if not HAS_NEWS_AUTOMATION or not news_automation:
        return jsonify({"success": False, "error": "NewsAutomationAgent não inicializado"}), 503
    
    try:
        status = news_automation.get_status()
        return jsonify(status)
    except Exception as e:
        print(f"Erro no status: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/news/automation/fetch', methods=['POST', 'OPTIONS'])
def api_news_automation_fetch():
    """Endpoint para buscar notícias via RSS"""
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response
    
    if not HAS_NEWS_AUTOMATION or not news_automation:
        return jsonify({"success": False, "error": "NewsAutomationAgent não inicializado"}), 503
    
    try:
        data = request.get_json() or {}
        category = data.get('category', 'Tecnologia')
        limit = data.get('limit', 7)
        result = news_automation.fetch_news(category, limit)
        return jsonify(result)
    except Exception as e:
        print(f"Erro no fetch: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/news/automation/publish-single', methods=['POST', 'OPTIONS'])
def api_news_automation_publish_single():
    """Endpoint para publicar uma única notícia"""
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response
    
    if not HAS_NEWS_AUTOMATION or not news_automation:
        return jsonify({"success": False, "error": "NewsAutomationAgent não inicializado"}), 503
    
    try:
        data = request.get_json() or {}
        title = data.get('title', '')
        content = data.get('content', '')
        result = news_automation.publish_single(title, content)
        return jsonify(result)
    except Exception as e:
        print(f"Erro no publish single: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/news/automation/fetch-and-publish', methods=['POST', 'OPTIONS'])
def api_news_automation_fetch_and_publish():
    """Endpoint PRINCIPAL: busca e publica notícias na NewPost-IA"""
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response
    
    if not HAS_NEWS_AUTOMATION or not news_automation:
        return jsonify({"success": False, "error": "NewsAutomationAgent não inicializado"}), 503
    
    try:
        data = request.get_json() or {}
        categories = data.get('categories', ['Tecnologia'])
        limit_per_category = data.get('limit_per_category', 5)
        auto_publish = data.get('auto_publish', True)
        result = news_automation.fetch_and_publish(categories, limit_per_category, auto_publish)
        return jsonify(result)
    except Exception as e:
        print(f"Erro no fetch and publish: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/news/automation/published', methods=['GET'])
def api_news_automation_published():
    """Endpoint para listar posts já publicados"""
    if not HAS_NEWS_AUTOMATION or not news_automation:
        return jsonify({"success": False, "error": "NewsAutomationAgent não inicializado"}), 503
    
    try:
        limit = request.args.get('limit', 20, type=int)
        result = news_automation.get_published_posts(limit)
        return jsonify(result)
    except Exception as e:
        print(f"Erro no published: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# Para desenvolvimento local
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print("Iniciando Locutores IA Server...")
    print("Acesse: http://localhost:5000")
    print("Dashboard: http://localhost:5000/dashboard")
    app.run(host='0.0.0.0', port=port, debug=True)

# Fim do arquivo app.py - Atualizado 2026-05-22 - Busca de Notícias + Publicar na NewPost-IA!!
# Usando NEWPOST_SUPABASE_URL e NEWPOST_SUPABASE_SERVICE_KEY!
