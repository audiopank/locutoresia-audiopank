
import sys
import os

# Adicionar backend ao sys.path
backend_dir = os.path.join(os.path.dirname(__file__), 'backend')
sys.path.insert(0, backend_dir)

print("Testando importação do app.py...")
try:
    from app import app
    print("✅ App importado com sucesso!")
    
    # Tentar rodar o servidor
    print("Iniciando servidor Flask...")
    app.run(host='0.0.0.0', port=5000, debug=True)
except Exception as e:
    print(f"❌ Erro: {type(e).__name__}: {e}")
    import traceback
    print(traceback.format_exc())

