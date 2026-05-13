# API handler para Vercel serverless
import sys
import os

# Add backend and core to path
backend_path = os.path.join(os.path.dirname(__file__), '..', 'backend')
core_path = os.path.join(os.path.dirname(__file__), '..', 'core')
sys.path.insert(0, backend_path)
sys.path.insert(0, core_path)

# Import Flask app
from app import app

# Vercel handler
application = app
