import { useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, X, ShieldAlert, CheckCircle2, Circle, Terminal } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * 🔐 Variáveis de Ambiente & Secrets — Locutores IA Studio
 * Painel de referência (read-only) com o mapeamento completo das variáveis
 * usadas pelas edge functions + frontend. Aberto a partir do header da MiniDAW.
 */

interface SecretRow {
  name: string;
  source: string;
  used: string;
  required?: "yes" | "fallback" | "optional";
}

const FRONTEND_VARS: { name: string; source: string; example: string }[] = [
  { name: "VITE_SUPABASE_URL", source: "Dashboard → Settings → API → Project URL", example: "https://xxxxx.supabase.co" },
  { name: "VITE_SUPABASE_PUBLISHABLE_KEY", source: "Dashboard → Settings → API → anon public", example: "eyJhbGc..." },
  { name: "VITE_SUPABASE_PROJECT_ID", source: "ref do projeto", example: "xxxxx" },
];

const AUTO_INJECTED: { name: string; used: string }[] = [
  { name: "SUPABASE_URL", used: "generate-audio-for-post, publish-to-newpost" },
  { name: "SUPABASE_ANON_KEY", used: "publish-to-newpost" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", used: "generate-audio-for-post" },
];

const MANUAL_SECRETS: SecretRow[] = [
  { name: "LOVABLE_API_KEY", source: "Auto-provisionado ao ativar Lovable AI Gateway", used: "ai-audio-producer, voxcraft-assistant", required: "yes" },
  { name: "ELEVENLABS_API_KEY", source: "elevenlabs.io → Profile → API Keys", used: "elevenlabs-tts", required: "yes" },
  { name: "OPENAI_API_KEY", source: "platform.openai.com → API keys", used: "openai-tts", required: "fallback" },
  { name: "GOOGLE_TTS_API_KEY", source: "console.cloud.google.com → Text-to-Speech → Credentials", used: "google-tts", required: "fallback" },
  { name: "LMNT_API_KEY", source: "app.lmnt.com → Account → API Keys", used: "lmnt-tts", required: "optional" },
  { name: "REPLICATE_API_KEY", source: "replicate.com → Account → API Tokens", used: "generate-music (MusicGen)", required: "yes" },
  { name: "FREESOUND_API_KEY", source: "freesound.org/apiv2/apply", used: "freesound-sfx", required: "optional" },
];

const NEWPOST_SECRETS: { name: string; source: string; used: string }[] = [
  { name: "NEWPOST_SUPABASE_URL", source: "URL do projeto Supabase do NewPost-IA", used: "publish-to-newpost, generate-audio-for-post" },
  { name: "NEWPOST_SERVICE_ROLE_KEY", source: "service_role key do projeto NewPost-IA", used: "publish-to-newpost, generate-audio-for-post" },
];

const FUNCTION_MAP: { fn: string; secrets: string }[] = [
  { fn: "elevenlabs-tts", secrets: "ELEVENLABS_API_KEY (ou ELEVENLABS_API_KEY_1)" },
  { fn: "openai-tts", secrets: "OPENAI_API_KEY" },
  { fn: "google-tts", secrets: "GOOGLE_TTS_API_KEY" },
  { fn: "lmnt-tts", secrets: "LMNT_API_KEY" },
  { fn: "generate-music", secrets: "REPLICATE_API_KEY" },
  { fn: "freesound-sfx", secrets: "FREESOUND_API_KEY" },
  { fn: "ai-audio-producer", secrets: "LOVABLE_API_KEY" },
  { fn: "voxcraft-assistant", secrets: "LOVABLE_API_KEY" },
  { fn: "check-secrets", secrets: "(nenhum — só lista os outros)" },
  { fn: "publish-to-newpost", secrets: "SUPABASE_URL, SUPABASE_ANON_KEY, NEWPOST_SUPABASE_URL, NEWPOST_SERVICE_ROLE_KEY" },
  { fn: "generate-audio-for-post", secrets: "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEWPOST_SERVICE_ROLE_KEY" },
];

const MINIMAL_SETUP = [
  "LOVABLE_API_KEY          ← Gemini (roteiros + assistente)",
  "ELEVENLABS_API_KEY       ← TTS principal",
  "OPENAI_API_KEY           ← fallback TTS",
  "REPLICATE_API_KEY        ← geração de trilha",
];

const RequiredBadge = ({ level }: { level?: SecretRow["required"] }) => {
  if (level === "yes") return <span className="inline-flex items-center gap-1 text-xs text-green-400"><CheckCircle2 className="w-3.5 h-3.5" /> obrigatório</span>;
  if (level === "fallback") return <span className="inline-flex items-center gap-1 text-xs text-amber-400"><Circle className="w-3.5 h-3.5" /> fallback</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-white/50"><Circle className="w-3.5 h-3.5" /> opcional</span>;
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-3">
    <h3 className="text-sm font-semibold text-purple-300 uppercase tracking-wide">{title}</h3>
    {children}
  </section>
);

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="text-left font-medium text-white/60 px-3 py-2 border-b border-white/10">{children}</th>
);
const Td = ({ children }: { children: React.ReactNode }) => (
  <td className="px-3 py-2 border-b border-white/5 align-top text-white/85">{children}</td>
);
const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="font-mono text-[13px] text-pink-300 break-all">{children}</code>
);

export const SecretsManager = () => {
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        variant="outline"
        className="gap-2 border-white/20 hover:bg-white/10"
      >
        <KeyRound className="w-4 h-4" />
        Variáveis &amp; Secrets
      </Button>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <Card className="w-full max-w-4xl my-6 bg-slate-900 border-white/10 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between p-5 border-b border-white/10 bg-slate-900/95 backdrop-blur">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-purple-400" />
            Variáveis de Ambiente &amp; Secrets
          </h2>
          <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="text-white/60 hover:text-white hover:bg-white/10">
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-6 space-y-8 text-sm">
          <p className="text-white/60">
            Mapeamento completo das variáveis usadas pelas 11 edge functions + frontend.
            Referência de configuração — preencha no Supabase Dashboard ou via CLI.
          </p>

          {/* 1. Frontend */}
          <Section title="1 · Frontend (.env na raiz)">
            <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Públicas — podem ir no repositório. <strong>Nunca</strong> coloque a <Code>service_role_key</Code> no frontend.</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr><Th>Variável</Th><Th>Origem</Th><Th>Exemplo</Th></tr></thead>
                <tbody>
                  {FRONTEND_VARS.map((v) => (
                    <tr key={v.name}><Td><Code>{v.name}</Code></Td><Td>{v.source}</Td><Td><Code>{v.example}</Code></Td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 2. Edge function secrets */}
          <Section title="2 · Edge Function Secrets">
            <p className="text-white/60 text-xs">🟢 Auto-injetados pelo Supabase (não precisa configurar)</p>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr><Th>Variável</Th><Th>Quem usa</Th></tr></thead>
                <tbody>
                  {AUTO_INJECTED.map((v) => (
                    <tr key={v.name}><Td><Code>{v.name}</Code></Td><Td>{v.used}</Td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-white/60 text-xs mt-4">🔑 Você precisa configurar manualmente</p>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr><Th>Secret</Th><Th>Onde obter</Th><Th>Quem usa</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {MANUAL_SECRETS.map((v) => (
                    <tr key={v.name}><Td><Code>{v.name}</Code></Td><Td>{v.source}</Td><Td>{v.used}</Td><Td><RequiredBadge level={v.required} /></Td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 3. NewPost-IA */}
          <Section title="3 · Integração NewPost-IA (opcional)">
            <p className="text-white/60 text-xs">Configure apenas para publicar do Studio para a rede social NewPost-IA.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr><Th>Secret</Th><Th>Como obter</Th><Th>Usado em</Th></tr></thead>
                <tbody>
                  {NEWPOST_SECRETS.map((v) => (
                    <tr key={v.name}><Td><Code>{v.name}</Code></Td><Td>{v.source}</Td><Td>{v.used}</Td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 4. Per-function */}
          <Section title="4 · Cada Edge Function × seus secrets">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr><Th>Edge Function</Th><Th>Secrets necessários</Th></tr></thead>
                <tbody>
                  {FUNCTION_MAP.map((v) => (
                    <tr key={v.fn}><Td><Code>{v.fn}</Code></Td><Td>{v.secrets}</Td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 5. Minimal setup */}
          <Section title="5 · Setup mínimo recomendado">
            <p className="text-white/60 text-xs">Configure só esses 4 e o Studio já roda o fluxo principal:</p>
            <pre className="bg-black/40 border border-white/10 rounded-lg p-4 text-[13px] text-green-300 font-mono overflow-x-auto whitespace-pre">{MINIMAL_SETUP.join("\n")}</pre>
            <p className="text-white/50 text-xs">Depois adicione GOOGLE_TTS_API_KEY, LMNT_API_KEY e FREESOUND_API_KEY conforme ativar recursos.</p>
          </Section>

          {/* 6. CLI / validação */}
          <Section title="6 · Adicionar e validar (CLI)">
            <pre className="bg-black/40 border border-white/10 rounded-lg p-4 text-[13px] text-white/80 font-mono overflow-x-auto whitespace-pre">{`# Via CLI
supabase secrets set ELEVENLABS_API_KEY=sk_xxx
supabase secrets set OPENAI_API_KEY=sk-xxx
supabase secrets set REPLICATE_API_KEY=r8_xxx
supabase secrets list

# Deploy das functions
supabase functions deploy elevenlabs-tts openai-tts google-tts lmnt-tts \\
  generate-music freesound-sfx ai-audio-producer voxcraft-assistant \\
  check-secrets publish-to-newpost generate-audio-for-post`}</pre>
            <div className="flex items-start gap-2 text-xs text-white/70">
              <Terminal className="w-4 h-4 mt-0.5 shrink-0 text-purple-400" />
              <span>Valide com <Code>check-secrets</Code> — retorna quais chaves estão configuradas (<Code>{`{ "ELEVENLABS_API_KEY": true, ... }`}</Code>).</span>
            </div>
          </Section>
        </div>
      </Card>
    </div>,
    document.body
  );
};

export default SecretsManager;
