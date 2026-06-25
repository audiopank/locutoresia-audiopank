import sys
import os

# Força UTF-8 no stdout/stderr para não quebrar no console do Windows (cp1252),
# que não codifica caracteres como ✓/✗ usados nos prints de status.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

print(f"Python executable: {sys.executable}")
print(f"Current directory: {os.getcwd()}")

try:
    from flask import Flask
    print("✓ Flask imported successfully")
    
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))
    print("✓ Added backend to path")
    
    from backend.app import app
    print("✓ App imported successfully")
    
    print("\nStarting server on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=False)
except Exception as e:
    print(f"\n✗ Error: {e}")
    import traceback
    traceback.print_exc()
    input("\nPress Enter to exit...")
