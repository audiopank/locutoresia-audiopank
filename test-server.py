#!/usr/bin/env python
import sys
import os

print("="*50)
print("TESTE DE INICIALIZAÇÃO DO SERVIDOR")
print("="*50)
print()

try:
    print("1. Adicionando caminhos ao sys.path...")
    backend_path = os.path.join(os.path.dirname(__file__), 'backend')
    sys.path.insert(0, backend_path)
    print(f"   ✓ {backend_path}")
    
    print()
    print("2. Tentando importar o app...")
    from app import app
    print("   ✓ App importado com sucesso!")
    
    print()
    print("3. Verificando configurações do app...")
    print(f"   ✓ Template folder: {app.template_folder}")
    print(f"   ✓ Static folder: {app.static_folder}")
    print(f"   ✓ Templates existe? {os.path.exists(app.template_folder)}")
    print(f"   ✓ Static existe? {os.path.exists(app.static_folder)}")
    
    print()
    print("="*50)
    print("TUDO CERTO! Iniciando servidor...")
    print("="*50)
    print()
    print("Acesse: http://localhost:5000")
    print()
    app.run(host='0.0.0.0', port=5000, debug=True)
    
except Exception as e:
    print()
    print("="*50)
    print(f"ERRO: {type(e).__name__}")
    print("="*50)
    print(f"Mensagem: {e}")
    print()
    import traceback
    print("Stack trace:")
    print(traceback.format_exc())
    print()
    input("Pressione Enter para sair...")
