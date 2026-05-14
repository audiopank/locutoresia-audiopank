import os
import sys
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_KEY")

print(f"Checking project: {url}")
supabase = create_client(url, key)

tables = ['posts', 'newpost_posts', 'social_posts', 'group_posts', 'publications']

for table in tables:
    try:
        res = supabase.table(table).select('*').limit(1).execute()
        print(f"[OK] {table} exists")
    except Exception as e:
        print(f"[ERROR] {table}: {e}")
