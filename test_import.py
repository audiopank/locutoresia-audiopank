import sys
import os

print("=== Testando importação ===")
print(f"cwd: {os.getcwd()}")

# Configurar caminhos
project_root = os.path.dirname(os.path.abspath(__file__))
backend_path = os.path.join(project_root, 'backend')
api_path = os.path.join(project_root, 'api')

sys.path.insert(0, backend_path)
sys.path.insert(0, api_path)
sys.path.insert(0, project_root)

print(f"sys.path: {sys.path}")

try:
    print("\n1. Importando app do backend...")
    from app import app
    print("✅ OK: app importado com sucesso!")
except Exception as e:
    print(f"❌ ERRO: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()

try:
    print("\n2. Importando index da api...")
    from index import app as api_app
    print("✅ OK: api/index.py importado com sucesso!")
except Exception as e:
    print(f"❌ ERRO: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
