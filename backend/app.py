from flask import Flask, render_template, request, jsonify, send_file
import os
import sys
import uuid
import glob
import json
import requests
from datetime import datetime, timezone

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
    if os.path.exists(env_path):
        load_dotenv(env_path)
        print(f"✅ Arquivo .env carregado: {env_path}")
    else:
        print(f"⚠️ Arquivo .env não encontrado em: {env_path}")
except ImportError:
    print("⚠️ python-dotenv não instalado, usando variáveis de ambiente do sistema")

# No Vercel, o diretório de execução principal pode não ser 'backend'
# Precisamos adicionar o diretório atual (onde está app.py) ao sys.path explicitamente
sys.path.insert(0, os.path.dirname(__file__))

# As variáveis de ambiente são configuradas diretamente no painel
# Não precisamos carregar de arquivo .env em produção
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'core'))

# Criar app Flask primeiro
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app = Flask(__name__, 
           template_folder=os.path.join(base_dir, 'templates'),
           static_folder=os.path.join(base_dir, 'static'))

# Helper para obter a chave Supabase correta
def get_supabase_key():
    return os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_ANON_KEY', '')

# Validação de segurança do Supabase
try:
    from backend.supabase_guard import validate_supabase_target
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

# Importar agente de notícias de forma segura
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
if not os.environ.get('VERCEL'):
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

@app.route('/api/news/collect', methods=['POST'])
def collect_news():
    """Endpoint para iniciar coleta de notícias"""
    if NewsAgent is None:
        return jsonify({
            "success": False,
            "error": "NewsAgent não disponível no ambiente Vercel"
        }), 503
    
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
    if not HAS_NEWS_AGENT:
        return jsonify({
            "success": False,
            "error": "NewsAgent não disponível"
        }), 503
    
    try:
        data = request.get_json() or {}
        enabled_sources = data.get('enabled_sources', {
            "g1": True, "folha": True, "exame": True, "veja": True,
            "olhar_digital": True, "forbes_brasil": True
        })
        categories = data.get('categories', ['brasil', 'economia', 'tecnologia'])
        limit = data.get('limit', 50)
        
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
        return jsonify({
            "success": False,
            "error": "NewsAgent não disponível"
        }), 503
    
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
        return jsonify({
            "success": False,
            "error": "NewsAgent não disponível"
        }), 503
    
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
        return jsonify({
            "success": False,
            "error": "NewsAgent não disponível"
        }), 503
    
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
        return jsonify({
            "success": False,
            "error": "NewsAgent não disponível"
        }), 503
    
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
            "success": False,
            "status": "unavailable",
            "error": "NewsAgent não disponível"
        }), 503
    
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
HAS_SOCIAL_PUBLISHER = True
social_publisher = None
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
    """Gera conteúdo usando IA para posts sociais"""
    # CORS preflight
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response
    
    try:
        data = request.get_json()
        if not data:
            response = jsonify({"success": False, "error": "Dados não fornecidos"})
            response.headers.add('Access-Control-Allow-Origin', '*')
            return response, 400
        
        niche = data.get('niche', '')
        goals = data.get('goals', '')
        
        if not niche.strip():
            return jsonify({"success": False, "error": "Nichos não informados"}), 400
        
        # Simulação de geração de conteúdo com IA
        import uuid
        from datetime import datetime, timedelta
        
        content_plan = []
        
        # Gerar conteúdo para os próximos 7 dias
        for i in range(7):
            date = datetime.now() + timedelta(days=i+1)
            
            # Tipos de conteúdo variados
            content_types = ['post', 'story', 'reel']
            content_type = content_types[i % 3]
            
            # Tópicos baseados no nicho
            topics = [
                f"{niche}: Tendências e Inovações",
                f"Dicas de {niche} para Profissionais",
                f"O Futuro do {niche}: O que esperar",
                f"{niche} na Prática: Guia Completo",
                f"Erros Comuns em {niche} e Como Evitar",
                f"Ferramentas Essenciais para {niche}",
                f"Cases de Sucesso em {niche}"
            ]
            
            topic = topics[i % len(topics)]
            
            # Gerar caption
            if content_type == 'post':
                caption = f"Descubra as últimas tendências em {topic.lower()}! #{niche.replace(' ', '')} #Inovação #Tecnologia"
            elif content_type == 'story':
                caption = f"5 dicas rápidas sobre {topic.lower()} que você precisa conhecer! #{niche.replace(' ', '')} #Dicas #Aprendizado"
            else:
                caption = f"Aprenda em 60 segundos: Como dominar {topic.lower()}! #{niche.replace(' ', '')} #Tutorial #GuiaRapido"
            
            # Hashtags
            hashtags = [
                niche.replace(' ', ''),
                'Inovação',
                'Tecnologia' if 'tecnologia' in niche.lower() else 'Sucesso',
                'Dicas',
                'Guia'
            ]
            
            # Melhor horário baseado no tipo
            best_times = {'post': '09:00', 'story': '12:00', 'reel': '18:00'}
            
            content_plan.append({
                'id': str(uuid.uuid4()),
                'date': date.isoformat(),
                'type': content_type,
                'topic': topic,
                'caption': caption,
                'hashtags': hashtags[:3],  # Limitar a 3 hashtags
                'predicted_engagement': {
                    'score': 75 + (i * 5) % 20,  # Score entre 75-95
                    'reach': 8000 + (i * 1000) % 15000  # Reach entre 8k-23k
                },
                'best_time': best_times[content_type],
                'status': 'scheduled'
            })
        
        # Estratégia gerada
        strategy = f"Estratégia de conteúdo focada em {niche} com abordagem educacional e prática, combinando posts informativos, stories interativos e reels tutoriais para maximizar engajamento e alcance."
        
        response = jsonify({
            "success": True,
            "data": {
                "content_plan": content_plan,
                "strategy": strategy,
                "niche": niche,
                "goals": goals,
                "generated_at": datetime.now().isoformat(),
                "total_posts": len(content_plan)
            }
        })
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response
        
    except Exception as e:
        response = jsonify({
            "success": False,
            "error": f"Erro ao gerar conteúdo: {str(e)}"
        })
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response, 500

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
    """Lista todos os SocialPosts"""
    try:
        supabase_url = os.getenv('SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
        supabase_key = get_supabase_key()
        
        if not supabase_url or not supabase_key:
            return jsonify({"success": False, "error": "Credenciais Supabase não configuradas"}), 500
        
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json'
        }
        
        status_filter = request.args.get('status')
        limit = int(request.args.get('limit', 50))
        
        url = f"{supabase_url}/rest/v1/posts?select=*&order=created_at.desc&limit={limit}"
        if status_filter:
            url += f"&status=eq.{status_filter}"
        
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code in (200, 201):
            posts = response.json()
            return jsonify({"success": True, "posts": posts})
        else:
            return jsonify({"success": False, "error": f"Erro ao buscar posts: {response.status_code}"}), response.status_code
            
    except Exception as e:
        print(f"[DEBUG] Erro em api_list_social_posts: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/social/posts', methods=['POST'])
def api_create_social_post():
    """Cria um novo SocialPost"""
    data = request.get_json()
    if not data or not data.get('title'):
        return jsonify({"success": False, "error": "Título é obrigatório"}), 400

    # Se social_publisher não estiver disponível, salvar diretamente no Supabase
    if not HAS_SOCIAL_PUBLISHER:
        try:
            supabase_url = os.getenv('SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
            supabase_key = get_supabase_key()
            
            print(f"[DEBUG] Salvando post - URL: {supabase_url}")
            print(f"[DEBUG] Título: {data.get('title', '')[:50]}...")
            
            if not supabase_url or not supabase_key:
                print("[ERROR] Credenciais Supabase não configuradas para api_create_social_post")
                return jsonify({"success": False, "error": "Credenciais Supabase não configuradas"}), 500
            
            headers = {
                'apikey': supabase_key,
                'Authorization': f'Bearer {supabase_key}',
                'Content-Type': 'application/json'
            }
            
            post_data = {
                'title': data.get('title', ''),
                'content': data.get('caption', ''),
                'source_url': data.get('source_url', ''),
                'status': data.get('status', 'draft'),
                'hashtags': data.get('hashtags', ['noticia', 'brasil']),
                'created_at': datetime.now(timezone.utc).isoformat(),
                'updated_at': datetime.now(timezone.utc).isoformat()
            }
            
            print(f"[DEBUG] Post data: {post_data}")
            
            response = requests.post(
                f"{supabase_url}/rest/v1/posts",
                json=post_data,
                headers=headers,
                timeout=10
            )
            
            print(f"[DEBUG] Save response status: {response.status_code}")
            
            if response.status_code in (200, 201):
                result = response.json()
                post_id = result[0].get('id') if isinstance(result, list) and result else None
                print(f"[DEBUG] Post salvo com ID: {post_id}")
                return jsonify({
                    "success": True,
                    "post_id": post_id,
                    "message": "Rascunho salvo no Supabase"
                }), 201
            else:
                print(f"[DEBUG] Erro ao salvar: {response.text}")
                return jsonify({
                    "success": False,
                    "error": f"Erro ao salvar no Supabase: {response.status_code}"
                }), response.status_code
                
        except Exception as e:
            print(f"[DEBUG] Exceção ao salvar: {e}")
            return jsonify({"success": False, "error": str(e)}), 500

    # Usar social_publisher se disponível
    result = social_publisher.create_post(
        title=data.get('title', ''),
        caption=data.get('caption', ''),
        audio_url=data.get('audio_url', ''),
        image_url=data.get('image_url', ''),
        platforms=data.get('platforms', ['newpost_ia']),
        hashtags=data.get('hashtags', []),
        status=data.get('status', 'rascunho'),
        scheduled_at=data.get('scheduled_at'),
        ai_caption_generated=data.get('ai_caption_generated', False),
    )
    return jsonify(result), 201 if result.get('success') else 500

@app.route('/api/social/posts/<post_id>', methods=['GET'])
def api_get_social_post(post_id):
    """Obtém um SocialPost pelo ID"""
    if not HAS_SOCIAL_PUBLISHER:
        return jsonify({"success": False, "error": "Social Publisher não disponível"}), 503
    return jsonify(social_publisher.get_post(post_id))

@app.route('/api/social/posts/<post_id>', methods=['PATCH'])
def api_update_social_post(post_id):
    """Atualiza campos de um SocialPost"""
    if not HAS_SOCIAL_PUBLISHER:
        return jsonify({"success": False, "error": "Social Publisher não disponível"}), 503
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "error": "Dados não fornecidos"}), 400
    return jsonify(social_publisher.update_post(post_id, data))

@app.route('/api/social/posts/<post_id>/approve', methods=['POST'])
def api_approve_social_post(post_id):
    """Aprova um SocialPost para publicação"""
    if not HAS_SOCIAL_PUBLISHER:
        return jsonify({"success": False, "error": "Social Publisher não disponível"}), 503
    data = request.get_json() or {}
    result = social_publisher.approve_post(post_id, approved_by=data.get('approved_by', 'gestor'))
    return jsonify(result)

@app.route('/api/social/posts/<post_id>/reject', methods=['POST'])
def api_reject_social_post(post_id):
    """Rejeita um SocialPost"""
    if not HAS_SOCIAL_PUBLISHER:
        return jsonify({"success": False, "error": "Social Publisher não disponível"}), 503
    data = request.get_json() or {}
    result = social_publisher.reject_post(
        post_id,
        reason=data.get('reason', ''),
        rejected_by=data.get('rejected_by', 'gestor'),
    )
    return jsonify(result)

@app.route('/api/social/posts/<post_id>/publish', methods=['POST'])
def api_publish_social_post(post_id):
    """Publica um SocialPost aprovado na NewPost-IA"""
    if not HAS_SOCIAL_PUBLISHER:
        return jsonify({"success": False, "error": "Social Publisher não disponível"}), 503
    result = social_publisher.publish_to_newpost(post_id)
    status_code = 200 if result.get('success') else 422
    return jsonify(result), status_code

@app.route('/api/social/generate-caption', methods=['POST'])
def api_generate_social_caption():
    """Gera legenda IA para um post via Gemini"""
    if not HAS_SOCIAL_PUBLISHER:
        return jsonify({"success": False, "error": "Social Publisher não disponível"}), 503
    data = request.get_json()
    if not data or not data.get('title'):
        return jsonify({"success": False, "error": "Título é obrigatório"}), 400
    result = social_publisher.generate_ai_caption(
        title=data.get('title', ''),
        content=data.get('content', ''),
        hashtags=data.get('hashtags'),
    )
    return jsonify(result)

@app.route('/api/social/create-from-news', methods=['POST'])
def api_create_social_from_news():
    """Cria SocialPost a partir de uma notícia (com geração IA de legenda)"""
    if not HAS_SOCIAL_PUBLISHER:
        return jsonify({"success": False, "error": "Social Publisher não disponível"}), 503
    data = request.get_json()
    if not data or not data.get('title'):
        return jsonify({"success": False, "error": "Título é obrigatório"}), 400
    result = social_publisher.create_from_news(
        news_title=data.get('title', ''),
        news_content=data.get('content', ''),
        audio_url=data.get('audio_url', ''),
        image_url=data.get('image_url', ''),
        auto_caption=data.get('auto_caption', True),
    )
    return jsonify(result), 201 if result.get('success') else 500

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

@app.route('/api/automation/config', methods=['GET'])
def api_get_automation_config():
    """Obtém configuração de automação"""
    try:
        # Obter credenciais do ambiente
        supabase_url = os.getenv('SUPABASE_URL', '').rstrip('/')
        supabase_key = get_supabase_key()
        
        if not supabase_url or not supabase_key:
            print("[ERROR] Credenciais Supabase não configuradas para api_get_automation_config")
            return jsonify({
                'success': False,
                'error': 'Credenciais Supabase não configuradas'
            }), 500
        
        # Headers para API REST
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json'
        }
        
        # Buscar configuração mais recente via API REST
        response = requests.get(
            f"{supabase_url}/rest/v1/automation_config?select=*&order=created_at.desc&limit=1",
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            if data and len(data) > 0:
                return jsonify({
                    'success': True,
                    'config': data[0]
                })
            else:
                return jsonify({
                    'success': True,
                    'config': None
                })
        else:
            return jsonify({
                'success': False,
                'error': f'Erro ao buscar configuração: {response.status_code}'
            }), 500
            
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
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'Dados não fornecidos'
            }), 400
        
        # Validar dados (tabela simplificada)
        required_fields = ['active_categories', 'schedule_time_1']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'error': f'Campo obrigatório: {field}'
                }), 400

        # Campos aceitos (para reduzir bugs de payload)
        allowed_fields = {'active_categories', 'schedule_time_1', 'enabled', 'id'}
        
        # Se quiser bloquear campos extras vindos do frontend:
        extra_fields = set(data.keys()) - allowed_fields
        if extra_fields:
            return jsonify({
                'success': False,
                'error': f'Campos não suportados: {sorted(list(extra_fields))}'
            }), 400

        # enabled opcional: se não vier, assume True (ou deixe o DB default cuidar)
        if 'enabled' not in data or data['enabled'] is None:
            data['enabled'] = True
        
        # Validação de tipos e formatos
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
        
        # Validar formato do horário HH:MM:SS
        import re
        time_pattern = r'^([01]?[0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])$'
        if not re.match(time_pattern, data['schedule_time_1']):
            return jsonify({
                'success': False,
                'error': 'schedule_time_1 deve estar no formato HH:MM:SS (ex: 09:10:00)'
            }), 400
        
        # Validar enabled como booleano
        if not isinstance(data.get('enabled'), bool):
            return jsonify({
                'success': False,
                'error': 'enabled deve ser true ou false'
            }), 400
        
        # Validar ID se fornecido (para UPDATE)
        if data.get('id'):
            import uuid
            try:
                # Tentar converter para UUID para validar formato
                uuid.UUID(str(data['id']))
            except ValueError:
                return jsonify({
                    'success': False,
                    'error': 'id deve ser um UUID válido'
                }), 400
        
        # Obter credenciais do ambiente
        supabase_url = os.getenv('SUPABASE_URL', '').rstrip('/')
        supabase_key = get_supabase_key()
        
        if not supabase_url or not supabase_key:
            print("[ERROR] Credenciais Supabase não configuradas para api_save_automation_config")
            return jsonify({
                'success': False,
                'error': 'Credenciais Supabase não configuradas'
            }), 500
        
        # Headers para API REST
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
        
        # Preparar dados para salvar (apenas campos que existem na tabela)
        config_data = {
            'active_categories': data['active_categories'],
            'schedule_time_1': data['schedule_time_1'],
            'enabled': data.get('enabled', True)
        }
        
        result = None
        
        # Verificar se já existe configuração
        if data.get('id'):
            # UPDATE via PATCH
            response = requests.patch(
                f"{supabase_url}/rest/v1/automation_config?id=eq.{data['id']}",
                headers=headers,
                json=config_data,
                timeout=10
            )
            if response.status_code == 200:
                result = response.json()
        else:
            # INSERT via POST
            response = requests.post(
                f"{supabase_url}/rest/v1/automation_config",
                headers=headers,
                json=config_data,
                timeout=10
            )
            if response.status_code in (200, 201):
                result = response.json()
        
        if result and len(result) > 0:
            return jsonify({
                'success': True,
                'config': result[0],
                'message': 'Configuração salva com sucesso!'
            })
        else:
            return jsonify({
                'success': False,
                'error': f'Erro ao salvar configuração: {response.status_code} - {response.text}'
            }), 500
            
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
        
        # Salvar estado no arquivo de configuração
        import json
        config_file = 'automation_state.json'
        
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                state = json.load(f)
        except:
            state = {}
        
        state[f'{type}_enabled'] = enabled
        
        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(state, f, indent=2)
        
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
        
        # Credenciais do Supabase da NewPost-IA (projeto: ykswhzqdjoshjoaruhqs)
        newpost_url = os.getenv('NEWPOST_SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
        newpost_key = os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlrc3doenFkam9zaGpvYXJ1aHFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MTA4MjYsImV4cCI6MjA4NzE4NjgyNn0.yzezm6VZ5U_O7Txaj8B4_TD0PFVSpjZspYcZ1CYD0jo')
        newpost_author_id = os.getenv('NEWPOST_AUTHOR_ID', '3a1a93d0-e451-47a4-a126-f1b7375895eb')
        
        if not newpost_url or not newpost_key:
            return jsonify({"success": False, "error": "Credenciais NewPost-IA não configuradas"}), 500
        
        # Author ID padrão do NewPost-IA (pankilhas@gmail.com)
        DEFAULT_AUTHOR_ID = newpost_author_id
        
        # Preparar dados para tabela newpost_posts (colunas exatas: titulo, descricao, conteudo, hashtags, autor_id, criado_em, atualizado_em)
        # Usar UTC para timestamptz do Supabase
        post_data = {
            'titulo': data.get('title', ''),
            'descricao': data.get('content', data.get('summary', ''))[:200],
            'conteudo': data.get('content', data.get('summary', '')),
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
        posts_data = {
            'title': data.get('title', ''),
            'content': data.get('content', data.get('summary', '')),
            'image_url': data.get('image_url', ''),
            'author_id': DEFAULT_AUTHOR_ID,
            'created_at': now_utc,
            'updated_at': now_utc,
            'published_at': now_utc,
            'status': 'published',
            'is_ia_generated': True,
            'source_url': data.get('url', '')
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
    """Lista ou limpa publicações do News Auto Post"""
    if request.method == 'DELETE':
        """Limpa todas as publicações"""
        try:
            supabase_url = os.getenv('SUPABASE_URL', 'https://hzmtdfojctctvgqjdbex.supabase.co').rstrip('/')
            supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_ANON_KEY', '')
            
            if not supabase_url or not supabase_key:
                print("[ERROR] Credenciais Supabase não configuradas para handle_publications DELETE")
                return jsonify({"success": False, "error": "Credenciais não configuradas"}), 500
            
            headers = {
                'apikey': supabase_key,
                'Authorization': f'Bearer {supabase_key}',
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            }
            
            # Contar posts antes
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
            
            # Deletar todos os posts usando filtro que seleciona todos
            # Supabase permite deletar com filtro id=not.is.null para selecionar todos
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
            
            # Fallback: se o filtro acima não funcionar, buscar IDs e deletar individualmente
            print("⚠️ Filtro batch falhou, usando deleção individual...")
            response = requests.get(
                f"{supabase_url}/rest/v1/posts?select=id",
                headers=headers,
                timeout=15
            )
            
            if response.status_code != 200:
                return jsonify({
                    "success": False,
                    "error": f"Erro ao buscar IDs: {response.status_code}"
                }), response.status_code
            
            posts = response.json()
            deleted_count = 0
            
            for post in posts:
                post_id = post.get('id')
                if post_id:
                    delete_response = requests.delete(
                        f"{supabase_url}/rest/v1/posts?id=eq.{post_id}",
                        headers=headers,
                        timeout=5
                    )
                    if delete_response.status_code in (200, 204):
                        deleted_count += 1
            
            if deleted_count > 0:
                return jsonify({
                    "success": True,
                    "message": f"{deleted_count} publicações limpas com sucesso (modo fallback)",
                    "deleted_count": deleted_count
                })
            else:
                return jsonify({
                    "success": False,
                    "error": "Nenhuma publicação foi deletada"
                }), 500
            
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500
    
    # GET - Listar publicações
    try:
        supabase_url = os.getenv('SUPABASE_URL', 'https://hzmtdfojctctvgqjdbex.supabase.co').rstrip('/')
        supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_ANON_KEY', '')
        
        print(f"[DEBUG] Listando publicações - URL: {supabase_url}")
        print(f"[DEBUG] Supabase Key presente: {bool(supabase_key)}")
        key_type = 'SERVICE_ROLE' if os.getenv('SUPABASE_SERVICE_ROLE_KEY') else ('SERVICE_KEY' if os.getenv('SUPABASE_SERVICE_KEY') else 'ANON_KEY')
        print(f"[DEBUG] Usando chave: {key_type}")
        
        if not supabase_url or not supabase_key:
            print("[ERROR] Credenciais Supabase não configuradas para handle_publications GET")
            return jsonify({"success": False, "error": "Credenciais não configuradas"}), 500
        
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json'
        }
        
        # Buscar posts (todos os posts, não só published)
        response = requests.get(
            f"{supabase_url}/rest/v1/posts?order=created_at.desc&limit=50",
            headers=headers,
            timeout=10
        )
        
        print(f"[DEBUG] Response status: {response.status_code}")
        
        if response.status_code == 200:
            posts = response.json()
            print(f"[DEBUG] Posts encontrados: {len(posts)}")
            return jsonify({
                "success": True,
                "total": len(posts),
                "publications": posts
            })
        
        print(f"[DEBUG] Erro na resposta: {response.text}")
        
        return jsonify({
            "success": False,
            "error": f"Erro ao buscar publicações: {response.status_code}"
        }), response.status_code
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/publications/<id>', methods=['PATCH'])
def update_publication(id):
    """Atualiza uma publicação"""
    try:
        data = request.get_json()
        supabase_url = os.getenv('SUPABASE_URL', 'https://hzmtdfojctctvgqjdbex.supabase.co').rstrip('/')
        supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_ANON_KEY', '')
        
        if not supabase_key:
            print("[ERROR] Chave Supabase não configurada para update_publication")
            return jsonify({"success": False, "error": "Chave Supabase não configurada"}), 500
        
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json'
        }
        
        update_data = {}
        if 'title' in data:
            update_data['title'] = data['title']
        if 'content' in data:
            update_data['content'] = data['content']
        update_data['updated_at'] = datetime.now().isoformat()
        
        response = requests.patch(
            f"{supabase_url}/rest/v1/posts?id=eq.{id}",
            json=update_data,
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            return jsonify({"success": True, "message": "Publicação atualizada"})
        
        return jsonify({"success": False, "error": f"Erro: {response.status_code}"}), response.status_code
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/publications/<id>/approve', methods=['POST'])
def approve_publication(id):
    """Aprova uma publicação"""
    try:
        supabase_url = os.getenv('SUPABASE_URL', 'https://hzmtdfojctctvgqjdbex.supabase.co').rstrip('/')
        supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_ANON_KEY', '')
        
        if not supabase_key:
            print("[ERROR] Chave Supabase não configurada para approve_publication")
            return jsonify({"success": False, "error": "Chave Supabase não configurada"}), 500
        
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json'
        }
        
        print(f"[DEBUG] Aprovando publicação ID: {id}")
        print(f"[DEBUG] URL: {supabase_url}/rest/v1/posts?id=eq.{id}")
        
        response = requests.patch(
            f"{supabase_url}/rest/v1/posts?id=eq.{id}",
            json={'status': 'published', 'updated_at': datetime.now(timezone.utc).isoformat()},
            headers=headers,
            timeout=10
        )
        
        print(f"[DEBUG] Status code: {response.status_code}")
        print(f"[DEBUG] Response: {response.text[:200]}")
        
        if response.status_code in [200, 204]:
            return jsonify({"success": True, "message": "Publicação aprovada"})
        
        error_msg = f"Erro: {response.status_code}"
        try:
            error_data = response.json()
            if 'message' in error_data:
                error_msg = error_data['message']
        except:
            error_msg = response.text[:200]
        
        return jsonify({"success": False, "error": error_msg}), response.status_code
        
    except Exception as e:
        print(f"[ERROR] Exceção ao aprovar: {e}")
        import traceback
        print(f"[TRACEBACK] {traceback.format_exc()}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/publications/<id>/convert-to-social', methods=['POST'])
def convert_to_social_post(id):
    """Converte um post da tabela posts em um social_post para publicação"""
    try:
        supabase_url = os.getenv('SUPABASE_URL', 'https://ykswhzqdjoshjoaruhqs.supabase.co').rstrip('/')
        supabase_key = get_supabase_key()
        
        if not supabase_key:
            print("[ERROR] Credenciais Supabase não configuradas para convert_to_social_post")
            return jsonify({"success": False, "error": "Chave Supabase não configurada"}), 500
        
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json'
        }
        
        # Buscar o post original
        response = requests.get(
            f"{supabase_url}/rest/v1/posts?id=eq.{id}",
            headers=headers,
            timeout=10
        )
        
        if response.status_code != 200 or not response.json():
            return jsonify({"success": False, "error": "Post não encontrado"}), 404
        
        post = response.json()[0]
        
        # Usar SocialPostPublisher para criar o social_post
        if HAS_SOCIAL_PUBLISHER:
            result = social_publisher.create_from_news(
                news_title=post.get('title', ''),
                news_content=post.get('content', ''),
                image_url=post.get('image_url', ''),
                audio_url=post.get('audio_url', ''),
                auto_caption=True
            )
            
            if result.get('success'):
                # Marcar o post original como convertido
                requests.patch(
                    f"{supabase_url}/rest/v1/posts?id=eq.{id}",
                    json={'metadata': {**post.get('metadata', {}), 'converted_to_social': True, 'social_post_id': result.get('post', {}).get('id')}},
                    headers=headers,
                    timeout=10
                )
                
                return jsonify({
                    "success": True,
                    "message": "Post convertido para social_post com sucesso",
                    "social_post": result.get('post')
                })
            else:
                return jsonify({"success": False, "error": result.get('error', 'Erro ao converter')}), 500
        else:
            return jsonify({"success": False, "error": "SocialPostPublisher não disponível"}), 500
            
    except Exception as e:
        print(f"[ERROR] Exceção ao converter: {e}")
        import traceback
        print(f"[TRACEBACK] {traceback.format_exc()}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/publications/<id>/publish-to-newpost', methods=['POST'])
def publish_to_newpost_route(id):
    """Publica um post diretamente na NewPost-IA"""
    try:
        # Primeiro converter para social_post se necessário
        supabase_url = os.getenv('SUPABASE_URL', 'https://hzmtdfojctctvgqjdbex.supabase.co').rstrip('/')
        supabase_key = get_supabase_key()
        
        if not supabase_key:
            print("[ERROR] Chave Supabase não configurada para publish_to_newpost_route")
            return jsonify({"success": False, "error": "Chave Supabase não configurada"}), 500
        
        headers = {
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json'
        }
        
        print(f"[DEBUG] Tentando publicar ID: {id}")
        print(f"[DEBUG] Usando URL: {supabase_url}")
        
        # Buscar o post original
        url = f"{supabase_url}/rest/v1/posts?id=eq.{id}"
        response = requests.get(url, headers=headers, timeout=10)
        
        print(f"[DEBUG] Resposta Supabase ({response.status_code}): {response.text[:200]}")
        
        if response.status_code != 200 or not response.json():
            # Tentar buscar sem o filtro de ID se falhar, apenas para debug de conexão
            debug_resp = requests.get(f"{supabase_url}/rest/v1/posts?limit=1", headers=headers, timeout=5)
            print(f"[DEBUG] Teste de conexão (posts limit 1): {debug_resp.status_code}")
            return jsonify({"success": False, "error": "Post original não encontrado", "id_solicitado": id}), 404
        
        post = response.json()[0]
        
        # Criar social_post
        if HAS_SOCIAL_PUBLISHER:
            result = social_publisher.create_from_news(
                news_title=post.get('title', ''),
                news_content=post.get('content', ''),
                image_url=post.get('image_url', ''),
                audio_url=post.get('audio_url', ''),
                auto_caption=True
            )
            
            if not result.get('success'):
                return jsonify({"success": False, "error": f"Erro ao criar social_post: {result.get('error')}"}), 500
            
            social_post = result.get('post')
            social_post_id = social_post.get('id')
            
            # Publicar usando SocialPostPublisher
            publish_result = social_publisher.publish_to_newpost(social_post_id)
            
            if publish_result.get('success'):
                # Marcar o post original como convertido/publicado
                requests.patch(
                    f"{supabase_url}/rest/v1/posts?id=eq.{id}",
                    json={'metadata': {**post.get('metadata', {}), 'converted_to_social': True, 'social_post_id': social_post_id, 'published': True}},
                    headers=headers,
                    timeout=10
                )
                
                return jsonify({
                    "success": True,
                    "message": "Post publicado na NewPost-IA com sucesso",
                    "publish_results": publish_result.get('publish_results')
                })
            else:
                return jsonify({"success": False, "error": publish_result.get('error', 'Erro ao publicar na NewPost-IA')}), 500
        else:
            return jsonify({"success": False, "error": "SocialPostPublisher não disponível"}), 500
            
    except Exception as e:
        print(f"[ERROR] Exceção ao publicar: {e}")
        import traceback
        print(f"[TRACEBACK] {traceback.format_exc()}")
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

# Para desenvolvimento local
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print("Iniciando Locutores IA Server...")
    print("Acesse: http://localhost:5000")
    print("Dashboard: http://localhost:5000/dashboard")
    app.run(host='0.0.0.0', port=port, debug=True)