import os
from supabase import create_client
from dotenv import load_dotenv
import json

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(url, key)

def inspect_table(table_name):
    print(f"\n--- Inspecting table: {table_name} ---")
    try:
        # Get one record to see structure
        res = supabase.table(table_name).select("*").limit(1).execute()
        if res.data:
            print(f"Sample record structure ({table_name}):")
            print(json.dumps(res.data[0], indent=2))
            print(f"Columns: {list(res.data[0].keys())}")
        else:
            print(f"Table '{table_name}' is empty. Trying to get columns via another way...")
            # If empty, we might not see all columns if some are null, but it's the best we can do without direct DB access
            print(f"No data found in {table_name}.")
    except Exception as e:
        print(f"Error inspecting {table_name}: {e}")

# Inspect relevant tables
inspect_table("posts")
inspect_table("scheduled_posts")
inspect_table("scheduled_post_attempts")
inspect_table("profiles")

# Check for other relevant tables
try:
    # This might fail depending on permissions/extensions, but worth a try
    # In Supabase, we usually can't list all tables via the client easily without a custom RPC
    pass
except:
    pass
