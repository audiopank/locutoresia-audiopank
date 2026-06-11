import { useRef, useCallback } from 'react';

export interface AudioEffectsSettings {
  reverb: number;
  delay: number;
  compressor: number;
  eq: number[];
  nectar: boolean;
}

export const defaultEffects: AudioEffectsSettings = {
  reverb: 0,
  delay: 0,
  compressor: 0,
  eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  nectar: false,
};

export const useAudioEffects = (audioContext?: AudioContext | null) => {
  const audioNodesRef = useRef<Map<string, any>>(new Map());
  const analysersRef = useRef<Map<string, AnalyserNode>>(new Map());

  const setupEffectsChain = useCallback((trackId: string, audioElement: HTMLAudioElement) => {
    if (!audioContext) return;

    // Create audio nodes
    const source = audioContext.createMediaElementSource(audioElement);
    const gainNode = audioContext.createGain();
    const analyser = audioContext.createAnalyser();
    
    // Configure analyser
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    
    // Connect nodes
    source.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(audioContext.destination);
    
    // Store references
    audioNodesRef.current.set(trackId, {
      source,
      gainNode,
      analyser
    });
    
    analysersRef.current.set(trackId, analyser);
  }, [audioContext]);

  const updateEffects = useCallback((trackId: string, effects: AudioEffectsSettings, volume: number, pan: number = 0) => {
    const nodes = audioNodesRef.current.get(trackId);
    if (!nodes || !audioContext) return;

    // Update volume
    if (nodes.gainNode) {
      const gainValue = (volume / 100) * Math.sqrt(2);
      nodes.gainNode.gain.setValueAtTime(gainValue, audioContext.currentTime);
    }

    // TODO: Add reverb, delay, compressor effects
    console.log('Effects updated for track:', trackId, effects);
  }, [audioContext]);

  const getAnalyser = useCallback((trackId: string) => {
    return analysersRef.current.get(trackId);
  }, []);

  const setCompressorEnabled = useCallback((trackId: string, enabled: boolean) => {
    console.log('Compressor', enabled ? 'enabled' : 'disabled', 'for track:', trackId);
    // TODO: Implement compressor
  }, []);

  const updateEQ10Band = useCallback((trackId: string, eqSettings: number[]) => {
    console.log('EQ 10 Band updated for track:', trackId, eqSettings);
    // TODO: Implement 10-band EQ
  }, []);

  return {
    setupEffectsChain,
    updateEffects,
    getAnalyser,
    setCompressorEnabled,
    updateEQ10Band,
    getCompressor: (trackId: string) => audioNodesRef.current.get(trackId)?.compressorNode
  };
};
