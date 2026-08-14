# Automação de volume por pontos na MiniDAW clássica — design

**Data:** 2026-08-14
**Status:** aprovado pelo usuário (brainstorming completo)

## Problema

O produtor mostrou o Samplitude Pro X: além do Ducking automático (que já
existe na MiniDAW clássica), o software profissional deixa desenhar
**pontos de volume manuais** direto na linha do tempo — clicar num ponto
exato e definir o volume ali, dando controle fino que o Ducking sozinho não
cobre. Caso de uso real trazido: um jingle com uma versão **cantada**
(assinatura do cliente) e uma **instrumental** (sem voz, pra não brigar com
a locução) — o produtor quer controlar precisamente a curva de volume da
trilha ao redor da locução, ponto a ponto.

A troca de versão cantada/instrumental do jingle **não virou feature
própria** — já dá pra montar hoje com a Timeline de clips (Fase 1, no ar
desde 05/08/2026), cortando e posicionando os dois arquivos. Só a
automação de volume por pontos é trabalho novo.

## Por que é preciso investigar antes de desenhar (achado do brainstorming)

Existe uma regra de casa rígida hoje: toda automação de ganho de uma
trilha passa por **uma função central**, `agendarVolumeDaFaixa`
(`static/minidaw.js`), que sempre `cancelScheduledValues` e reconstrói o
agendamento do zero (fader + Ducking + fade final). O comentário do
próprio código chama isso de "agenda central" e proíbe automação de ganho
fora dela — é o que garante que Ducking e fade final nunca brigam entre si
num clique duplo. A automação por pontos **precisa entrar nessa mesma
disciplina**, não pode virar um segundo sistema escrevendo no mesmo
`GainNode.gain` por fora.

O Gate de respiração (`aplicarGate`, adicionado 13/08/2026) é a única
automação que tem nó de `GainNode` próprio (`gateGain`), separado do
`trackGain` principal — justamente porque não dá pra dividir o mesmo
`AudioParam` com o Ducking sem conflito. Isso não se aplica aqui: a
automação por pontos SUBSTITUI o Ducking (não convive com ele na mesma
trilha), então ela entra direto na agenda central, sem nó novo.

## Decisões do usuário

| Pergunta | Resposta |
|---|---|
| Convivência com o Ducking automático | Pontos manuais **substituem** o Ducking na trilha (por trilha, não é opção global) |
| Tipos de trilha | **Música e locução** — não só trilha instrumental |
| Companheiro visual no brainstorming | Recusado — só texto |
| Como criar/editar pontos | Clique cria, arrasta move, duplo-clique remove |
| Visibilidade da linha | Some quando não está em uso — botão "Automação" por trilha, mesmo padrão da Tesoura |

## Arquitetura

**Novo campo por trilha**: `track.automacaoVolume = { ativo: boolean, pontos: [{ tempo, volume }, ...] }`.
`tempo` em segundos, posição absoluta na timeline (não presa a nenhum clip
específico — a trilha inteira tem uma curva). `volume` de 0 a 150, mesma
escala do fader que já existe hoje (`track.volume`, slider `min="0"
max="150"` — conferido no código, não é 0-100 como se imaginaria à
primeira vista). `ativo` reflete se o botão
"Automação" está ligado para aquela trilha; o efeito de substituir o
Ducking só entra de fato quando `ativo && pontos.length > 0` — trilha com
o modo ligado mas sem nenhum ponto ainda se comporta como hoje (fader +
Ducking normal).

**Entra na agenda central**: `agendarVolumeDaFaixa` passa a checar essa
condição antes de aplicar Ducking. Se verdadeira, agenda o volume só a
partir dos pontos — ordena por `tempo`, liga os valores com
`linearRampToValueAtTime` (mesma rampa reta usada em todo o resto do
motor, sem curva suavizada nova). Antes do primeiro ponto e depois do
último, o volume permanece constante no valor daquele ponto extremo (não
existe "cair de volta pro fader" no meio da automação — isso criaria um
salto confuso). Sem automação ativa ou sem pontos, o caminho de código
antigo (fader + Ducking) roda exatamente como hoje, sem nenhuma mudança de
comportamento.

**`mix-engine.js` (export) espelha o mesmo campo** — pela regra já
estabelecida na Fase 1 da Timeline de clips ("prévia e arquivo idênticos"),
o motor de renderização do export precisa ler `automacaoVolume` e produzir
o resultado idêntico ao que toca ao vivo. Isso significa tocar a mesma
lógica de "substitui Ducking" nos dois lugares — não é opcional.

## Interface

- **Botão "Automação" por trilha**, mesmo estilo e posição visual da
  Tesoura já existente — liga/desliga um modo por trilha (`ativo`).
  Desligado: nada aparece por cima da forma de onda, timeline limpa.
  Ligado: uma linha aparece sobre a forma de onda, na mesma escala de
  tempo (`pxPorSegundo`) já usada pelos clips e pela régua — o eixo
  horizontal dela é EXATAMENTE o mesmo dos clips, então os pontos alinham
  visualmente com o que está tocando naquele instante.
- **Clicar em espaço vazio da linha** (dentro da `.lane-conteudo` daquela
  trilha, quando o modo está ligado) cria um ponto na posição clicada —
  posição horizontal vira `tempo`, posição vertical vira `volume` (0 em
  baixo, 150 em cima, mesmo sentido intuitivo de um fader).
- **Arrastar um ponto existente** move ele livremente (tempo e volume ao
  mesmo tempo, sem eixo travado) — mesmo padrão de mousedown/mousemove/
  mouseup já usado pra arrastar clips e pra fazer trim, não introduz
  nenhuma biblioteca nova.
- **Duplo-clique num ponto** remove ele.
- Quando a trilha tem automação ativa com pelo menos 1 ponto, o **fader de
  volume da trilha fica com opacidade reduzida** — indica visualmente que
  ele não está fazendo efeito sozinho no momento, mas o valor nele
  continua guardado (se o produtor desligar a automação depois, o fader
  volta a valer, sem perder o número que estava lá).

## Persistência

`automacaoVolume` entra nos mesmos três lugares onde `eqSettings` e
`gateSettings` já entram hoje, seguindo o padrão existente sem inventar
mecanismo novo:
1. Objeto da trilha em `addTrack` (`static/minidaw.js`) — valor inicial
   `{ ativo: false, pontos: [] }`.
2. Payload de salvar/carregar no Supabase (`salvarProjetoSupabase`/
   `carregarProjetoSupabase`, `static/minidaw.js`) — mesmo tratamento de
   fallback pra projetos salvos antes dessa feature existir (`ativo:
   false, pontos: []` se o campo não existir na linha salva).
3. `localStorage` (`saveToLocalStorage`/`loadFromLocalStorage`) já
   persiste isso de graça — o mecanismo hoje espalha o objeto da trilha
   inteiro, então um campo novo serializável em JSON entra sem precisar
   de nenhuma mudança ali.

## Erros e casos de borda

- **Pontos fora da duração real da trilha** (ex.: arrastado além do fim
  do áudio): o ponto continua existindo nos dados, mas não tem efeito
  audível prático além do fim do arquivo — não precisa de validação
  especial, o próprio `AudioContext` ignora automação além da duração do
  buffer.
- **Dois pontos no mesmo instante exato** (`tempo` igual): a ordenação por
  `tempo` desempata pela ordem de criação; não é um caso que precise de
  tratamento explícito, `linearRampToValueAtTime` com intervalo zero vira
  um salto instantâneo, comportamento aceitável.
- **Trilha muito curta ou sem duração ainda carregada**: o botão
  "Automação" fica disponível mas a linha simplesmente não tem onda por
  baixo pra referência visual — mesma limitação que já existe hoje pra
  cortar clips numa trilha vazia.

## Fora de escopo desta v1

- **Ctrl+Z para edição de pontos** — o produtor corrige um ponto errado
  arrastando ou removendo na hora; risco bem menor que perder um corte de
  clip (que já tem undo). Fica pra depois se incomodar no uso real.
- **Curva suavizada entre pontos** (ease-in/out, bezier) — só rampa reta,
  consistente com todo o resto do motor de automação (Ducking e Gate
  também só usam `linearRampToValueAtTime`).
- **Automação por pontos na MiniDAW React** (Audio Pank Studio) — ela não
  tem timeline de clips nenhuma hoje (só um valor de volume fixo por
  faixa, sem variação no tempo), então esse pedido é inteiramente da
  clássica. Se um dia a React ganhar timeline de clips, essa automação
  pode ser portada — não antes disso.
- **Feature de "troca de versão de jingle"** — não é uma feature nova,
  já é possível hoje com corte/posicionamento de clips.
