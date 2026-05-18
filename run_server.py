#!/usr/bin/env python3
import os
import sys
from dotenv import load_dotenv

# Carregar variáveis de ambiente do arquivo .env
load_dotenv()

# Adicionar caminhos
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'core'))

# Importar Flask app do backend
from backend.app import app

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print("Iniciando Locutores IA Server...")
    print("Acesse: http://localhost:5000")
    print("Dashboard: http://localhost:5000/dashboard")
    app.run(host='0.0.0.0', port=port, debug=True)
