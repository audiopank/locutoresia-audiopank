// minidaw-react/src/components/MasterizarPanel.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Loader2, Activity, Play, Pause, Trash2, Download, Wand2 } from "lucide-react";
import { decodificar, paraWav, paraMp3, baixar } from "@/lib/audioFile.js";
import { medir, masterizar } from "@/lib/mastering.js";
import { DESTINOS, acharDestino } from "@/lib/destinos.js";

type Medicao = {
  lufs: number; picoDb: number; faixaDinamica: number;
  balanco: number[]; duracao: number; sampleRate: number; canais: number;
};

type Versao = {
  id: string;
  rotulo: string;
  buffer: AudioBuffer;
  medicao: Medicao;
  alvoLufs: number;
  ganhoAplicadoDb: number;
};

/** Um número medido, ou um traço quando não há o que mostrar. */
function Numero({ rotulo, valor, unidade }: { rotulo: string; valor: number; unidade: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-semibold tabular-nums">
        {Number.isFinite(valor) ? valor.toFixed(1) : "—"}
        <span className="text-sm text-white/50 ml-1">{unidade}</span>
      </div>
      <div className="text-xs text-white/50 mt-1">{rotulo}</div>
    </div>
  );
}

export default function MasterizarPanel() {
  const [nome, setNome] = useState<string>("");
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [medicao, setMedicao] = useState<Medicao | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [destino, setDestino] = useState("radio");
  const [intensidade, setIntensidade] = useState(0.5);
  const [corteBaixo, setCorteBaixo] = useState(20);
  const [corteAlto, setCorteAlto] = useState(0);
  const [versoes, setVersoes] = useState<Versao[]>([]);
  const [processando, setProcessando] = useState(false);
  const [tocandoId, setTocandoId] = useState<string>("");

  const [refNome, setRefNome] = useState("");
  const [refBalanco, setRefBalanco] = useState<number[] | null>(null);
  const refInputRef = useRef<HTMLInputElement>(null);

  // Ref único pro AudioContext da pilha: nunca dois tocando ao mesmo tempo
  // (compararia mal), e cada troca fecha o anterior com segurança.
  const playbackCtxRef = useRef<AudioContext | null>(null);

  const fecharPlaybackAtual = useCallback(() => {
    const ctx = playbackCtxRef.current;
    playbackCtxRef.current = null;
    if (ctx && ctx.state !== "closed") {
      ctx.close().catch(() => {});
    }
  }, []);

  // Fecha o contexto de reprodução ao desmontar o painel — nada de áudio
  // tocando às escondidas depois que o usuário sai da aba.
  useEffect(() => fecharPlaybackAtual, [fecharPlaybackAtual]);

  const carregar = useCallback(async (file: File) => {
    setCarregando(true); setErro("");
    // Um arquivo novo apaga a pilha de versões do arquivo anterior -- versão
    // antiga tocando (ou baixada) com o nome do arquivo novo seria o pior
    // tipo de bug: silencioso e parece certo.
    fecharPlaybackAtual();
    setTocandoId("");
    setVersoes([]);
    try {
      const buf = await decodificar(file);
      setBuffer(buf);
      setNome(file.name);
      setMedicao(medir(buf));
    } catch (e: any) {
      setErro(`Não consegui ler "${file.name}". ${e?.message || ""}`);
      setBuffer(null); setMedicao(null);
    } finally {
      setCarregando(false);
    }
  }, [fecharPlaybackAtual]);

  const carregarReferencia = useCallback(async (file: File) => {
    setErro("");
    try {
      const buf = await decodificar(file);
      setRefBalanco(medir(buf).balanco);
      setRefNome(file.name);
    } catch (e: any) {
      setErro(`Não consegui ler a referência "${file.name}". ${e?.message || ""}`);
    }
  }, []);

  // Contador que só cresce -- nunca reusa número mesmo depois de apagar uma
  // versão do meio da pilha (índice/tamanho do array reutilizava id e
  // colidia duas linhas no mesmo key do React).
  const proximoIdRef = useRef(0);

  const gerar = useCallback(async () => {
    if (!buffer) return;
    setProcessando(true); setErro("");
    try {
      const destinoEscolhido = acharDestino(destino);
      const resultado = await masterizar(buffer, {
        alvoLufs: destinoEscolhido.alvoLufs,
        tetoDb: destinoEscolhido.tetoDb,
        corteBaixoHz: corteBaixo,
        corteAltoHz: corteAlto,
        intensidade,
        balancoReferencia: refBalanco,
      });
      setVersoes((atual) => [
        ...atual,
        {
          id: `v_${++proximoIdRef.current}_${destinoEscolhido.chave}`,
          rotulo: refBalanco ? `${destinoEscolhido.rotulo} + ref.` : destinoEscolhido.rotulo,
          buffer: resultado.buffer,
          medicao: resultado.medicao,
          alvoLufs: destinoEscolhido.alvoLufs,
          ganhoAplicadoDb: resultado.ganhoAplicadoDb,
        },
      ]);
    } catch (e: any) {
      setErro(`Falhou ao masterizar: ${e?.message || e}`);
    } finally {
      setProcessando(false);
    }
  }, [buffer, destino, intensidade, corteBaixo, corteAlto, refBalanco]);

  // Um player só para a pilha inteira: tocar duas versões ao mesmo tempo
  // atrapalharia a comparação, que é justamente o ponto da pilha.
  const tocar = useCallback((id: string, buf: AudioBuffer) => {
    fecharPlaybackAtual();
    if (tocandoId === id) { setTocandoId(""); return; }
    const ctx = new AudioContext();
    playbackCtxRef.current = ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => {
      // Só reage se ESTE contexto ainda é o que está tocando -- se o usuário
      // já trocou de versão, quem terminou por último não pode derrubar o
      // áudio novo por baixo dele.
      if (playbackCtxRef.current !== ctx) return;
      setTocandoId("");
      fecharPlaybackAtual(); // fim natural também libera o contexto
    };
    src.start(0);
    setTocandoId(id);
  }, [tocandoId, fecharPlaybackAtual]);

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) carregar(f);
        }}
        className="border-2 border-dashed border-white/20 rounded-xl p-8 text-center"
      >
        <Upload className="w-12 h-12 mx-auto mb-3 text-white/40" />
        <h3 className="text-lg font-semibold mb-1">Arraste o áudio para masterizar</h3>
        <p className="text-sm text-white/60 mb-4">
          Mix desta MiniDAW, da clássica, do seu teclado ou de terceiros. MP3, WAV, OGG, M4A.
        </p>
        <label
          className="inline-block px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"
          tabIndex={0}
          role="button"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
        >
          Escolher arquivo
          <input
            ref={inputRef}
            type="file" accept="audio/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) carregar(f); }}
          />
        </label>
      </div>

      {carregando && (
        <div className="flex items-center gap-2 text-white/70">
          <Loader2 className="w-4 h-4 animate-spin" /> Lendo e medindo…
        </div>
      )}
      {erro && <div className="text-red-300 text-sm">{erro}</div>}

      {medicao && (
        <div className="rounded-xl bg-black/30 border border-white/10 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span className="font-medium">{nome}</span>
            <span className="text-xs text-white/50">
              {medicao.duracao.toFixed(1)}s · {medicao.sampleRate} Hz · {medicao.canais === 1 ? "mono" : "estéreo"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Numero rotulo="Volume medido" valor={medicao.lufs} unidade="LUFS" />
            <Numero rotulo="Pico real" valor={medicao.picoDb} unidade="dB" />
            <Numero rotulo="Faixa dinâmica" valor={medicao.faixaDinamica} unidade="dB" />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="block text-white/60 mb-1">Destino</span>
              <select
                value={destino} onChange={(e) => setDestino(e.target.value)}
                className="w-full bg-black/40 border border-white/15 rounded-lg px-3 py-2"
              >
                {DESTINOS.map((d) => (
                  <option key={d.chave} value={d.chave}>
                    {d.rotulo} — alvo {d.alvoLufs} LUFS
                  </option>
                ))}
              </select>
              <span className="block text-xs text-white/40 mt-1">{acharDestino(destino).dica}</span>
            </label>

            <div className="text-sm space-y-2">
              <label className="block">
                <span className="text-white/60">Intensidade do acabamento: {intensidade.toFixed(2)}</span>
                <input type="range" min={0} max={1} step={0.05} value={intensidade}
                       onChange={(e) => setIntensidade(parseFloat(e.target.value))} className="w-full" />
              </label>
              <label className="block">
                <span className="text-white/60">Corte baixo: {corteBaixo || "desligado"} Hz</span>
                <input type="range" min={0} max={120} step={5} value={corteBaixo}
                       onChange={(e) => setCorteBaixo(parseInt(e.target.value))} className="w-full" />
              </label>
              <label className="block">
                <span className="text-white/60">Corte alto: {corteAlto || "desligado"} Hz</span>
                <input type="range" min={0} max={20000} step={500} value={corteAlto}
                       onChange={(e) => setCorteAlto(parseInt(e.target.value))} className="w-full" />
              </label>
            </div>
          </div>

          <button
            onClick={gerar} disabled={processando}
            className="mt-4 px-5 py-2.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 font-medium inline-flex items-center gap-2"
          >
            {processando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            {processando ? "Masterizando…" : "Masterizar"}
          </button>

          <div className="mt-4 pt-3 border-t border-white/10 text-sm">
            <div className="text-white/60 mb-1">Faixa de referência (opcional)</div>
            <p className="text-xs text-white/40 mb-2">
              Suba um jingle que você admira. O acabamento puxa o seu material na direção
              do equilíbrio dele — grave, médio e agudo. Não copia arranjo nem instrumento.
            </p>
            <label
              className="inline-block px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"
              tabIndex={0}
              role="button"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  refInputRef.current?.click();
                }
              }}
            >
              {refNome || "Escolher referência"}
              <input
                ref={refInputRef}
                type="file" accept="audio/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) carregarReferencia(f); }}
              />
            </label>
            {refBalanco && (
              <button onClick={() => { setRefBalanco(null); setRefNome(""); }}
                      className="ml-2 text-xs text-white/50 hover:text-white underline">
                remover
              </button>
            )}
          </div>
        </div>
      )}

      {versoes.length > 0 && (
        <div className="space-y-2">
          {versoes.map((v) => {
            const alcancou = Math.abs(v.medicao.lufs - v.alvoLufs) <= 1;
            return (
              <div key={v.id} className="rounded-xl bg-black/30 border border-white/10 p-3 flex items-center gap-3">
                <button onClick={() => tocar(v.id, v.buffer)}
                        className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center">
                  {tocandoId === v.id ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{v.rotulo}</div>
                  <div className="text-xs text-white/50 tabular-nums">
                    medido {v.medicao.lufs.toFixed(1)} LUFS · pico {v.medicao.picoDb.toFixed(1)} dB ·
                    ganho {v.ganhoAplicadoDb >= 0 ? "+" : ""}{v.ganhoAplicadoDb.toFixed(1)} dB
                    {!alcancou && (
                      <span className="text-amber-300"> · não alcançou o alvo de {v.alvoLufs} LUFS</span>
                    )}
                  </div>
                </div>
                <button onClick={() => baixar(paraMp3(v.buffer), `${nome.replace(/\.[^.]+$/, "")} - ${v.rotulo}.mp3`)}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm inline-flex items-center gap-1">
                  <Download className="w-4 h-4" /> MP3
                </button>
                <button onClick={() => baixar(paraWav(v.buffer), `${nome.replace(/\.[^.]+$/, "")} - ${v.rotulo}.wav`)}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
                  WAV
                </button>
                <button onClick={() => {
                          // Apagar a versão que está tocando não pode deixar o
                          // áudio (e o AudioContext) rodando sem nenhuma linha
                          // na tela pra pausar.
                          if (v.id === tocandoId) {
                            fecharPlaybackAtual();
                            setTocandoId("");
                          }
                          setVersoes((lista) => lista.filter((x) => x.id !== v.id));
                        }}
                        className="p-2 rounded-lg hover:bg-red-500/20 text-red-300">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
