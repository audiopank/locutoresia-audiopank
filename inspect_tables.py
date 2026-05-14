import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_KEY")

supabase = create_client(url, key)

try:
    res = supabase.table('group_posts').select('*').limit(1).execute()
    if res.data:
        print(f"Columns in group_posts: {list(res.data[0].keys())}")
    else:
        print("group_posts is empty")
except Exception as e:
    print(f"Error checking group_posts: {e}")

try:
    res = supabase.table('posts').select('*').limit(1).execute()
    if res.data:
        print(f"Columns in posts: {list(res.data[0].keys())}")
    else:
        print("posts is empty")
except Exception as e:
    print(f"Error checking posts: {e}")
