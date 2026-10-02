# MiniDAW: presets que funcionam sem o Supabase (master + por faixa)

**Objetivo:**
- Os presets do master voltam a funcionar com o Supabase bloqueado.
- Nascem os presets por faixa: a cadeia de efeitos de uma voz ou trilha, com nome, aplicada com um clique em qualquer faixa ou projeto.

**Causa do sumiço (02/10/2026):**
- Com o ykswh em 402, `_ler_master_presets()` engolia o erro e o GET respondia `success: true, presets: []`.
- A tela confiava nessa resposta e gravava `[]` por cima da cópia local, então o "Preset 01 – Crato" sumiu da tela.
- O preset continua no banco bloqueado e volta sozinho quando o banco for liberado (a tela mescla).

**Arquitetura:**
- **Novo `static/presets-locais.js`** (UMD, testável em Node). É a fonte da verdade, guardada no navegador (`localStorage['locutores_presets_v1']`).
  - Formato: `{master: [], faixa: [], apagados: {master: {nome: ts}, faixa: {}}}`.
  - Funções puras: `guardar`, `apagar`, `mesclar` (por nome, o `salvo_em` mais novo vence, nome apagado não ressuscita), `exportar` e `importar` (arquivo `.json`, pra backup e pra outra máquina).
  - Migra a chave antiga `minidaw_master_presets`.
- **Master (`master-suite.js` v9):**
  - Lê o local na hora.
  - A nuvem é só bônus: GET com sucesso é mesclado, e o envio é tentado sem travar a tela.
  - Guardar e apagar funcionam sempre; a tela avisa quando a nuvem está fora.
  - Botões Exportar e Importar na barra "Meus presets".
- **Servidor:** GET, POST e DELETE de `/api/master-presets` devolvem erro (503) quando não conseguem ler. Nunca uma lista vazia de mentira, e nunca regravam a nuvem a partir de uma leitura que falhou.
- **Faixa (`minidaw.js` v79):** seletor "Presets" e botões Guardar e Apagar no cartão, ao lado de "Copiar Efeitos".
  - O conteúdo é o mesmo do `_copiarEfeitos`: effects, eq, gate, de-esser, compressor, reverb e delay. Volume, pan e fades ficam de fora.
  - A lista mostra só os presets do mesmo tipo (voz ou trilha).
  - As opções entram por DOM (`textContent`).

**Testes:**
- `tests/presets-locais.test.mjs`: mescla, ressurreição, importar e exportar, migração.
- `tests/test_presets_locais.py`: o servidor não mente, mais as tags e versões nas telas.
