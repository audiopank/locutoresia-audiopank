
import os
import sys
from dotenv import load_dotenv

load_dotenv()

core_dir = os.path.join(os.path.dirname(__file__), 'core')
sys.path.insert(0, core_dir)

print("Importing TTSGenerator...")
try:
    from tts_generator import TTSGenerator
    print("OK: TTSGenerator imported!")
    
    print("\nInitializing TTSGenerator...")
    tts = TTSGenerator()
    print("OK: TTSGenerator initialized!")
    
    test_text = "Ola! Este e um teste do core do Locutores IA!"
    
    print("\nTesting Google Gemini...")
    try:
        audio = tts.generate_speech(
            text=test_text,
            voice_model="Zephyr",
            style="normal",
            language="pt-BR",
            api="google"
        )
        
        print(f"OK: Audio generated! ({len(audio)} bytes)")
        
        with open("test_core_google.wav", "wb") as f:
            f.write(audio)
        print("OK: File test_core_google.wav saved!")
        
    except Exception as e:
        print(f"ERROR with Google: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        
except Exception as e:
    print(f"ERROR: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
