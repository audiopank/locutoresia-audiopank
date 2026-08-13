// minidaw-react/src/lib/projectStorage.ts
// Torna o áudio de uma faixa do Projeto VIP permanente antes de salvar.
// Sem isso, `track.audioUrl` costuma ser um link `blob:` — válido só na
// aba que o criou, morto assim que ela fecha. Reaproveita o mesmo backend
// já usado e validado pela MiniDAW clássica (/api/client-deliveries/upload-url,
// kind='projeto'), sem mudar nada nele.
import { decodificar, paraMp3 } from "./audioFile.js";

export interface FaixaComAudio {
  name?: string;
  audioUrl: string;
  audio_path?: string;
  audio_url_direct?: string;
}

export interface ArmazenamentoResolvido {
  audio_path?: string;
  audio_url_direct?: string;
}

// http(s) mas NÃO uma signed URL de leitura de 1h (essas expiram — salvar
// uma delas de novo criaria outro link morto, só que daqui a 1h em vez de
// já nascer morto). Mesmo teste usado em static/minidaw.js.
const URL_ESTAVEL = /^https?:/i;
const URL_TEMPORARIA = /\/object\/sign\/|token=/i;

async function uploadAudioProjeto(blob: Blob): Promise<string> {
  const filename = `faixa-${Date.now()}.mp3`;
  const ru = await fetch("/api/client-deliveries/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, kind: "projeto" }),
  });
  const u = await ru.json();
  if (!u.success) throw new Error(u.error || "Falha ao preparar o envio do áudio");

  const fd = new FormData();
  fd.append("file", blob, filename);
  const up = await fetch(u.upload_url, {
    method: "PUT",
    headers: { apikey: u.apikey, Authorization: `Bearer ${u.apikey}` },
    body: fd,
  });
  if (!up.ok) throw new Error("Falha ao enviar o áudio da faixa");
  return u.path as string;
}

/**
 * Decide o que fazer com o áudio de UMA faixa, em ordem (evita reupload à toa):
 *  1. Já tem `audio_path` de um load anterior (não trocou) -> reusa.
 *  2. Já tem `audio_url_direct` (ex.: trilha da Biblioteca) -> reusa.
 *  3. `audioUrl` já é http(s) estável (não é blob:, não é signed URL de 1h) -> vira audio_url_direct.
 *  4. Senão (blob: comum de voz gerada / upload local) -> baixa, recomprime pra MP3 128kbps, sobe.
 */
export async function garantirArmazenamentoPermanente(
  track: FaixaComAudio
): Promise<ArmazenamentoResolvido> {
  const nome = track.name || "sem nome";

  if (track.audio_path) return { audio_path: track.audio_path };
  if (track.audio_url_direct) return { audio_url_direct: track.audio_url_direct };

  const url = track.audioUrl || "";
  if (!url) throw new Error(`Faixa "${nome}" não tem áudio`);

  if (URL_ESTAVEL.test(url) && !URL_TEMPORARIA.test(url)) {
    return { audio_url_direct: url };
  }

  let blob: Blob;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  } catch (e: any) {
    throw new Error(`Faixa "${nome}": falha ao ler o áudio (${e.message})`);
  }

  let mp3: Blob;
  try {
    const buffer = await decodificar(blob);
    mp3 = paraMp3(buffer, 128);
  } catch (e: any) {
    throw new Error(`Faixa "${nome}": falha ao comprimir o áudio (${e.message})`);
  }

  try {
    const path = await uploadAudioProjeto(mp3);
    return { audio_path: path };
  } catch (e: any) {
    throw new Error(`Faixa "${nome}": falha ao enviar o áudio (${e.message})`);
  }
}
