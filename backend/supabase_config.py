# Configuração do Supabase para o News Auto Post
import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Carregar variáveis de ambiente
load_dotenv()

# Configurações do Supabase
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL", 
                          os.getenv("SUPABASE_URL", "https://sua-url.supabase.co"))
SUPABASE_KEY = os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY", 
                          os.getenv("SUPABASE_SERVICE_KEY", 
                          os.getenv("SUPABASE_SERVICE_ROLE_KEY", 
                          os.getenv("SUPABASE_ANON_KEY", 
                          os.getenv("SUPABASE_KEY", "sua-chave-anon")))))

def get_supabase_client() -> Client:
    """Retorna cliente Supabase configurado"""
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def get_supabase_config():
    """Retorna configurações do Supabase"""
    return {
        "url": SUPABASE_URL,
        "key": SUPABASE_KEY
    }

# Tabelas do sistema
TABLES = {
    "publications": {
        "columns": {
            "id": "SERIAL PRIMARY KEY",
            "content": "TEXT NOT NULL",
            "hashtags": "TEXT[]",
            "source": "VARCHAR(50)",
            "published_to": "VARCHAR(100)",
            "published_at": "TIMESTAMP DEFAULT NOW()",
            "status": "VARCHAR(20) DEFAULT 'published'",
            "newpost_id": "VARCHAR(100)",
            "title": "VARCHAR(500)",
            "summary": "TEXT",
            "link": "TEXT"
        }
    },
    "logs": {
        "columns": {
            "id": "SERIAL PRIMARY KEY",
            "message": "TEXT NOT NULL",
            "type": "VARCHAR(20)",
            "created_at": "TIMESTAMP DEFAULT NOW()",
            "publication_id": "INTEGER REFERENCES publications(id)"
        }
    },
    "sources": {
        "columns": {
            "id": "VARCHAR(50) PRIMARY KEY",
            "name": "VARCHAR(100)",
            "url": "TEXT",
            "enabled": "BOOLEAN DEFAULT true",
            "last_fetch": "TIMESTAMP",
            "category": "VARCHAR(50)"
        }
    },
    "analytics": {
        "columns": {
            "id": "SERIAL PRIMARY KEY",
            "date": "DATE DEFAULT CURRENT_DATE",
            "publications_count": "INTEGER DEFAULT 0",
            "success_count": "INTEGER DEFAULT 0",
            "error_count": "INTEGER DEFAULT 0",
            "most_used_source": "VARCHAR(50)"
        }
    }
}

# SQL para criar tabelas
CREATE_TABLES_SQL = """
-- Tabela de Publicações
CREATE TABLE IF NOT EXISTS publications (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    hashtags TEXT[],
    source VARCHAR(50),
    published_to VARCHAR(100),
    published_at TIMESTAMP DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'published',
    newpost_id VARCHAR(100),
    title VARCHAR(500),
    summary TEXT,
    link TEXT
);

-- Tabela de Logs
CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    message TEXT NOT NULL,
    type VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW(),
    publication_id INTEGER REFERENCES publications(id)
);

-- Tabela de Fontes
CREATE TABLE IF NOT EXISTS sources (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100),
    url TEXT,
    enabled BOOLEAN DEFAULT true,
    last_fetch TIMESTAMP,
    category VARCHAR(50)
);

-- Tabela de Analytics
CREATE TABLE IF NOT EXISTS analytics (
    id SERIAL PRIMARY KEY,
    date DATE DEFAULT CURRENT_DATE,
    publications_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    most_used_source VARCHAR(50)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_publications_published_at ON publications(published_at);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics(date);

-- Inserir fontes padrão
INSERT INTO sources (id, name, url, category) VALUES
('exame', 'Exame', 'https://exame.com/feed/', 'tecnologia'),
('veja', 'Veja', 'https://veja.abril.com.br/feed/', 'geral'),
('folha', 'Folha de S.Paulo', 'https://feeds.folha.uol.com.br/emcimadahora/rss091.xml', 'politica'),
('diario_nordeste', 'Diário do Nordeste', 'https://diariodonordeste.verdesmares.com.br/rss/ultimas-noticias', 'regional')
ON CONFLICT (id) DO NOTHING;
"""
