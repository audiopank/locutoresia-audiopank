
import os
import io

# Carregar env vars
from dotenv import load_dotenv
load_dotenv()

try:
    from google import genai
    from google.genai import types
    print("Google GenAI imported")
except Exception as e:
    print(f"Error importing google genai: {e}")
    exit(1)

API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    print("No GEMINI_API_KEY found!")
    exit(1)

print("Initializing client...")
client = genai.Client(api_key=API_KEY)

MODEL = "gemini-2.0-flash-exp"  # Test model
TEXT = "Olá, isso é um teste de voz!"

print("Trying to generate audio...")
try:
    config = types.GenerateContentConfig(
        temperature=1.0,
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name="Zephyr"
                )
            )
        ),
    )

    response = client.models.generate_content(
        model=MODEL,
        contents=TEXT,
        config=config,
    )

    print("Response received!")
    print(f"Candidates: {response.candidates}")
    if response.candidates:
        candidate = response.candidates[0]
        print(f"Content: {candidate.content}")
        if candidate.content and candidate.content.parts:
            for part in candidate.content.parts:
                print(f"Part: {part}")
                if part.inline_data:
                    print("Found audio!")
                    with open("test.wav", "wb") as f:
                        f.write(part.inline_data.data)
                    print("Saved test.wav")
except Exception as e:
    print(f"Error: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()

print("Done!")
