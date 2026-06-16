import os
import requests
from dotenv import load_dotenv

# Carregar variáveis de ambiente
load_dotenv()

api_key = os.getenv('ELEVENLABS_API_KEY')

if not api_key:
    print('ERRO: ELEVENLABS_API_KEY não encontrada!')
    exit(1)

print(f'API Key encontrada: {api_key[:20]}...\n')

headers = {
    'xi-api-key': api_key,
    'Accept': 'application/json'
}

# Listar vozes disponíveis
response = requests.get('https://api.elevenlabs.io/v1/voices', headers=headers, timeout=10)

if response.status_code == 200:
    data = response.json()
    voices = data.get('voices', [])
    
    print(f'VOZES DISPONÍVEIS ({len(voices)}):\n')
    for i, voice in enumerate(voices):
        print(f'{i+1}. ID: {voice.get("voice_id")}')
        print(f'   Nome: {voice.get("name")}')
        print(f'   Categoria: {voice.get("category", "N/A")}')
        print('')
else:
    print(f'ERRO ao listar vozes: {response.status_code}')
    print(f'Resposta: {response.text}')