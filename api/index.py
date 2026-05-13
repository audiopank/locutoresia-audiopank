# API handler para Vercel serverless
import sys
import os

# Add backend to path
backend_path = os.path.join(os.path.dirname(__file__), '..', 'backend')
core_path = os.path.join(os.path.dirname(__file__), '..', 'core')
sys.path.insert(0, backend_path)
sys.path.insert(0, core_path)

# Import Flask app
from app import app

# Handler para Vercel (WSGI)
class Handler:
    def __init__(self):
        self.app = app
    
    def __call__(self, environ, start_response):
        return self.app(environ, start_response)

# Instância do handler
handler = Handler()

# Mantém compatibilidade com app original
application = app
