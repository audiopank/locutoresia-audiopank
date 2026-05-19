"""
Script para deploy manual na Vercel usando CLI
"""

import subprocess
import os

def deploy_vercel_manual():
    """Faz deploy manual na Vercel"""
    
    print("=== DEPLOY MANUAL NA VERCEL ===")
    print()
    
    try:
        # Verificar se Vercel CLI está instalado
        print("1. Verificando Vercel CLI...")
        result = subprocess.run(['vercel', '--version'], capture_output=True, text=True)
        if result.returncode != 0:
            print("Vercel CLI não encontrada. Instalando...")
            subprocess.run(['npm', 'install', '-g', 'vercel'], check=True)
        
        print(f"Vercel CLI versão: {result.stdout.strip()}")
        
        # Fazer deploy
        print("\n2. Fazendo deploy...")
        print("Isso pode levar alguns minutos...")
        
        # Configurar variáveis de ambiente para o deploy
        env = os.environ.copy()
        env['LMNT_API_KEY'] = 'ak_AbZv3CzqvsHjHxRFj4oL9h'
        
        # Executar deploy
        result = subprocess.run(['vercel', '--prod'], env=env, capture_output=True, text=True)
        
        if result.returncode == 0:
            print("\n=== DEPLOY REALIZADO COM SUCESSO! ===")
            print("URL: https://locutoresia-iej7.vercel.app/")
            print("\nAguarde 2-3 minutos para o deploy completar.")
            print("Depois teste os endpoints:")
            print("- https://locutoresia-iej7.vercel.app/api/test-env")
            print("- https://locutoresia-iej7.vercel.app/api/lmnt/status")
            print("- https://locutoresia-iej7.vercel.app/api/lmnt/voices")
        else:
            print(f"\nERRO NO DEPLOY: {result.stderr}")
            
    except Exception as e:
        print(f"ERRO: {e}")
        print("\nTENTE FAZER MANUALMENTE:")
        print("1. Abra o terminal")
        print("2. Execute: vercel --prod")
        print("3. Configure as variáveis de ambiente quando solicitado")

if __name__ == "__main__":
    deploy_vercel_manual()
