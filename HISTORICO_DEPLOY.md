# 📚 Histórico de Deploy e Implementações - Locutores IA

## Data: 26-27 de Maio de 2026
## Autor: Mestre + Assistente AI

---

## ✅ Resumo Geral das Alterações

### 1. Restauramos o projeto para a versão funcional
- Fizemos `git reset --hard 2701a5b` para voltar à versão que estava funcionando
- Push force para o GitHub
- Vercel fez deploy automático

### 2. Corrigimos o import do supabase_guard
- Arquivo: `backend/app.py:73`
- Mudamos de `from backend.supabase_guard` para `from supabase_guard`

### 3. Implementamos a integração completa com Autores NewPost-IA

---

## 📝 Lista de Arquivos Modificados e Criados

### Arquivos Criados:
1. `templates/newpost-authors.html` - Página de gerenciamento de autores
2. `CREAR_TABELAS_NEWPOST_IA.sql` - SQL para criar tabelas no Supabase
3. `deploy-tudo.bat` - Script de deploy completo
4. `deploy-autores-newpost.bat` - Script de deploy para autores
5. `testar-tudo.bat` - Script para testar localmente
6. `iniciar_servidor.bat` - Script para iniciar servidor
7. `test-server.py` - Script de teste do servidor
8. `deploy-debug.bat` - Deploy com debug
9. `commit-fix.bat` - Commit de correções
10. `HISTORICO_DEPLOY.md` - Este arquivo!

### Arquivos Modificados:
1. `backend/app.py` - Adicionadas rotas e APIs
2. `core/supabase_manager.py` - Auto-criação de perfil
3. `templates/index.html` - Link no sidebar
4. `templates/busca-noticias.html` - Uso do autor selecionado

---

## 🚀 Funcionalidades Implementadas

### 1. Página `/newpost-authors`
- Listagem de todos os perfis do `newpost_profiles`
- Formulário para criar novo autor (nome + e-mail)
- Botão "Selecionar" para definir autor padrão (salvo no `localStorage` como `newpost_selected_author_id`)
- Botão "Copiar ID" para copiar o ID do autor

### 2. Auto-criação de perfil
- Método `_ensure_profile_exists()` no `SupabaseManager`
- Verifica se o `author_id` existe no `newpost_profiles`
- Se não existir, tenta criar automaticamente
- Fallback inteligente: ignora colunas inexistentes para evitar erros
- Mesmo se falhar, tenta publicar o post de qualquer forma

### 3. Rota `/api/news/publish-to-newpost`
- Aceita `author_id` no body para override
- Usa o autor selecionado do localStorage na página de busca-noticias
- Usa o padrão do `.env` se não houver autor selecionado

### 4. Link no Sidebar
- Adicionado "Autores NewPost" na seção "Automação"
- Marcação "NOVO" para destacar

---

## 📊 Tabelas no Supabase (SQL)

Arquivo: `CREAR_TABELAS_NEWPOST_IA.sql`

### Tabela 1: `posts`
- Campos: id, title, content, audio_url, status, source, source_url, author_id, is_ia_generated, created_at, updated_at
- Índices: author_id, status, created_at DESC
- Permissões: authenticated, service_role
- RLS: Usuários só veem/editar/delete seus próprios posts

### Tabela 2: `audio_files`
- Campos: id, post_id (FK para posts.id), filename, public_url, file_type, voice_provider, voice_model, status, created_by, created_at
- Índices: post_id, status
- Permissões: authenticated, service_role
- RLS: Usuários só veem/editar/delete seus próprios arquivos

---

## 🔑 Credenciais e Configurações

### Arquivo `.env` (exemplo):
```
NEWPOST_SUPABASE_URL=https://hzmtdfojctctvgqjdbex.supabase.co
NEWPOST_SUPABASE_SERVICE_KEY=SUA_CHAVE_AQUI
NEWPOST_AUTHOR_ID=3a1a93d0-e451-47a4-a126-f1b7375895eb
```

---

## 🌐 URLs Importantes

- GitHub: https://github.com/eudespankilhas/locutoresia
- Vercel: https://locutoresia-iej7-eudespankilhas-2.vercel.app/
- Página de Autores: /newpost-authors
- Página de Busca de Notícias: /busca-noticias

---

## 📋 Passos para Repetir o Deploy

### 1. Executar SQL no Supabase
- Abrir painel do Supabase NewPost-IA
- Ir para SQL Editor
- Copiar e colar o conteúdo de `CREAR_TABELAS_NEWPOST_IA.sql`
- Clicar em Run (▶️)

### 2. Enviar para GitHub
- Duplo clique em `deploy-autores-newpost.bat`
- Ou manualmente:
  ```bash
  git add -A
  git commit -m "🎉 Autores NewPost-IA + Auto-criação de perfil + Integração completa"
  git push origin main
  ```

### 3. Aguardar Deploy no Vercel
- Vercel detecta automaticamente o push
- Acompanhe no painel do Vercel
- Acesse o site quando o deploy estiver concluído

---

## 🔧 Troubleshooting Comum

### Erro: "Invalid API key"
- Verifique se está usando `NEWPOST_SUPABASE_SERVICE_KEY` (não ANON_KEY!)
- Confira a chave no arquivo `.env`

### Erro: "This Serverless Function has crashed"
- Verifique os logs no Vercel (aba Functions ou Runtime Logs)
- Confira os imports no `app.py`

### Erro na Publicação
- Verifique se as tabelas `posts` e `newpost_profiles` existem no Supabase
- Execute o SQL `CREAR_TABELAS_NEWPOST_IA.sql`
- Confira o `author_id` selecionado

---

## ✅ Funcionalidades Concluídas (Checklist)

- [x] Restaurar projeto para versão funcional
- [x] Corrigir import do supabase_guard
- [x] Criar página newpost-authors.html
- [x] Adicionar rota /newpost-authors no app.py
- [x] Adicionar APIs /api/newpost/authors (GET e POST)
- [x] Implementar auto-criação de perfil no SupabaseManager
- [x] Atualizar publish_to_newpost para aceitar author_id
- [x] Adicionar link no sidebar do index.html
- [x] Atualizar busca-noticias.html para usar autor selecionado
- [x] Criar scripts de deploy
- [x] Criar arquivo de histórico (este!)

---

## 📞 Contato e Suporte

Se precisar de ajustes, é só chamar! 🎯

---
*Documentação criada em 27/05/2026 - Mestre & Assistente AI*
