"""Campanhas agendadas no feed da NewPost-IA (16/10/2026).

Substitui o agente da Base44/AppVerse que postava as campanhas do ecossistema Áudio
Pank a cada 2 dias. O PRODUTOR cria e aprova cada campanha (no Gerador ou na página
/campanhas); o cron só republica o que ele aprovou — nada é escrito por IA e
publicado sem ele ver (feedback-publicacao-sempre-manual).

Regras: horários 09/15/21h (Brasília); no máximo 1 campanha por horário e no máximo
`teto_diario` por dia somando todos os perfis (feed lotado espanta o público);
Achadinhos nunca com preço (preço é do admin da NewPost-IA).

As campanhas moram no banco do FEED (esdgly, tabela campanhas_locutores — SQL em
CREATE_CAMPANHAS_FEED.sql), uma linha por perfil com RLS no auth.uid(): o Locutores
IA loga em cada perfil (newpost_feed.sessao) e só enxerga as linhas dele.
Design: docs/superpowers/specs/2026-10-16-campanhas-agendadas-design.md
"""
import re
import time
from datetime import date, datetime, timedelta, timezone

import requests

from core import newpost_feed

BRT = timezone(timedelta(hours=-3))      # Brasil sem horário de verão desde 2019
HORARIOS = (9, 15, 21)
CONTAS_CAMPANHA = ('locutores', 'principal', 'futuro', 'vida', 'achadinhos')
TABELA = 'campanhas_locutores'


# ── tempo ────────────────────────────────────────────────────────────────────

def hoje_brt():
    return datetime.now(BRT).date()


def _slot_da_hora(hora):
    """Faixa do horário: o cron do plano Hobby da Vercel pode atrasar até ~59 min,
    então 09–14h vale como 9, 15–20h como 15, 21–23h como 21; madrugada = nada."""
    if hora >= 21:
        return 21
    if hora >= 15:
        return 15
    if hora >= 9:
        return 9
    return None


def slot_do_momento(agora_utc):
    """(data em Brasília, horário 9/15/21 ou None)."""
    brt = agora_utc.astimezone(BRT)
    return brt.date(), _slot_da_hora(brt.hour)


def _quando_saiu(ultima_em):
    """(data, horário) em Brasília de uma publicação anterior, ou (None, None)."""
    if not ultima_em:
        return None, None
    try:
        t = datetime.fromisoformat(str(ultima_em).replace('Z', '+00:00'))
    except ValueError:
        return None, None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    brt = t.astimezone(BRT)
    return brt.date(), _slot_da_hora(brt.hour)


def _data(valor):
    return valor if isinstance(valor, date) else date.fromisoformat(str(valor)[:10])


def proxima_data(camp, publicada_em):
    """Próxima saída depois de publicar em `publicada_em` (nunca o mesmo dia)."""
    if camp.get('regra') == 'semana':
        dias = set(camp.get('dias_semana') or [])
        for i in range(1, 8):
            d = publicada_em + timedelta(days=i)
            if d.weekday() in dias:
                return d
    return publicada_em + timedelta(days=int(camp.get('intervalo_dias') or 1))


def primeira_data(camp, comeca_em):
    """Primeira saída a partir de `comeca_em` (pode ser o próprio dia)."""
    if camp.get('regra') == 'semana':
        dias = set(camp.get('dias_semana') or [])
        for i in range(0, 7):
            d = comeca_em + timedelta(days=i)
            if d.weekday() in dias:
                return d
    return comeca_em


# ── escolha (anti-lotação) ───────────────────────────────────────────────────

def candidatas(lista, hoje, slot, teto):
    """Campanhas que podem sair AGORA, da mais atrasada pra mais nova.

    Vazio se o dia já bateu o teto ou se alguma campanha já saiu neste horário.
    """
    saidas_hoje = [_quando_saiu(c.get('ultima_em')) for c in lista]
    saidas_hoje = [s for s in saidas_hoje if s[0] == hoje]
    if len(saidas_hoje) >= int(teto or 1) or any(s[1] == slot for s in saidas_hoje):
        return []
    elegiveis = []
    for c in lista:
        if not c.get('ativa'):
            continue
        prox = _data(c['proxima_em'])
        if prox < hoje or (prox == hoje and int(c['horario']) <= slot):
            elegiveis.append(c)
    return sorted(elegiveis, key=lambda c: (str(c['proxima_em']), int(c['horario']), int(c.get('vezes') or 0)))


# ── validação ────────────────────────────────────────────────────────────────

_PRECO = re.compile(r'R\$\s*\d[\d.,]*|\b\d[\d.]*(?:,\d{1,2})?\s*reais\b', re.I)


def trecho_com_preco(texto):
    m = _PRECO.search(texto or '')
    return m.group(0) if m else None


def _tags(valor):
    if isinstance(valor, (list, tuple)):
        valor = ' '.join(str(v) for v in valor)
    partes = [p.strip() for p in re.split(r'[\s,#]+', str(valor or '')) if p.strip()]
    vistas, saida = set(), []
    for p in partes:
        if p.lower() not in vistas:
            vistas.add(p.lower())
            saida.append(p[:40])
    return saida[:10]


def _url_ou_none(valor):
    v = str(valor or '').strip()
    return v if v.startswith('https://') else None


def validar(dados, hoje, permitir_passado=False):
    """(linha pronta pro banco, None) ou (None, mensagem pra tela)."""
    conta = str(dados.get('conta') or '')
    if conta not in CONTAS_CAMPANHA:
        return None, 'Perfil inválido — escolha um da lista.'
    titulo = str(dados.get('titulo') or '').strip()[:120]
    if not titulo:
        return None, 'Dê um título à campanha (só aparece aqui no painel).'
    legenda = str(dados.get('legenda') or '').strip()[:5000]
    if not legenda:
        return None, 'A legenda do post está vazia.'
    regra = str(dados.get('regra') or 'intervalo')
    if regra not in ('intervalo', 'semana'):
        return None, 'Repetição inválida.'
    try:
        horario = int(dados.get('horario'))
    except (TypeError, ValueError):
        horario = None
    if horario not in HORARIOS:
        return None, 'Horário tem que ser 09h, 15h ou 21h.'
    intervalo, dias = None, []
    if regra == 'intervalo':
        try:
            intervalo = int(dados.get('intervalo_dias'))
        except (TypeError, ValueError):
            intervalo = 0
        if not 1 <= intervalo <= 30:
            return None, 'A repetição "a cada N dias" vai de 1 a 30.'
    else:
        try:
            dias = sorted({int(d) for d in (dados.get('dias_semana') or []) if 0 <= int(d) <= 6})
        except (TypeError, ValueError):
            dias = []
        if not dias:
            return None, 'Marque pelo menos um dia da semana.'
    try:
        comeca = _data(dados.get('comeca_em') or hoje)
    except ValueError:
        return None, 'Data de início inválida.'
    if comeca < hoje and not permitir_passado:
        return None, 'A data de início está no passado.'
    transcricao = str(dados.get('transcricao') or '').strip()[:6000] or None
    if conta == 'achadinhos':
        for texto in (legenda, transcricao):
            trecho = trecho_com_preco(texto)
            if trecho:
                return None, (f'Achadinhos não leva preço (quem divulga preço é o admin da NewPost-IA). '
                              f'Tire este trecho: "{trecho}".')
    linha = {
        'conta': conta, 'titulo': titulo, 'legenda': legenda, 'tags': _tags(dados.get('tags')),
        'audio_url': _url_ou_none(dados.get('audio_url')),
        'imagem_url': _url_ou_none(dados.get('imagem_url')),
        'transcricao': transcricao,
        'regra': regra, 'intervalo_dias': intervalo, 'dias_semana': dias, 'horario': horario,
    }
    if not linha['audio_url']:
        linha['transcricao'] = None      # transcrição só existe junto do áudio
    linha['proxima_em'] = (comeca if permitir_passado else primeira_data(linha, comeca)).isoformat()
    return linha, None


# ── banco do feed (REST com o login de cada perfil) ─────────────────────────

class _BancoFeed:
    def _req(self, conta, metodo, caminho, **kw):
        s = newpost_feed.sessao(conta)
        url, anon = newpost_feed._cfg()
        cab = {'apikey': anon, 'Authorization': f"Bearer {s['access_token']}",
               'Content-Type': 'application/json', 'Prefer': kw.pop('prefer', 'return=representation')}
        r = requests.request(metodo, f'{url}/rest/v1/{caminho}', headers=cab, timeout=20, **kw)
        # Token recém-saído do login às vezes vem à frente do relógio do banco (PGRST303).
        for espera in (3, 5):
            if r.status_code != 401 or 'PGRST303' not in (r.text or ''):
                break
            time.sleep(espera)
            r = requests.request(metodo, f'{url}/rest/v1/{caminho}', headers=cab, timeout=20, **kw)
        if not r.ok:
            texto = r.text or ''
            if 'PGRST205' in texto or 'does not exist' in texto:
                raise RuntimeError('As tabelas de campanha ainda não existem no banco do feed — '
                                   'rode o CREATE_CAMPANHAS_FEED.sql no Supabase da NewPost-IA.')
            raise RuntimeError(f'{r.status_code}: {texto[:200]}')
        return r.json() if (r.text or '').strip() else None

    def listar(self, conta):
        return self._req(conta, 'GET', f'{TABELA}?select=*&order=proxima_em.asc') or []

    def criar(self, conta, linha):
        return (self._req(conta, 'POST', TABELA, json=linha) or [None])[0]

    def atualizar(self, conta, id_, campos):
        campos = dict(campos, updated_at=datetime.now(timezone.utc).isoformat())
        return (self._req(conta, 'PATCH', f'{TABELA}?id=eq.{id_}', json=campos) or [None])[0]

    def apagar(self, conta, id_):
        return bool(self._req(conta, 'DELETE', f'{TABELA}?id=eq.{id_}'))

    def ler_teto(self):
        linhas = self._req('principal', 'GET', 'campanhas_config?select=teto_diario') or []
        return int(linhas[0]['teto_diario']) if linhas else 1

    def gravar_teto(self, teto):
        s = newpost_feed.sessao('principal')
        self._req('principal', 'POST', 'campanhas_config?on_conflict=author_id',
                  prefer='resolution=merge-duplicates,return=representation',
                  json={'author_id': s['user_id'], 'teto_diario': int(teto),
                        'updated_at': datetime.now(timezone.utc).isoformat()})


banco = _BancoFeed()


def contas_configuradas():
    return [c for c in CONTAS_CAMPANHA if newpost_feed.conta_configurada(c)]


def subir_midia(conta, tipo, nome, dados, mime):
    if tipo == 'audio':
        return newpost_feed.subir_audio(nome, dados, conta=conta)
    return newpost_feed.subir_imagem(nome, dados, conta=conta, mime=mime)


def _publicar_no_feed(conteudo, conta, **kw):
    return newpost_feed.publicar(conteudo, conta=conta, **kw)


def listar_todas():
    """(campanhas de todos os perfis configurados, erros por perfil)."""
    todas, erros = [], []
    for conta in contas_configuradas():
        try:
            todas += banco.listar(conta)
        except Exception as e:
            erros.append(f'{conta}: {e}')
    return sorted(todas, key=lambda c: (str(c.get('proxima_em')), int(c.get('horario') or 0))), erros


# ── disparo (cron) ───────────────────────────────────────────────────────────

def disparar(agora=None):
    """Publica no máximo UMA campanha neste horário. Nunca levanta exceção."""
    agora = agora or datetime.now(timezone.utc)
    hoje, slot = slot_do_momento(agora)
    if slot is None:
        return {'publicada': None, 'motivo': 'fora dos horários (09/15/21h)'}
    todas, erros = listar_todas()
    try:
        teto = banco.ler_teto()
    except Exception as e:
        teto, erros = 1, erros + [f'teto: {e}']
    for c in candidatas(todas, hoje, slot, teto):
        conteudo = newpost_feed.com_hashtags(c['legenda'], c.get('tags') or [])
        img = c.get('imagem_url')
        r = _publicar_no_feed(
            conteudo, conta=c['conta'], tags=c.get('tags') or [],
            media_urls=[img] if img else None, media_types=['image'] if img else None,
            audio_url=c.get('audio_url'), transcricao=c.get('transcricao'),
            chave=f"campanha-{c['id']}-{hoje.isoformat()}-{slot}")
        if r.get('success') or r.get('already'):
            # Saiu no feed: PARA aqui, mesmo se a gravação falhar — tentar a próxima
            # poria 2 campanhas no mesmo horário. Se a gravação falhar, a chave
            # idempotente segura a repetição neste horário.
            try:
                banco.atualizar(c['conta'], c['id'], {
                    'vezes': int(c.get('vezes') or 0) + 1,
                    'ultima_em': agora.isoformat(),
                    'ultimo_post_id': r.get('post_id'),
                    'ultimo_erro': None,
                    'proxima_em': proxima_data(c, hoje).isoformat(),
                })
            except Exception as e:
                erros.append(f"{c.get('titulo')}: publicou, mas não consegui gravar no banco ({e})")
            return {'publicada': c['id'], 'titulo': c.get('titulo'), 'conta': c['conta'],
                    'post_id': r.get('post_id'), 'erros': erros}
        erro = f"{agora.astimezone(BRT):%d/%m %H:%M}: {r.get('error') or 'falha ao publicar'}"[:300]
        erros.append(f"{c.get('titulo')}: {erro}")
        try:
            banco.atualizar(c['conta'], c['id'], {'ultimo_erro': erro})
        except Exception:
            pass
    return {'publicada': None, 'motivo': 'nenhuma campanha na vez', 'erros': erros}
