from flask import Flask
import sys

app = Flask(__name__)

@app.route('/')
def hello():
    return "Servidor Flask está funcionando!"

if __name__ == '__main__':
    print("Iniciando servidor Flask...")
    print(f"Python version: {sys.version}")
    try:
        app.run(host='0.0.0.0', port=5000, debug=True)
    except Exception as e:
        print(f"Erro ao iniciar servidor: {e}")
        import traceback
        traceback.print_exc()
