import React, { useState } from 'react';
import {
  Search, Plus, AlertCircle, RefreshCw, ExternalLink, Rss,
  CheckCircle2, Loader2, Sparkles, Pencil, Copy, Check, X, Save
} from 'lucide-react';

// URL da backend function (busca RSS + entrega via webhook)
const API_URL = 'https://new-post-ia-5dac1009.base44.app/functions/fetchRssNews';

// Webhook direto como fallback (caso o fluxo automático falhe)
const WEBHOOK_URL = 'https://new-post-ia-5dac1009.base44.app/functions/receiveNews';

const categories = [
  { id: 'tecnologia',     label: '💻 Tecnologia',     color: 'bg-blue-600' },
  { id: 'economia',       label: '📊 Economia',        color: 'bg-green-600' },
  { id: 'esportes',       label: '⚽ Esportes',        color: 'bg-yellow-600' },
  { id: 'politica',       label: '🏛️ Política',       color: 'bg-red-600' },
  { id: 'saude',          label: '🏥 Saúde',           color: 'bg-pink-600' },
  { id: 'ciencia',        label: '🔬 Ciência',         color: 'bg-cyan-600' },
  { id: 'entretenimento', label: '🎭 Entretenimento',  color: 'bg-orange-600' },
  { id: 'cultura',        label: '🎨 Cultura',         color: 'bg-indigo-600' },
  { id: 'geral',          label: '📰 Geral',           color: 'bg-gray-600' },
];

export default function BuscaNoticias() {
  const [selectedCategory, setSelectedCategory] = useState('tecnologia');
  const [posts, setPosts]           = useState([]);
  const [loading, setLoading]       = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishingAll, setPublishingAll] = useState(false);
  const [publishedIds, setPublishedIds]   = useState(new Set());
  const [sourceInfo, setSourceInfo] = useState(null);
  const [copied, setCopied]         = useState(false);

  // Edição inline
  const [editingPost, setEditingPost]       = useState(null); // post sendo editado
  const [editTitle, setEditTitle]           = useState('');
  const [editContent, setEditContent]       = useState('');

  // ── Buscar notícias via RSS ──────────────────────────────
  const fetchNews = async () => {
    setLoading(true);
    setPosts([]);
    setSelectedPost(null);
    setPublishedIds(new Set());
    setSourceInfo(null);
    setEditingPost(null);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: selectedCategory, deliver: false }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPosts(data.posts || []);
      setSelectedPost(data.posts?.[0] || null);
      setSourceInfo({ total: data.total, source: data.source });
    } catch (err) {
      alert('Erro ao buscar notícias: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Publicar via webhook (fluxo principal) ───────────────
  const sendViaWebhook = async (postsList) => {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ posts: postsList }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  };

  const publishPost = async (post) => {
    setPublishing(true);
    try {
      await sendViaWebhook([post]);
      setPublishedIds(prev => new Set([...prev, post.source_url || post.title]));
      alert('✅ Post publicado com sucesso na NewPost-IA!');
    } catch (err) {
      alert('Erro ao publicar: ' + err.message);
    } finally {
      setPublishing(false);
    }
  };

  const publishAllPosts = async () => {
    const pending = posts.filter(p => !isPublished(p));
    if (!pending.length) return;
    if (!window.confirm(`Publicar ${pending.length} posts na NewPost-IA?`)) return;
    setPublishingAll(true);
    try {
      const result = await sendViaWebhook(pending);
      const newSet = new Set(publishedIds);
      pending.forEach(p => newSet.add(p.source_url || p.title));
      setPublishedIds(newSet);
      alert(`✅ ${result.inserted ?? pending.length} posts publicados! (${result.skipped ?? 0} ignorados por duplicata)`);
    } catch (err) {
      alert('Erro ao publicar em lote: ' + err.message);
    } finally {
      setPublishingAll(false);
    }
  };

  // ── Copiar texto para área de transferência ──────────────
  const copyPost = async (post) => {
    const text = `${post.title}\n\n${post.content}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('Não foi possível copiar. Selecione o texto manualmente.');
    }
  };

  // ── Edição inline ────────────────────────────────────────
  const startEdit = (post) => {
    setEditingPost(post);
    setEditTitle(post.title);
    setEditContent(post.content);
  };

  const saveEdit = () => {
    if (!editingPost) return;
    const updated = { ...editingPost, title: editTitle, content: editContent };
    const newPosts = posts.map(p => (p === editingPost ? updated : p));
    setPosts(newPosts);
    if (selectedPost === editingPost) setSelectedPost(updated);
    setEditingPost(null);
  };

  const cancelEdit = () => setEditingPost(null);

  const isPublished = (post) => publishedIds.has(post.source_url || post.title);

  const displayPost = editingPost && selectedPost === editingPost
    ? { ...selectedPost, title: editTitle, content: editContent }
    : selectedPost;

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="bg-gradient-to-r from-purple-900 to-purple-700 border-b border-purple-800 py-6 px-8">
        <div className="flex items-center gap-4">
          <a href="/" className="text-purple-200 hover:text-white transition text-sm">← Início</a>
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Rss className="w-8 h-8" /> Busca de Notícias + IA
            </h1>
            <p className="text-purple-200 mt-1">Coleta notícias reais via RSS · Edite · Publique na NewPost-IA</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-10">

        {/* Fontes */}
        <div className="mb-6 bg-purple-900/20 border border-purple-800 rounded-lg p-4 flex items-start gap-3">
          <Rss className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-white">Fontes RSS Integradas</p>
            <p className="text-xs text-gray-400 mt-1">TecMundo · CanalTech · InfoMoney · UOL · Folha · GE Globo · Agência Brasil · Lance!</p>
          </div>
        </div>

        {/* Categorias */}
        <div className="mb-8">
          <label className="block text-white font-semibold mb-3">Categoria</label>
          <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setSelectedCategory(cat.id)}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition ${
                  selectedCategory === cat.id ? `${cat.color} text-white ring-2 ring-white/30` : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}>
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Botões principais */}
        <div className="flex gap-3 mb-6 flex-wrap">
          <button onClick={fetchNews} disabled={loading}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-semibold transition">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
            {loading ? 'Buscando...' : 'Buscar Notícias Reais'}
          </button>
          {posts.length > 0 && (
            <button onClick={publishAllPosts} disabled={publishingAll || publishedIds.size === posts.length}
              className="flex items-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-semibold transition">
              {publishingAll ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
              {publishingAll ? 'Publicando...' : `Publicar Todos (${posts.length - publishedIds.size})`}
            </button>
          )}
        </div>

        {/* Status */}
        {sourceInfo && (
          <div className="mb-6 flex items-center gap-2 text-sm text-gray-400">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <span>{sourceInfo.total} notícia(s) — {sourceInfo.source === 'rss' ? '📡 RSS em tempo real' : '📦 base local'}</span>
          </div>
        )}

        {/* Grid principal */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Lista lateral */}
          <div className="lg:col-span-1">
            <h3 className="text-white font-bold mb-4 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-purple-400" /> Posts ({posts.length})
            </h3>
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {posts.length === 0 ? (
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 text-center">
                  <Rss className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400 text-sm">Selecione a categoria e clique em "Buscar Notícias Reais"</p>
                </div>
              ) : posts.map((post, idx) => (
                <button key={idx} onClick={() => { setSelectedPost(post); setEditingPost(null); }}
                  className={`w-full text-left p-3 rounded-lg border transition relative ${
                    selectedPost === post ? 'bg-purple-800/40 border-purple-500' : 'bg-gray-900 border-gray-800 hover:border-purple-500'
                  }`}>
                  {isPublished(post) && (
                    <span className="absolute top-2 right-2"><CheckCircle2 className="w-4 h-4 text-green-400" /></span>
                  )}
                  <p className="text-xs font-medium text-white leading-tight pr-5 line-clamp-2">{post.title}</p>
                  <p className="text-xs text-purple-400 mt-1">{post.tags?.[0] ? `#${post.tags[0]}` : post.category}</p>
                  {post.pubDate && <p className="text-xs text-gray-600 mt-0.5 truncate">{post.pubDate.substring(0,16)}</p>}
                </button>
              ))}
            </div>
          </div>

          {/* Prévia / Editor */}
          <div className="lg:col-span-2">
            {displayPost ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">

                {/* Barra de ações do post */}
                <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between gap-2">
                  <h3 className="text-white font-bold">
                    {editingPost ? '✏️ Editando Post' : 'Prévia do Post'}
                  </h3>
                  <div className="flex items-center gap-2">
                    {/* Copiar */}
                    {!editingPost && (
                      <button onClick={() => copyPost(displayPost)}
                        title="Copiar texto do post"
                        className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs px-3 py-1.5 rounded-lg transition">
                        {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? 'Copiado!' : 'Copiar'}
                      </button>
                    )}
                    {/* Editar / Salvar / Cancelar */}
                    {!editingPost ? (
                      <button onClick={() => startEdit(selectedPost)}
                        title="Editar texto do post"
                        className="flex items-center gap-1.5 bg-yellow-700 hover:bg-yellow-600 text-white text-xs px-3 py-1.5 rounded-lg transition">
                        <Pencil className="w-3.5 h-3.5" /> Editar
                      </button>
                    ) : (
                      <>
                        <button onClick={saveEdit}
                          className="flex items-center gap-1.5 bg-green-700 hover:bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg transition">
                          <Save className="w-3.5 h-3.5" /> Salvar
                        </button>
                        <button onClick={cancelEdit}
                          className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1.5 rounded-lg transition">
                          <X className="w-3.5 h-3.5" /> Cancelar
                        </button>
                      </>
                    )}
                    {isPublished(displayPost) && (
                      <span className="flex items-center gap-1 text-green-400 text-xs font-medium">
                        <CheckCircle2 className="w-4 h-4" /> Publicado
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-6">
                  {/* Modo edição */}
                  {editingPost ? (
                    <div className="space-y-4 mb-5">
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block font-medium">Título</label>
                        <input
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm focus:border-purple-500 focus:outline-none"
                          placeholder="Título da notícia..."
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block font-medium">Conteúdo do Post</label>
                        <textarea
                          value={editContent}
                          onChange={e => setEditContent(e.target.value)}
                          rows={10}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-sm focus:border-purple-500 focus:outline-none resize-none font-mono leading-relaxed"
                          placeholder="Conteúdo do post..."
                        />
                        <p className="text-xs text-gray-600 mt-1">{editContent.length} caracteres</p>
                      </div>
                      <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg p-3">
                        <p className="text-xs text-yellow-400">⚠️ Revise o texto para eliminar alucinações da IA antes de publicar.</p>
                      </div>
                    </div>
                  ) : (
                    /* Modo prévia */
                    <div className="bg-gray-800 rounded-xl p-5 mb-5">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center text-white font-bold text-sm">NP</div>
                        <div>
                          <p className="font-semibold text-white">NewPost-IA</p>
                          <p className="text-xs text-gray-400">{new Date().toLocaleDateString('pt-BR')} · pankilhas@gmail.com</p>
                        </div>
                        <span className="ml-auto text-xs bg-purple-700 text-purple-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Sparkles className="w-3 h-3" /> IA
                        </span>
                      </div>
                      <p className="text-white font-semibold mb-3 leading-snug">{displayPost.title}</p>
                      <pre className="text-gray-100 text-sm mb-4 leading-relaxed whitespace-pre-wrap font-sans">{displayPost.content}</pre>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {displayPost.tags?.map((tag, i) => (
                          <span key={i} className="text-purple-400 text-xs">#{tag}</span>
                        ))}
                      </div>
                      {displayPost.source_url && (
                        <a href={displayPost.source_url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition">
                          <ExternalLink className="w-3 h-3" /> Ver fonte original
                        </a>
                      )}
                      <div className="mt-4 pt-3 border-t border-gray-700 text-xs text-gray-500 flex gap-4">
                        <span>💬 Comentar</span><span>❤️ Curtir</span><span>🔄 Repostar</span><span>📤 Compartilhar</span>
                      </div>
                    </div>
                  )}

                  {/* Info destino */}
                  <div className="bg-purple-900/20 border border-purple-800 rounded-lg p-4 mb-5">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-white">Destino da publicação</p>
                        <p className="text-xs text-gray-400 mt-1">
                          Edge Function <code className="text-purple-300">receive-news</code> →
                          Supabase <code className="text-purple-300">hzmtdfojctctvgqjdbex</code>
                          <br/>status: <strong className="text-green-400">published</strong> · is_ia_generated: <strong className="text-blue-400">true</strong>
                        </p>
                        <p className="text-xs text-gray-500 mt-2">
                          💡 Plano B: use o botão <strong className="text-yellow-400">Copiar</strong> e cole manualmente na NewPost-IA.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Botão publicar */}
                  <button
                    onClick={() => publishPost(editingPost ? {...selectedPost, title: editTitle, content: editContent} : selectedPost)}
                    disabled={publishing || isPublished(displayPost)}
                    className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-semibold transition">
                    {publishing ? <Loader2 className="w-5 h-5 animate-spin" />
                      : isPublished(displayPost) ? <CheckCircle2 className="w-5 h-5" />
                      : <Plus className="w-5 h-5" />}
                    {publishing ? 'Publicando...' : isPublished(displayPost) ? 'Já publicado!' : 'Publicar na NewPost-IA'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
                <Rss className="w-14 h-14 text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400 text-lg font-medium">Busque notícias reais</p>
                <p className="text-gray-600 text-sm mt-2">Selecione a categoria e clique em "Buscar Notícias Reais"</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
