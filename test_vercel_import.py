# Teste local de importação como Vercel
import sys
import os

os.environ['VERCEL'] = '1'

print("[DEBUG] Iniciando teste de importação Vercel")
print(f"[DEBUG] Diretório atual: {os.getcwd()}")

try:
    # Caminhos absolutos para garantir
    project_root = os.getcwd()
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
    print("[DEBUG] Tudo OK!")

except Exception as e:
    print(f"\n[ERRO CRÍTICO] {type(e).__name__}: {e}")
    import traceback
    print(f"\n[STACK TRACE]\n{traceback.format_exc()}")
