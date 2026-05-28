# API handler para Vercel serverless - VERSÃO ULTRA SIMPLES E SEGURA
import sys
import os

print("[DEBUG] ========== api/index.py INICIADO ==========")
print(f"[DEBUG] os.getcwd(): {os.getcwd()}")
print(f"[DEBUG] __file__: {__file__}")
print(f"[DEBUG] sys.version: {sys.version}")

try:
    # 1. Configurar caminhos
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    backend_path = os.path.join(project_root, 'backend')
    templates_path = os.path.join(project_root, 'templates')
    static_path = os.path.join(project_root, 'static')

    print(f"[DEBUG] 1. project_root: {project_root}")
    print(f"[DEBUG] 2. backend_path: {backend_path} (existe? {os.path.exists(backend_path)})")
    print(f"[DEBUG] 3. templates_path: {templates_path} (existe? {os.path.exists(templates_path)})")
    print(f"[DEBUG] 4. static_path: {static_path} (existe? {os.path.exists(static_path)})")

    # Adicionar ao sys.path
    sys.path.insert(0, backend_path)
    sys.path.insert(0, project_root)
    print(f"[DEBUG] 5. sys.path atualizado: {sys.path}")

    # 2. Definir VERCEL env var explicitamente
    os.environ['VERCEL'] = '1'
    print(f"[DEBUG] 6. os.environ['VERCEL'] definido como: {os.environ.get('VERCEL')}")

    # 3. IMPORTAR O APP FLASK DO BACKEND
    print("[DEBUG] 7. INICIANDO IMPORTAÇÃO DO APP...")
    from app import app as flask_app
    print("[DEBUG] 8. ✅ APP IMPORTADO COM SUCESSO!")

    # 4. Configurar como aplicativo WSGI para Vercel
    # IMPORTANTE: o runtime @vercel/python procura pela variável `app` (WSGI).
    # Mantemos `application` por compatibilidade, mas `app` é o que faz a função
    # iniciar — sem isso o invoker crasha com FUNCTION_INVOCATION_FAILED.
    app = flask_app
    application = flask_app
    print("[DEBUG] 9. ✅ app/application configurado!")
    print("[DEBUG] ========== TUDO OK, VERCEL DEVE FUNCIONAR ==========")

except Exception as e:
    print(f"\n[ERRO CRÍTICO] ========== {type(e).__name__} ==========")
    print(f"[ERRO CRÍTICO] Mensagem: {str(e)}")
    import traceback
    print(f"\n[STACK TRACE COMPLETO]\n{traceback.format_exc()}")
    print("[ERRO CRÍTICO] ========== FIM DO ERRO ==========")

    # Criar um app de fallback MINIMALISTA para não deixar a página vazia
    from flask import Flask, jsonify
    application = Flask(__name__)
    # Exporta também como `app` — esse é o nome que o runtime do Vercel
    # procura para servir requisições WSGI.
    app = application

    @application.route('/')
    def fallback_index():
        return jsonify({
            "status": "error",
            "error_type": type(e).__name__,
            "error_message": str(e),
            "debug_info": {
                "cwd": os.getcwd(),
                "sys_path": sys.path,
                "python_version": sys.version
            }
        }), 500

    @application.route('/<path:path>')
    def fallback_all(path):
        return fallback_index()

