import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AudioManagerClass,
  ambienceProfileFor,
  movementSoundDurationSeconds,
  movementSoundProfileFor,
  narrativeSoundTypeForOutcome,
  normalizeAmbienceTheme
} from './AudioManager.js';

class FakeAudioParam {
  value = 0;

  setValueAtTime(value: number) { this.value = value; return this; }
  exponentialRampToValueAtTime(value: number) { this.value = value; return this; }
  linearRampToValueAtTime(value: number) { this.value = value; return this; }
  cancelScheduledValues() { return this; }
}

class FakeAudioNode {
  disconnected = false;

  connect(destination: unknown) { return destination; }
  disconnect() { this.disconnected = true; }
}

class FakeSourceNode extends FakeAudioNode {
  started = 0;
  stopped = 0;
  buffer: unknown = null;
  loop = false;
  playbackRate = new FakeAudioParam();

  start() { this.started += 1; }
  stop() { this.stopped += 1; }
}

class FakeOscillatorNode extends FakeSourceNode {
  type = 'sine';
  frequency = new FakeAudioParam();
  detune = new FakeAudioParam();
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam();
}

class FakeBiquadNode extends FakeAudioNode {
  type = 'lowpass';
  frequency = new FakeAudioParam();
  Q = new FakeAudioParam();
}

class FakeCompressorNode extends FakeAudioNode {
  threshold = new FakeAudioParam();
  knee = new FakeAudioParam();
  ratio = new FakeAudioParam();
  attack = new FakeAudioParam();
  release = new FakeAudioParam();
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 100;
  state: AudioContextState = 'running';
  destination = new FakeAudioNode();
  nodes: FakeAudioNode[] = [];
  sources: FakeSourceNode[] = [];
  resumeAttempts = 0;

  private remember<T extends FakeAudioNode>(node: T) {
    this.nodes.push(node);
    if (node instanceof FakeSourceNode) this.sources.push(node);
    return node;
  }

  createGain() { return this.remember(new FakeGainNode()); }
  createBiquadFilter() { return this.remember(new FakeBiquadNode()); }
  createOscillator() { return this.remember(new FakeOscillatorNode()); }
  createBufferSource() { return this.remember(new FakeSourceNode()); }
  createDynamicsCompressor() { return this.remember(new FakeCompressorNode()); }
  createStereoPanner() {
    const node = this.remember(new FakeAudioNode()) as FakeAudioNode & { pan: FakeAudioParam };
    node.pan = new FakeAudioParam();
    return node;
  }
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  decodeAudioData() { return Promise.reject(new Error('No fixture audio')); }
  resume() {
    this.resumeAttempts += 1;
    return Promise.resolve();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('movement sound profiles', () => {
  it('uses wheeled diesel movement for battlefield support vehicles', () => {
    expect(movementSoundProfileFor('support', 'supply-truck')).toBe('wheel');
    expect(movementSoundProfileFor('support', 'horizon-radar')).toBe('wheel');
  });

  it('keeps tracks, rotors and foot crews distinct', () => {
    expect(movementSoundProfileFor('vehicle', 'm113')).toBe('track');
    expect(movementSoundProfileFor('artillery', 'thunderhead-155')).toBe('track');
    expect(movementSoundProfileFor('air', 'cerberus-gunship')).toBe('rotor');
    expect(movementSoundProfileFor('artillery', 'mortar-team')).toBe('foot');
  });

  it('covers a full eight-step supply run instead of cutting off after 2.6 seconds', () => {
    expect(movementSoundDurationSeconds(8 * 420)).toBe(3.36);
    expect(movementSoundDurationSeconds(20_000)).toBe(8);
  });
});

describe('operation audio dramaturgy', () => {
  it('keeps all four campaign moods sonically distinct', () => {
    const frontline = ambienceProfileFor('frontline');
    const siege = ambienceProfileFor('siege');
    const night = ambienceProfileFor('night');
    const rift = ambienceProfileFor('rift');

    expect(new Set([frontline.root, siege.root, night.root, rift.root])).toHaveLength(4);
    expect(siege.pulse).toBeGreaterThan(frontline.pulse);
    expect(night.cutoff).toBeLessThan(frontline.cutoff);
    expect(rift.harmony).not.toEqual(frontline.harmony);
  });

  it('uses dedicated debrief cues instead of the generic result fanfares', () => {
    expect(narrativeSoundTypeForOutcome('victory')).toBe('debriefVictory');
    expect(narrativeSoundTypeForOutcome('defeat')).toBe('debriefDefeat');
  });

  it('falls back to the frontline profile for missing or unknown operation themes', () => {
    expect(normalizeAmbienceTheme(undefined)).toBe('frontline');
    expect(normalizeAmbienceTheme('unknown-theme')).toBe('frontline');
    expect(ambienceProfileFor(undefined)).toEqual(ambienceProfileFor('frontline'));
    expect(ambienceProfileFor('unknown-theme')).toEqual(ambienceProfileFor('frontline'));
  });

  it('stops and disconnects the previous ambience before starting a new theme', () => {
    const context = new FakeAudioContext();
    const manager = new AudioManagerClass(context as unknown as AudioContext);

    manager.startAmbience('frontline');
    const firstGraph = [...context.nodes];
    const firstSources = [...context.sources];
    expect(firstSources.length).toBeGreaterThan(0);

    manager.startAmbience('siege');
    expect(firstSources.every((source) => source.stopped === 1)).toBe(true);
    expect(firstGraph.every((node) => node.disconnected)).toBe(true);
    expect(manager.getPresentationState().ambience).toEqual({ theme: 'siege', weather: 'clear' });

    const secondGraph = context.nodes.slice(firstGraph.length);
    const secondSources = context.sources.slice(firstSources.length);
    manager.stopAmbience();
    expect(secondSources.every((source) => source.stopped === 1)).toBe(true);
    expect(secondGraph.every((node) => node.disconnected)).toBe(true);
    expect(manager.getPresentationState().ambience).toBeNull();
  });

  it('does not accumulate live ambience nodes across repeated battles and theme switches', () => {
    const context = new FakeAudioContext();
    const manager = new AudioManagerClass(context as unknown as AudioContext);
    const themes = ['frontline', 'siege', 'night', 'rift', 'missing-theme'];

    for (let battle = 0; battle < 20; battle += 1) {
      manager.startAmbience(themes[battle % themes.length]);
      manager.stopAmbience();
    }

    expect(context.sources.every((source) => source.started === 1 && source.stopped === 1)).toBe(true);
    expect(context.nodes.every((node) => node.disconnected)).toBe(true);
    expect(manager.getPresentationState().ambience).toBeNull();
  });

  it('keeps planner cues fire-and-forget when browser audio is suspended or disabled', async () => {
    const suspendedContext = new FakeAudioContext();
    suspendedContext.state = 'suspended';
    suspendedContext.resume = () => {
      suspendedContext.resumeAttempts += 1;
      return Promise.reject(new Error('User gesture required'));
    };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No fixture audio')));
    const manager = new AudioManagerClass(suspendedContext as unknown as AudioContext);

    expect(() => manager.play('briefing')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(suspendedContext.resumeAttempts).toBeGreaterThan(0);
    expect(manager.getPresentationState().narrativeCue).toBe('briefing');

    const disabledContext = new FakeAudioContext();
    const disabledManager = new AudioManagerClass(disabledContext as unknown as AudioContext);
    disabledManager.setEnabled(false);
    expect(() => disabledManager.play('briefing')).not.toThrow();
    expect(disabledContext.nodes).toHaveLength(0);
  });
});
