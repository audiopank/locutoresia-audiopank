# Vercel entry point
import sys
import os

# Add paths
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'core'))

# Import Flask app from backend
from backend.app import app

# Vercel handler
class Handler:
    def __call__(self, environ, start_response):
        return app(environ, start_response)

handler = Handler()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print("Iniciando Locutores IA Server...")
    print("Acesse: http://localhost:5000")
    print("Dashboard: http://localhost:5000/dashboard")
    app.run(host='0.0.0.0', port=port, debug=True)
