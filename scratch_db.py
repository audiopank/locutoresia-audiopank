import os
import requests
from dotenv import load_dotenv

load_dotenv(".env.local")
url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_ANON_KEY")

headers = {
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json"
}

with open("scratch_out.txt", "w", encoding="utf-8") as f:
    f.write("=== VERIFICANDO newpost_posts ===\n")
    res = requests.get(f"{url}/rest/v1/newpost_posts?select=*&limit=1", headers=headers)
    if res.status_code == 200:
        data = res.json()
        if data:
            f.write(str(data[0].keys()) + "\n")
        else:
            f.write("Tabela vazia\n")
    else:
        f.write(res.text + "\n")
