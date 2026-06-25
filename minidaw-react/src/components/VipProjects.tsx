import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Star, X, FolderOpen, Trash2, Save, Loader2, Music2 } from "lucide-react";
import { useToast } from "@/hooks/useToast";

export interface ProjectSnapshot {
  projectId: string;
  roteiro: string;
  tracks: any[];
}

interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
  tracks_count?: number;
  updated_at?: string;
}

interface VipProjectsProps {
  open: boolean;
  onClose: () => void;
  getCurrent: () => ProjectSnapshot;
  onLoad: (snap: ProjectSnapshot) => void;
}

export const VipProjects = ({ open, onClose, getCurrent, onLoad }: VipProjectsProps) => {
  const { toast } = useToast();
  const [list, setList] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      setList(data.projects || []);
    } catch {
      toast({ title: "Erro ao carregar projetos", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      toast({ title: "Nome obrigatório", description: "Dê um nome ao projeto VIP.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const snap = getCurrent();
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, ...snap }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Falha ao salvar");
      toast({ title: "⭐ Projeto VIP salvo!", description: name });
      setName("");
      setDescription("");
      refresh();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const openProject = async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${id}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Falha ao abrir");
      const p = data.project;
      onLoad({ projectId: p.projectId || "", roteiro: p.roteiro || "", tracks: p.tracks || [] });
      toast({ title: "Projeto aberto", description: p.name });
      onClose();
    } catch (e: any) {
      toast({ title: "Erro ao abrir", description: e.message, variant: "destructive" });
    }
  };

  const remove = async (id: string) => {
    try {
      await fetch(`/api/projects/${id}`, { method: "DELETE" });
      refresh();
    } catch {
      toast({ title: "Erro ao excluir", variant: "destructive" });
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <Card className="w-full max-w-3xl my-6 bg-slate-900 border border-white/10 shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between p-5 border-b border-white/10 bg-slate-900/95 backdrop-blur">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-500" /> Projetos VIP
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-white/60 hover:text-white hover:bg-white/10">
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {/* Salvar projeto atual */}
          <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
            <h3 className="text-sm font-semibold text-purple-300">Salvar projeto atual</h3>
            <div className="grid md:grid-cols-2 gap-3">
              <Input placeholder="Nome do projeto (ex: Spot Black Friday)" value={name} onChange={(e) => setName(e.target.value)} className="bg-white/10 border-white/20 text-white placeholder-white/40" />
              <Input placeholder="Descrição (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} className="bg-white/10 border-white/20 text-white placeholder-white/40" />
            </div>
            <div className="flex justify-end">
              <Button onClick={save} disabled={saving} className="gap-2 bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-600 hover:to-amber-700 text-black font-medium">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar VIP
              </Button>
            </div>
          </div>

          {/* Lista de projetos */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-purple-300">Projetos salvos</h3>
            {loading ? (
              <div className="flex items-center gap-2 text-white/60 py-6 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Carregando...</div>
            ) : list.length === 0 ? (
              <p className="text-white/50 text-sm py-6 text-center">Nenhum projeto salvo ainda.</p>
            ) : (
              <div className="space-y-2">
                {list.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                    <div className="min-w-0">
                      <div className="font-medium text-white truncate">{p.name}</div>
                      <div className="text-xs text-white/50 flex items-center gap-2">
                        <Music2 className="w-3 h-3" /> {p.tracks_count || 0} faixa(s)
                        {p.description ? <span className="truncate">· {p.description}</span> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button onClick={() => openProject(p.id)} size="sm" className="gap-1 bg-blue-600 hover:bg-blue-700">
                        <FolderOpen className="w-4 h-4" /> Abrir
                      </Button>
                      <Button onClick={() => remove(p.id)} size="icon" variant="ghost" className="text-white/50 hover:text-red-400 hover:bg-red-500/10">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-white/40">
            As vozes geradas pelo servidor são reabertas normalmente. Áudios enviados por upload podem precisar de novo upload ao reabrir.
          </p>
        </div>
      </Card>
    </div>,
    document.body
  );
};

export default VipProjects;
