/**
 * Audio Manager for Spellcross game
 * Handles all sound effects and music with rich procedural audio
 */

type SoundType = 'gunshot' | 'explosion' | 'tankMove' | 'infantry' | 'hit' | 'death' | 'select' | 'error' | 'victory' | 'defeat' | 'move' | 'turnStart' | 'magic';

class AudioManagerClass {
  private sounds: Map<SoundType, HTMLAudioElement[]> = new Map();
  private musicPlayer: HTMLAudioElement | null = null;
  private masterVolume: number = 0.7;
  private sfxVolume: number = 0.8;
  private musicVolume: number = 0.5;
  private enabled: boolean = true;
  private audioContext: AudioContext | null = null;

  constructor() {
    // Initialize audio context on first user interaction
    if (typeof window !== 'undefined') {
      const initAudio = () => {
        if (!this.audioContext) {
          this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        window.removeEventListener('click', initAudio);
        window.removeEventListener('keydown', initAudio);
      };
      window.addEventListener('click', initAudio);
      window.addEventListener('keydown', initAudio);
    }
  }

  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return this.audioContext;
  }

  // Create white noise buffer
  private createNoiseBuffer(duration: number): AudioBuffer {
    const ctx = this.getContext();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  // Play noise with envelope
  private playNoise(duration: number, volume: number, filterFreq: number = 2000, decay: number = 0.5): void {
    const ctx = this.getContext();
    const noise = ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(duration);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + duration * decay);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
  }

  // Generate rich procedural sounds using Web Audio API
  private generateSound(type: SoundType): void {
    const ctx = this.getContext();
    const volume = this.masterVolume * this.sfxVolume;
    const t = ctx.currentTime;

    switch (type) {
      case 'gunshot': {
        // Layered gunshot: attack transient + body + tail
        // 1. Sharp attack (click)
        const click = ctx.createOscillator();
        const clickGain = ctx.createGain();
        click.type = 'square';
        click.frequency.setValueAtTime(1500, t);
        click.frequency.exponentialRampToValueAtTime(200, t + 0.02);
        clickGain.gain.setValueAtTime(volume * 0.4, t);
        clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
        click.connect(clickGain);
        clickGain.connect(ctx.destination);
        click.start(t);
        click.stop(t + 0.03);

        // 2. Body (low thump)
        const body = ctx.createOscillator();
        const bodyGain = ctx.createGain();
        body.type = 'sawtooth';
        body.frequency.setValueAtTime(120, t);
        body.frequency.exponentialRampToValueAtTime(40, t + 0.1);
        bodyGain.gain.setValueAtTime(volume * 0.5, t);
        bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        body.connect(bodyGain);
        bodyGain.connect(ctx.destination);
        body.start(t);
        body.stop(t + 0.12);

        // 3. Noise burst
        this.playNoise(0.08, volume * 0.35, 4000, 0.3);
        break;
      }

      case 'explosion': {
        // Multi-layered explosion
        // 1. Initial boom
        const boom = ctx.createOscillator();
        const boomGain = ctx.createGain();
        boom.type = 'sine';
        boom.frequency.setValueAtTime(80, t);
        boom.frequency.exponentialRampToValueAtTime(20, t + 0.4);
        boomGain.gain.setValueAtTime(volume * 0.8, t);
        boomGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        boom.connect(boomGain);
        boomGain.connect(ctx.destination);
        boom.start(t);
        boom.stop(t + 0.5);

        // 2. Crackle layer
        const crackle = ctx.createOscillator();
        const crackleGain = ctx.createGain();
        crackle.type = 'sawtooth';
        crackle.frequency.setValueAtTime(200, t);
        crackle.frequency.exponentialRampToValueAtTime(30, t + 0.3);
        crackleGain.gain.setValueAtTime(volume * 0.4, t + 0.02);
        crackleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        crackle.connect(crackleGain);
        crackleGain.connect(ctx.destination);
        crackle.start(t);
        crackle.stop(t + 0.35);

        // 3. Heavy noise
        this.playNoise(0.6, volume * 0.6, 3000, 0.7);
        break;
      }

      case 'tankMove': {
        // Engine rumble with tracks
        const engine = ctx.createOscillator();
        const engineGain = ctx.createGain();
        engine.type = 'sawtooth';
        engine.frequency.setValueAtTime(35, t);
        engine.frequency.setValueAtTime(42, t + 0.1);
        engine.frequency.setValueAtTime(38, t + 0.2);
        engineGain.gain.setValueAtTime(volume * 0.25, t);
        engineGain.gain.linearRampToValueAtTime(volume * 0.3, t + 0.15);
        engineGain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        engine.connect(engineGain);
        engineGain.connect(ctx.destination);
        engine.start(t);
        engine.stop(t + 0.4);

        // Track clatter
        this.playNoise(0.3, volume * 0.15, 800, 0.8);
        break;
      }

      case 'move': {
        // Footsteps/movement
        const step = ctx.createOscillator();
        const stepGain = ctx.createGain();
        step.type = 'sine';
        step.frequency.setValueAtTime(100, t);
        step.frequency.exponentialRampToValueAtTime(60, t + 0.08);
        stepGain.gain.setValueAtTime(volume * 0.2, t);
        stepGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        step.connect(stepGain);
        stepGain.connect(ctx.destination);
        step.start(t);
        step.stop(t + 0.1);

        this.playNoise(0.06, volume * 0.1, 600, 0.5);
        break;
      }

      case 'select': {
        // Pleasant UI blip
        const blip1 = ctx.createOscillator();
        const blip1Gain = ctx.createGain();
        blip1.type = 'sine';
        blip1.frequency.setValueAtTime(600, t);
        blip1.frequency.exponentialRampToValueAtTime(900, t + 0.06);
        blip1Gain.gain.setValueAtTime(volume * 0.25, t);
        blip1Gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        blip1.connect(blip1Gain);
        blip1Gain.connect(ctx.destination);
        blip1.start(t);
        blip1.stop(t + 0.1);

        // Harmonic
        const blip2 = ctx.createOscillator();
        const blip2Gain = ctx.createGain();
        blip2.type = 'sine';
        blip2.frequency.setValueAtTime(1200, t);
        blip2Gain.gain.setValueAtTime(volume * 0.1, t);
        blip2Gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        blip2.connect(blip2Gain);
        blip2Gain.connect(ctx.destination);
        blip2.start(t);
        blip2.stop(t + 0.08);
        break;
      }

      case 'error': {
        // Harsh buzz
        const buzz1 = ctx.createOscillator();
        const buzz1Gain = ctx.createGain();
        buzz1.type = 'square';
        buzz1.frequency.setValueAtTime(180, t);
        buzz1Gain.gain.setValueAtTime(volume * 0.25, t);
        buzz1Gain.gain.setValueAtTime(0.001, t + 0.1);
        buzz1Gain.gain.setValueAtTime(volume * 0.25, t + 0.12);
        buzz1Gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        buzz1.connect(buzz1Gain);
        buzz1Gain.connect(ctx.destination);
        buzz1.start(t);
        buzz1.stop(t + 0.22);

        const buzz2 = ctx.createOscillator();
        const buzz2Gain = ctx.createGain();
        buzz2.type = 'square';
        buzz2.frequency.setValueAtTime(140, t);
        buzz2Gain.gain.setValueAtTime(volume * 0.15, t);
        buzz2Gain.gain.setValueAtTime(0.001, t + 0.1);
        buzz2Gain.gain.setValueAtTime(volume * 0.15, t + 0.12);
        buzz2Gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        buzz2.connect(buzz2Gain);
        buzz2Gain.connect(ctx.destination);
        buzz2.start(t);
        buzz2.stop(t + 0.22);
        break;
      }

      case 'hit': {
        // Impact sound
        const impact = ctx.createOscillator();
        const impactGain = ctx.createGain();
        impact.type = 'triangle';
        impact.frequency.setValueAtTime(400, t);
        impact.frequency.exponentialRampToValueAtTime(80, t + 0.12);
        impactGain.gain.setValueAtTime(volume * 0.5, t);
        impactGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        impact.connect(impactGain);
        impactGain.connect(ctx.destination);
        impact.start(t);
        impact.stop(t + 0.15);

        this.playNoise(0.1, volume * 0.25, 2500, 0.4);
        break;
      }

      case 'death': {
        // Dramatic death sound
        const fall = ctx.createOscillator();
        const fallGain = ctx.createGain();
        fall.type = 'sawtooth';
        fall.frequency.setValueAtTime(500, t);
        fall.frequency.exponentialRampToValueAtTime(40, t + 0.5);
        fallGain.gain.setValueAtTime(volume * 0.4, t);
        fallGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        fall.connect(fallGain);
        fallGain.connect(ctx.destination);
        fall.start(t);
        fall.stop(t + 0.5);

        // Thud
        const thud = ctx.createOscillator();
        const thudGain = ctx.createGain();
        thud.type = 'sine';
        thud.frequency.setValueAtTime(60, t + 0.2);
        thud.frequency.exponentialRampToValueAtTime(30, t + 0.4);
        thudGain.gain.setValueAtTime(0, t);
        thudGain.gain.setValueAtTime(volume * 0.4, t + 0.2);
        thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        thud.connect(thudGain);
        thudGain.connect(ctx.destination);
        thud.start(t);
        thud.stop(t + 0.45);
        break;
      }

      case 'victory': {
        // Triumphant fanfare
        const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t + i * 0.12);
          gain.gain.setValueAtTime(0, t);
          gain.gain.setValueAtTime(volume * 0.3, t + i * 0.12);
          gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.4);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t + i * 0.12);
          osc.stop(t + i * 0.12 + 0.4);
        });
        break;
      }

      case 'defeat': {
        // Sad descending tones
        const notes = [392, 349, 311, 262]; // G4, F4, Eb4, C4
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t + i * 0.2);
          gain.gain.setValueAtTime(0, t);
          gain.gain.setValueAtTime(volume * 0.25, t + i * 0.2);
          gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.2 + 0.5);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t + i * 0.2);
          osc.stop(t + i * 0.2 + 0.5);
        });
        break;
      }

      case 'turnStart': {
        // Attention chime
        const chime = ctx.createOscillator();
        const chimeGain = ctx.createGain();
        chime.type = 'sine';
        chime.frequency.setValueAtTime(880, t);
        chimeGain.gain.setValueAtTime(volume * 0.2, t);
        chimeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        chime.connect(chimeGain);
        chimeGain.connect(ctx.destination);
        chime.start(t);
        chime.stop(t + 0.3);

        const chime2 = ctx.createOscillator();
        const chime2Gain = ctx.createGain();
        chime2.type = 'sine';
        chime2.frequency.setValueAtTime(1320, t + 0.08);
        chime2Gain.gain.setValueAtTime(volume * 0.15, t + 0.08);
        chime2Gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        chime2.connect(chime2Gain);
        chime2Gain.connect(ctx.destination);
        chime2.start(t + 0.08);
        chime2.stop(t + 0.35);
        break;
      }

      case 'magic': {
        // Mystical shimmer
        for (let i = 0; i < 5; i++) {
          const shimmer = ctx.createOscillator();
          const shimmerGain = ctx.createGain();
          shimmer.type = 'sine';
          const baseFreq = 600 + Math.random() * 400;
          shimmer.frequency.setValueAtTime(baseFreq, t + i * 0.05);
          shimmer.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, t + i * 0.05 + 0.2);
          shimmerGain.gain.setValueAtTime(volume * 0.12, t + i * 0.05);
          shimmerGain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.05 + 0.25);
          shimmer.connect(shimmerGain);
          shimmerGain.connect(ctx.destination);
          shimmer.start(t + i * 0.05);
          shimmer.stop(t + i * 0.05 + 0.25);
        }
        break;
      }

      default: {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, t);
        gain.gain.setValueAtTime(volume * 0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.1);
      }
    }
  }

  play(type: SoundType): void {
    if (!this.enabled) return;
    try {
      this.generateSound(type);
    } catch (e) {
      console.warn('Audio play failed:', e);
    }
  }

  setMasterVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
  }

  setSfxVolume(vol: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, vol));
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

export const AudioManager = new AudioManagerClass();
export type { SoundType };

