import os
import sys
from pathlib import Path

# Importar o gerador
try:
    from tts_generator import TTSGenerator, get_tts_generator
except ImportError:
    print("❌ Erro: tts_generator.py não encontrado")
    print("   Verifique se o arquivo está no mesmo diretório")
    sys.exit(1)


# ============================================================================
# TESTES
# ============================================================================

def test_inicializacao():
    """Teste 1: Inicializar o gerador."""
    print("\n" + "=" * 70)
    print("TESTE 1: Inicialização")
    print("=" * 70)
    
    try:
        generator = get_tts_generator()
        print("✓ Gerador inicializado com sucesso")
        return True
    except ValueError as e:
        print(f"✗ Erro: {e}")
        return False
    except Exception as e:
        print(f"✗ Erro inesperado: {e}")
        return False


def test_audio_basico():
    """Teste 2: Gerar áudio básico."""
    print("\n" + "=" * 70)
    print("TESTE 2: Geração Básica de Áudio")
    print("=" * 70)
    
    try:
        generator = get_tts_generator()
        
        text = "Olá! Este é um teste de síntese de voz."
        print(f"\nTexto: '{text}'")
        
        audio = generator.generate_speech(text)
        
        if not audio:
            print("✗ Nenhum áudio foi gerado")
            return False
        
        print(f"✓ Áudio gerado com sucesso")
        print(f"  Tamanho: {len(audio)} bytes")
        
        # Salvar arquivo de teste
        output_file = Path("teste_basico.wav")
        with open(output_file, "wb") as f:
            f.write(audio)
        print(f"  Salvo: {output_file}")
        
        return True
        
    except Exception as e:
        print(f"✗ Erro: {e}")
        return False


def test_vozes():
    """Teste 3: Testar diferentes vozes."""
    print("\n" + "=" * 70)
    print("TESTE 3: Diferentes Vozes")
    print("=" * 70)
    
    try:
        generator = get_tts_generator()
        
        vozes = ["Zephyr", "Leda", "Charon"]
        texto = "Teste de voz"
        
        print(f"\nGerando áudio em {len(vozes)} vozes...")
        
        resultados = []
        for voz in vozes:
            try:
                print(f"\n  📢 {voz}...", end=" ", flush=True)
                
                audio = generator.generate_speech(
                    text=texto,
                    voice_model=voz
                )
                
                if not audio:
                    print("✗ Nenhum áudio")
                    resultados.append((voz, False))
                    continue
                
                # Salvar
                output_file = Path(f"teste_voz_{voz.lower()}.wav")
                with open(output_file, "wb") as f:
                    f.write(audio)
                
                print(f"✓ ({len(audio)} bytes)")
                resultados.append((voz, True))
                
            except Exception as e:
                print(f"✗ Erro: {e}")
                resultados.append((voz, False))
        
        # Resumo
        sucesso = sum(1 for _, ok in resultados if ok)
        print(f"\n✓ {sucesso}/{len(vozes)} vozes geradas com sucesso")
        
        return sucesso == len(vozes)
        
    except Exception as e:
        print(f"✗ Erro: {e}")
        return False


def test_estilos():
    """Teste 4: Testar diferentes estilos."""
    print("\n" + "=" * 70)
    print("TESTE 4: Diferentes Estilos")
    print("=" * 70)
    
    try:
        generator = get_tts_generator()
        
        estilos = ["normal", "fast", "slow", "cheerful", "serious"]
        texto = "Teste de estilo"
        
        print(f"\nGerando áudio em {len(estilos)} estilos...")
        
        resultados = []
        for estilo in estilos:
            try:
                print(f"\n  🎨 {estilo}...", end=" ", flush=True)
                
                audio = generator.generate_speech(
                    text=texto,
                    voice_model="Zephyr",
                    style=estilo
                )
                
                if not audio:
                    print("✗ Nenhum áudio")
                    resultados.append((estilo, False))
                    continue
                
                # Salvar
                output_file = Path(f"teste_estilo_{estilo}.wav")
                with open(output_file, "wb") as f:
                    f.write(audio)
                
                print(f"✓ ({len(audio)} bytes)")
                resultados.append((estilo, True))
                
            except Exception as e:
                print(f"✗ Erro: {e}")
                resultados.append((estilo, False))
        
        # Resumo
        sucesso = sum(1 for _, ok in resultados if ok)
        print(f"\n✓ {sucesso}/{len(estilos)} estilos geraram áudio com sucesso")
        
        return sucesso == len(estilos)
        
    except Exception as e:
        print(f"✗ Erro: {e}")
        return False


def test_idiomas():
    """Teste 5: Testar diferentes idiomas."""
    print("\n" + "=" * 70)
    print("TESTE 5: Diferentes Idiomas")
    print("=" * 70)
    
    try:
        generator = get_tts_generator()
        
        textos_por_idioma = {
            "pt-BR": "Olá mundo! Este é um teste em português.",
            "en-US": "Hello world! This is a test in English.",
            "es-ES": "¡Hola mundo! Esta es una prueba en español.",
        }
        
        print(f"\nGerando áudio em {len(textos_por_idioma)} idiomas...")
        
        resultados = []
        for idioma, texto in textos_por_idioma.items():
            try:
                print(f"\n  🌍 {idioma}...", end=" ", flush=True)
                
                audio = generator.generate_speech(
                    text=texto,
                    voice_model="Zephyr",
                    language=idioma
                )
                
                if not audio:
                    print("✗ Nenhum áudio")
                    resultados.append((idioma, False))
                    continue
                
                # Salvar
                output_file = Path(f"teste_idioma_{idioma.replace('-', '_')}.wav")
                with open(output_file, "wb") as f:
                    f.write(audio)
                
                print(f"✓ ({len(audio)} bytes)")
                resultados.append((idioma, True))
                
            except Exception as e:
                print(f"✗ Erro: {e}")
                resultados.append((idioma, False))
        
        # Resumo
        sucesso = sum(1 for _, ok in resultados if ok)
        print(f"\n✓ {sucesso}/{len(textos_por_idioma)} idiomas geraram áudio com sucesso")
        
        return sucesso == len(textos_por_idioma)
        
    except Exception as e:
        print(f"✗ Erro: {e}")
        return False


def test_texto_vazio():
    """Teste 6: Validação de texto vazio."""
    print("\n" + "=" * 70)
    print("TESTE 6: Validação de Texto Vazio")
    print("=" * 70)
    
    try:
        generator = get_tts_generator()
        
        print("\nTentando gerar áudio com texto vazio...")
        
        try:
            audio = generator.generate_speech("")
            print("✗ Deveria ter lançado exceção para texto vazio")
            return False
        except ValueError as e:
            print(f"✓ Exceção capturada corretamente: {e}")
            return True
        
    except Exception as e:
        print(f"✗ Erro inesperado: {e}")
        return False


def test_qualidade_wav():
    """Teste 7: Validar qualidade do arquivo WAV."""
    print("\n" + "=" * 70)
    print("TESTE 7: Qualidade do Arquivo WAV")
    print("=" * 70)
    
    try:
        generator = get_tts_generator()
        
        audio = generator.generate_speech("Teste de qualidade")
        
        if len(audio) < 44:
            print(f"✗ Arquivo WAV muito pequeno: {len(audio)} bytes (mínimo 44)")
            return False
        
        # Validar header WAV
        if audio[:4] != b"RIFF":
            print("✗ Header RIFF inválido")
            return False
        
        if audio[8:12] != b"WAVE":
            print("✗ Header WAVE inválido")
            return False
        
        print(f"✓ Arquivo WAV válido")
        print(f"  Tamanho: {len(audio)} bytes")
        print(f"  Header RIFF: {audio[:4]}")
        print(f"  Header WAVE: {audio[8:12]}")
        
        return True
        
    except Exception as e:
        print(f"✗ Erro: {e}")
        return False


# ============================================================================
# EXECUTAR TESTES
# ============================================================================

def main():
    """Executar todos os testes."""
    print("\n" + "=" * 70)
    print("🧪 TESTES DO NOVO GERADOR TTS")
    print("=" * 70)
    
    # Verificar API Key
    print("\nVerificando API Key...")
    if not os.environ.get("GEMINI_API_KEY"):
        print("⚠️  GEMINI_API_KEY não configurada")
        print("   Configure com: export GEMINI_API_KEY='sua-chave'")
        print("   Ou passe ao inicializar: TTSGenerator(api_key='sua-chave')")
        print("\nContinuando (pode falhar)...\n")
    else:
        print("✓ GEMINI_API_KEY encontrada\n")
    
    # Executar testes
    testes = [
        ("Inicialização", test_inicializacao),
        ("Áudio Básico", test_audio_basico),
        ("Vozes Diferentes", test_vozes),
        ("Estilos Diferentes", test_estilos),
        ("Idiomas Diferentes", test_idiomas),
        ("Texto Vazio", test_texto_vazio),
        ("Qualidade WAV", test_qualidade_wav),
    ]
    
    resultados = []
    for nome, teste in testes:
        try:
            resultado = teste()
            resultados.append((nome, resultado))
        except KeyboardInterrupt:
            print("\n\n✗ Interrompido pelo usuário")
            break
        except Exception as e:
            print(f"\n✗ Erro não tratado: {e}")
            resultados.append((nome, False))
    
    # Resumo Final
    print("\n" + "=" * 70)
    print("📊 RESUMO DOS TESTES")
    print("=" * 70)
    
    for nome, resultado in resultados:
        status = "✓ PASSOU" if resultado else "✗ FALHOU"
        print(f"  {status}: {nome}")
    
    total = len(resultados)
    sucessos = sum(1 for _, ok in resultados if ok)
    porcentagem = (sucessos / total * 100) if total > 0 else 0
    
    print(f"\nResultado: {sucessos}/{total} testes passaram ({porcentagem:.0f}%)")
    
    if sucessos == total:
        print("\n🎉 TODOS OS TESTES PASSARAM!")
        return 0
    else:
        print("\n⚠️  ALGUNS TESTES FALHARAM")
        return 1


if __name__ == "__main__":
    try:
        exit_code = main()
        sys.exit(exit_code)
    except Exception as e:
        print(f"\n✗ Erro fatal: {e}")
        sys.exit(1)