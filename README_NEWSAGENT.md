# 📰 NewsAgent - API de Coleta Automática de Notícias Brasileiras

## 🎯 Visão Geral

NewsAgent é um sistema inteligente para coleta, armazenamento e publicação automática de notícias de fontes brasileiras de qualidade. Suporta múltiplas fontes em tempo real com cache local e agendamento automático.

### Fontes Suportadas
- **G1** - Portal de notícias Globo
- **Folha de S.Paulo** - Jornal tradicional brasileiro
- **Exame** - Foco em economia e negócios
- **Veja** - Revista semanal
- **Olhar Digital** - Especializado em tecnologia
- **Forbes Brasil** - Cobertura de inovação e negócios

### Categorias Disponíveis
- `brasil` - Notícias nacionais
- `economia` - Economia e mercados
- `tecnologia` - Inovação e tecnologia
- `politica` - Política e governo

---

## 🚀 Instalação

### 1. Instalar dependências
```bash
pip install -r requirements.txt
```

### 2. Executar a aplicação
```bash
# Modo desenvolvimento
python app.py

# Modo produção
FLASK_ENV=production PORT=8000 python app.py
```

### 3. Acessar a API
- Interface web: `http://localhost:5000/` 
- API: `http://localhost:5000/api/news/` 

---

## 📚 Endpoints da API

### 1. GET `/api/news/sources` 
Retorna lista de todas as fontes disponíveis

**Exemplo de Resposta:**
```json
{
  "success": true,
  "sources": [
    {
      "id": "g1",
      "label": "G1",
      "url": "https://g1.globo.com",
      "categories": ["brasil", "economia", "tecnologia", "politica"]
    },
    {
      "id": "folha",
      "label": "Folha de S.Paulo",
      "url": "https://www.folha.uol.com.br",
      "categories": ["brasil", "economia", "tecnologia", "politica"]
    }
  ],
  "total_sources": 6,
  "timestamp": "2024-01-15T10:30:00"
}
```

---

### 2. POST `/api/news/execute` 
Executa coleta de notícias com filtros customizados

**Request Body:**
```json
{
  "enabled_sources": {
    "g1": true,
    "folha": true,
    "exame": true,
    "veja": true,
    "olhar_digital": true,
    "forbes_brasil": true
  },
  "categories": ["brasil", "economia", "tecnologia"],
  "limit": 50
}
```

**Exemplo de Resposta:**
```json
{
  "success": true,
  "total_news": 45,
  "news": [
    {
      "title": "IA revoluciona mercado de trabalho",
      "url": "https://g1.globo.com/noticia",
      "source": "G1",
      "source_key": "g1",
      "category": "economia",
      "snippet": "Nova pesquisa mostra que inteligência artificial...",
      "published_at": "15/01/2024 10:30",
      "image_url": ""
    },
    {
      "title": "Economia brasileira cresce mais que esperado",
      "url": "https://exame.com/noticia",
      "source": "Exame",
      "source_key": "exame",
      "category": "economia",
      "snippet": "PIB cresceu 2.4% no ano...",
      "published_at": "15/0105/2026 09:45",
      "image_url": ""
    }
  ],
  "collection_stats": {
    "g1": {
      "collected": 8,
      "error": null
    },
    "folha": {
      "collected": 7,
      "error": null
    }
  },
  "timestamp": "2024-01-15T10:32:00"
}
```

---

### 3. GET `/api/news/collect/<source>/<category>` 
Coleta notícias de uma fonte específica

**Exemplos:**
- `/api/news/collect/g1/brasil` 
- `/api/news/collect/exame/economia` 
- `/api/news/collect/folha/tecnologia` 

**Resposta:**
```json
{
  "success": true,
  "source": "g1",
  "category": "brasil",
  "total": 10,
  "news": [
    {
      "title": "Título da notícia",
      "url": "https://...",
      "source": "G1",
      "category": "brasil",
      "published_at": "15/01/2024 10:30"
    }
  ],
  "timestamp": "2024-01-15T10:32:00"
}
```

---

### 4. GET `/api/news/cache` 
Retorna notícias armazenadas em cache local

**Parâmetros:**
- `limit` (opcional): Número máximo de notícias (padrão: 50)
- `category` (opcional): Filtrar por categoria

**Exemplo:**
```
GET /api/news/cache?limit=100&category=tecnologia
```

**Resposta:**
```json
{
  "success": true,
  "total_cached": 87,
  "news": [
    {
      "id": 1,
      "title": "Título da notícia",
      "url": "https://...",
      "source": "G1",
      "category": "brasil",
      "collected_at": "2024-01-15T10:30:00",
      "published": false
    }
  ],
  "timestamp": "2024-01-15T10:32:00"
}
```

---

### 5. GET `/api/news/status` 
Retorna status de coleta de cada fonte

**Resposta:**
```json
{
  "success": true,
  "status": {
    "g1": {
      "status": "success",
      "last_update": "2024-01-15T10:30:00"
    },
    "folha": {
      "status": "success",
      "last_update": "2024-01-15T10:29:00"
    },
    "exame": {
      "status": "error",
      "last_update": "2024-01-15T09:30:00",
      "error_message": "Connection timeout"
    }
  },
  "timestamp": "2024-01-15T10:32:00"
}
```

---

### 6. GET `/api/news/health` 
Health check do serviço

**Resposta:**
```json
{
  "success": true,
  "status": "healthy",
  "agent_ok": true,
  "timestamp": "2024-01-15T10:32:00"
}
```

---

## 🔄 Agendamento Automático

### Usar o Scheduler

O NewsAgent inclui um scheduler para coleta automática de notícias em background.

**Modo contínuo:**
```bash
python news_scheduler.py
```

**Modo execução única (útil para cron jobs):**
```bash
python news_scheduler.py --once
```

**Ver estatísticas:**
```bash
python news_scheduler.py --stats
```

### Configurar Cron Job (Linux/Mac)

Adicionar ao crontab para executar coleta a cada hora:

```bash
crontab -e

# Adicionar linha:
0 * * * * cd /caminho/projeto && python news_scheduler.py --once
```

### Configurar Task Scheduler (Windows)

1. Abrir Task Scheduler
2. Criar tarefa
3. Ação: `python news_scheduler.py --once` 
4. Disparador: Repetir a cada hora

---

## 💾 Banco de Dados Local

O NewsAgent utiliza SQLite para cache local. Arquivo: `news_cache.db` 

### Tabelas

**1. `news` - Armazena notícias coletadas**
```sql
CREATE TABLE news (
    id INTEGER PRIMARY KEY,
    title TEXT,
    summary TEXT,
    url TEXT UNIQUE,
    source TEXT,
    category TEXT,
    published_at TEXT,
    collected_at TIMESTAMP,
    published BOOLEAN,
    image_url TEXT
);
```

**2. `source_status` - Status de cada fonte**
```sql
CREATE TABLE source_status (
    source TEXT PRIMARY KEY,
    last_update TIMESTAMP,
    status TEXT,
    error_message TEXT
);
```

---

## 🔐 Deployment em Produção

### Com Gunicorn

1. Instalar Gunicorn:
```bash
pip install gunicorn
```

2. Executar:
```bash
gunicorn --workers 4 --bind 0.0.0.0:8000 app:app
```

### Com Docker

**Dockerfile:**
```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

CMD ["gunicorn", "--workers", "4", "--bind", "0.0.0.0:8000", "app:app"]
```

**Build e run:**
```bash
docker build -t newsagent .
docker run -p 8000:8000 newsagent
```

### Com Nginx (Reverse Proxy)

**nginx.conf:**
```nginx
server {
    listen 80;
    server_name seu-dominio.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 🧪 Testes e Exemplos

### Python
```python
from news_agent import NewsAgent

# Criar agente
agent = NewsAgent()

# Coletar notícias
news = agent.collect_from_source("g1", "brasil")

# Exibir
for n in news:
    print(f"{n['title']} - {n['source']}")

# Obter cache
cached = agent.get_cached_news(limit=20)
print(f"Notícias em cache: {len(cached)}")
```

### JavaScript/Fetch
```javascript
// Coletar notícias
const response = await fetch('http://localhost:5000/api/news/execute', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    enabled_sources: {
      g1: true,
      folha: true,
      exame: true
    },
    categories: ['brasil', 'economia'],
    limit: 50
  })
});

const data = await response.json();
console.log(`${data.total_news} notícias coletadas`);

// Exibir notícias
data.news.forEach(news => {
  console.log(`${news.title} (${news.source})`);
});
```

### cURL
```bash
# Listar fontes
curl http://localhost:5000/api/news/sources

# Coletar notícias
curl -X POST http://localhost:5000/api/news/execute \
  -H "Content-Type: application/json" \
  -d '{
    "enabled_sources": {"g1": true, "folha": true},
    "categories": ["brasil"],
    "limit": 20
  }'

# Obter cache
curl http://localhost:5000/api/news/cache?limit=50

# Status
curl http://localhost:5000/api/news/status
```

---

## ⚙️ Configuração Avançada

### Ajustar Tempo de Cache

Editar `news_agent.py`, método `_get_cached_news()`:

```python
cutoff_time = datetime.now() - timedelta(hours=2)  # Aumentar para 2 horas
```

### Adicionar Nova Fonte

1. Adicionar entrada em `SOURCES` dict
2. Implementar método `_collect_<fonte>()` 
3. Adicionar seletor CSS apropriado
4. Testar coleta

```python
SOURCES = {
    "minha_fonte": {
        "url": "https://...",
        "name": "Minha Fonte",
        "categories": {
            "brasil": "/noticias/",
            "economia": "/economia/"
        }
    }
}

def _collect_minha_fonte(self, category: str) -> List[Dict]:
    # Implementar coleta...
    pass
```

---

## 📊 Monitoramento

### Verificar Logs
```bash
tail -f news_agent.log
tail -f news_scheduler.log
```

### Verificar Estatísticas do Scheduler
```bash
cat scheduler_stats.json | python -m json.tool
```

### Status do Banco de Dados
```bash
sqlite3 news_cache.db "SELECT COUNT(*) as total, source FROM news GROUP BY source;"
```

---

## 🐛 Troubleshooting

### Erro: "NewsAgent não disponível"
- Verificar se dependências estão instaladas
- Verificar logs para erros de inicialização
- Reiniciar aplicação

### Nenhuma notícia coletada
- Verificar conexão de internet
- Verificar seletores CSS (podem ter mudado)
- Consultar status em `/api/news/status` 

### Erro de timeout
- Aumentar tempo de timeout em `requests.Session()` 
- Verificar velocidade da internet
- Usar coleta prioritária (menos fontes)

### Banco de dados corrompido
```bash
rm news_cache.db
# Aplicação recriará ao iniciar
```

---

## 📝 Logs e Debug

### Ativar Debug Mode
```python
# Em app.py
if __name__ == '__main__':
    app.run(debug=True)
```

### Nível de Log
```python
# Em news_agent.py
logging.basicConfig(level=logging.DEBUG)  # Mais verboso
```

---

## 🎉 Implementação Concluída

✅ **NewsAgent implementado com sucesso!**

### Funcionalidades Implementadas:
- ✅ Coleta de 6 fontes brasileiras (G1, Folha, Exame, Veja, Olhar Digital, Forbes Brasil)
- ✅ Sistema de cache local com SQLite
- ✅ Agendamento automático com scheduler
- ✅ API REST completa com 6 endpoints
- ✅ Sistema de status e monitoramento
- ✅ Tratamento de erros e logs
- ✅ Documentação completa

### Próximos Passos:
1. Instalar dependências: `pip install -r requirements.txt`
2. Executar servidor: `python app.py`
3. Testar endpoints conforme documentação
4. Configurar scheduler para coleta automática

---

**Desenvolvido para Locutores IA - Sistema de Geração de Conteúdo Automático**
