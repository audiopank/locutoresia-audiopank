# API handler para Vercel serverless - Versão Segura e Simplificada
import sys
import os

print("[DEBUG] Iniciando api/index.py")
print(f"[DEBUG] Diretório atual: {os.getcwd()}")
print(f"[DEBUG] __file__: {__file__}")

try:
    # Caminhos absolutos para garantir
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    backend_path = os.path.join(project_root, 'backend')
    core_path = os.path.join(project_root, 'core')
    
    print(f"[DEBUG] Project root: {project_root}")
    print(f"[DEBUG] Backend path: {backend_path}")
    print(f"[DEBUG] Core path: {core_path}")
    print(f"[DEBUG] Backend existe? {os.path.exists(backend_path)}")
    print(f"[DEBUG] Templates existe? {os.path.exists(os.path.join(project_root, 'templates'))}")
    print(f"[DEBUG] Static existe? {os.path.exists(os.path.join(project_root, 'static'))}")
    
    # Adicionar caminhos ao sys.path
    sys.path.insert(0, backend_path)
    sys.path.insert(0, core_path)
    sys.path.insert(0, project_root)
    
    print(f"[DEBUG] sys.path: {sys.path}")
    
    # Importar o app Flask
    print("[DEBUG] Tentando importar app de backend.app")
    from app import app as flask_app
    print("[DEBUG] App importado com sucesso!")
    
    # Vercel WSGI handler
    application = flask_app
    print("[DEBUG] application configurado!")
    
except Exception as e:
    print(f"[ERRO CRÍTICO] {type(e).__name__}: {e}")
    import traceback
    print(f"[STACK TRACE] {traceback.format_exc()}")
    
    # Criar um app minimalista para mostrar erro
    from flask import Flask, jsonify
    application = Flask(__name__)
    
    @application.route('/')
    def index():
        return jsonify({
            "error": str(e),
            "type": type(e).__name__,
            "debug": {
                "cwd": os.getcwd(),
                "sys.path": sys.path
            }
        }), 500
