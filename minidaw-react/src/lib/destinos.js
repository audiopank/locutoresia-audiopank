// minidaw-react/src/lib/destinos.js
/**
 * Alvos por LUGAR DE ESCUTA, não por plataforma. O produtor entrega para os
 * quatro, e cada um pede um volume diferente.
 *
 * ⚠️ Estes números são ponto de partida informado e DEVEM se mover no ouvido do
 * produtor — foi assim que o fade final da MiniDAW clássica saiu de 1,05 s para
 * 3,05 s. Se ele pedir para mudar, mude aqui e em lugar nenhum mais.
 */
export const DESTINOS = [
    {
        chave: 'radio', rotulo: 'Rádio FM/AM', alvoLufs: -16, tetoDb: -1.0,
        // Mais baixo DE PROPÓSITO: a emissora tem processador próprio, e
        // material espremido faz o processador dela brigar com o nosso.
        dica: 'A rádio processa de novo. Entregar espremido piora o que sai no ar.',
    },
    {
        chave: 'redes', rotulo: 'Redes (Reels/TikTok)', alvoLufs: -14, tetoDb: -1.0,
        dica: 'As plataformas normalizam por volta de -14. Mandar mais alto só perde dinâmica.',
    },
    {
        chave: 'whatsapp', rotulo: 'WhatsApp / cliente', alvoLufs: -12, tetoDb: -1.0,
        dica: 'O cliente escuta no alto-falante do celular. Aqui volume ajuda de verdade.',
    },
    {
        chave: 'pdv', rotulo: 'PDV / carro de som', alvoLufs: -9, tetoDb: -0.5,
        dica: 'Ambiente barulhento e caixa ruim: pouca dinâmica para não sumir.',
    },
];

export function acharDestino(chave) {
    return DESTINOS.find((d) => d.chave === chave) || DESTINOS[0];
}
