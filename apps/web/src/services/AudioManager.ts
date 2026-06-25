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
  // Real SFX files dropped in /public/audio/<type>.<ext> are preferred over the procedural
  // synthesis; missing ones fall back to generateSound so the game always has audio.
  private fileBuffers: Map<SoundType, AudioBuffer> = new Map();
  private filesProbed = false;

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
    // Browsers suspend the context when the tab is backgrounded / on mobile sleep (and iOS may create
    // it already suspended); scheduled sounds then silently never fire. Re-arm it on every access.
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
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

  private noiseSource(duration: number): AudioBufferSourceNode {
    const ctx = this.getContext();
    const src = ctx.createBufferSource();
    src.buffer = this.createNoiseBuffer(Math.max(0.02, duration));
    return src;
  }

  // One boot-on-ground footstep: a short low body thump + a gravelly bandpassed-noise crunch.
  private scheduleFootstep(at: number, vol: number, dest: AudioNode, idx: number): void {
    const ctx = this.getContext();
    const body = ctx.createOscillator();
    const bg = ctx.createGain();
    body.type = 'sine';
    const f0 = 95 + (idx % 2) * 16; // alternate left/right weight for a natural gait
    body.frequency.setValueAtTime(f0, at);
    body.frequency.exponentialRampToValueAtTime(46, at + 0.07);
    bg.gain.setValueAtTime(0.0001, at);
    bg.gain.exponentialRampToValueAtTime(vol * 0.5, at + 0.006);
    bg.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    body.connect(bg); bg.connect(dest);
    body.start(at); body.stop(at + 0.13);

    const n = this.noiseSource(0.09);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700 + (idx % 3) * 280;
    bp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, at);
    ng.gain.exponentialRampToValueAtTime(vol * 0.32, at + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    n.connect(bp); bp.connect(ng); ng.connect(dest);
    n.start(at); n.stop(at + 0.09);
  }

  // One metallic track-link clank (tank tracks slapping the ground).
  private scheduleClank(at: number, vol: number, dest: AudioNode, salt: number): void {
    const ctx = this.getContext();
    const n = this.noiseSource(0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900 + (salt % 5) * 130;
    bp.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    n.connect(bp); bp.connect(g); g.connect(dest);
    n.start(at); n.stop(at + 0.055);
  }

  // Realistic movement loop that lasts the whole glide: engine + tracks (tank), engine + tyre roll
  // (wheeled), boot footsteps (infantry), or rotor chop (air). Replaces the old one-shot beep/rumble.
  playMovement(profile: 'foot' | 'track' | 'wheel' | 'rotor', durationMs: number): void {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      const vol = this.masterVolume * this.sfxVolume;
      const dur = Math.max(0.3, Math.min(2.6, (durationMs || 400) / 1000));
      const t = ctx.currentTime;
      const stop = t + dur + 0.06;

      // soft limiter so the stacked layers never clip, then a global fade-in/out envelope
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.setValueAtTime(-9, t);
      comp.ratio.setValueAtTime(4, t);
      comp.attack.setValueAtTime(0.004, t);
      comp.release.setValueAtTime(0.15, t);
      comp.connect(ctx.destination);
      const fade = ctx.createGain();
      fade.gain.setValueAtTime(0.0001, t);
      fade.gain.exponentialRampToValueAtTime(1, t + 0.07);
      fade.gain.setValueAtTime(1, Math.max(t + 0.09, t + dur - 0.14));
      fade.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      fade.connect(comp);

      if (profile === 'track' || profile === 'wheel') {
        const isTrack = profile === 'track';
        const base = isTrack ? 46 : 72; // heavy diesel idle vs lighter, higher truck engine

        // diesel "chug" amplitude modulation that the engine oscillators pass through
        const am = ctx.createGain();
        am.gain.setValueAtTime(isTrack ? 0.55 : 0.7, t);
        const amLfo = ctx.createOscillator();
        amLfo.type = isTrack ? 'square' : 'sine';
        amLfo.frequency.setValueAtTime(isTrack ? 9 : 24, t);
        const amDepth = ctx.createGain();
        amDepth.gain.setValueAtTime(isTrack ? 0.45 : 0.3, t);
        amLfo.connect(amDepth); amDepth.connect(am.gain);
        amLfo.start(t); amLfo.stop(stop);

        const engineLp = ctx.createBiquadFilter();
        engineLp.type = 'lowpass';
        engineLp.frequency.setValueAtTime(isTrack ? 320 : 620, t);
        const engineGain = ctx.createGain();
        engineGain.gain.setValueAtTime(vol * (isTrack ? 0.34 : 0.27), t);
        am.connect(engineLp); engineLp.connect(engineGain); engineGain.connect(fade);

        // detuned sawtooth oscillators with a slow rev wobble = a thick engine tone
        [0, 0.6, 1.7].forEach((det, i) => {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(base + det, t);
          const rev = ctx.createOscillator();
          rev.type = 'sine';
          rev.frequency.setValueAtTime(0.6 + i * 0.25, t);
          const revDepth = ctx.createGain();
          revDepth.gain.setValueAtTime(base * 0.05, t);
          rev.connect(revDepth); revDepth.connect(o.frequency);
          const og = ctx.createGain();
          og.gain.setValueAtTime(1 / 3, t);
          o.connect(og); og.connect(am);
          o.start(t); o.stop(stop); rev.start(t); rev.stop(stop);
        });

        // sub-bass weight
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(isTrack ? 28 : 38, t);
        const subG = ctx.createGain();
        subG.gain.setValueAtTime(vol * (isTrack ? 0.2 : 0.13), t);
        sub.connect(subG); subG.connect(fade);
        sub.start(t); sub.stop(stop);

        if (isTrack) {
          // rhythmic metallic track clatter across the whole move
          const rate = 13;
          let k = 0;
          for (let ti = 0.02; ti < dur - 0.05; ti += 1 / rate) {
            const jitter = (Math.sin(ti * 91.7) * 0.5) / rate * 0.35;
            this.scheduleClank(t + ti + jitter, vol * 0.12, fade, k++);
          }
        } else {
          // tyre roll = steady low-passed noise
          const n = this.noiseSource(dur);
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.setValueAtTime(900, t);
          const g = ctx.createGain();
          g.gain.setValueAtTime(vol * 0.1, t);
          n.connect(lp); lp.connect(g); g.connect(fade);
          n.start(t); n.stop(stop);
        }
      } else if (profile === 'rotor') {
        // helicopter: a strong low "whomp-whomp" chop (noise gated by a low LFO) + a faint turbine whine
        const body = this.noiseSource(dur);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(440, t);
        const am = ctx.createGain();
        am.gain.setValueAtTime(vol * 0.2, t);
        const lfo = ctx.createOscillator();
        lfo.type = 'sawtooth';
        lfo.frequency.setValueAtTime(15, t);
        const lfoG = ctx.createGain();
        lfoG.gain.setValueAtTime(vol * 0.5, t);
        lfo.connect(lfoG); lfoG.connect(am.gain);
        body.connect(lp); lp.connect(am); am.connect(fade);
        body.start(t); body.stop(stop); lfo.start(t); lfo.stop(stop);

        const whine = ctx.createOscillator();
        whine.type = 'triangle';
        whine.frequency.setValueAtTime(960, t);
        const wg = ctx.createGain();
        wg.gain.setValueAtTime(vol * 0.045, t);
        whine.connect(wg); wg.connect(fade);
        whine.start(t); whine.stop(stop);
      } else {
        // infantry: a sequence of footsteps spread across the move duration
        const interval = 0.27;
        let i = 0;
        for (let ti = 0.0; ti < dur - 0.04; ti += interval) {
          this.scheduleFootstep(t + ti, vol * 0.55, fade, i++);
        }
      }
    } catch (e) {
      console.warn('Movement audio failed:', e);
    }
  }

  private async probeFiles(): Promise<void> {
    if (this.filesProbed) return;
    this.filesProbed = true;
    const ctx = this.getContext();
    const types: SoundType[] = ['gunshot', 'explosion', 'tankMove', 'infantry', 'hit', 'death', 'select', 'error', 'victory', 'defeat', 'move', 'turnStart', 'magic'];
    const exts = ['webm', 'mp3', 'ogg', 'wav'];
    await Promise.all(types.map(async (type) => {
      for (const ext of exts) {
        try {
          const res = await fetch(`/audio/${type}.${ext}`, { cache: 'force-cache' });
          if (!res.ok) continue;
          const ct = res.headers.get('content-type') ?? '';
          if (!ct.startsWith('audio/') && !ct.includes('octet-stream')) continue; // dev server 200s with html for misses
          const decoded = await ctx.decodeAudioData(await res.arrayBuffer());
          this.fileBuffers.set(type, decoded);
          return;
        } catch { /* try next extension */ }
      }
    }));
  }

  private playFile(type: SoundType): boolean {
    const buffer = this.fileBuffers.get(type);
    if (!buffer) return false;
    const ctx = this.getContext();
    // Infantry small-arms play as a rapid automatic burst (matches the visual tracer burst).
    const rounds = type === 'gunshot' ? 5 : 1;
    const gap = 0.07;
    for (let k = 0; k < rounds; k++) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      if (rounds > 1) src.playbackRate.value = 0.96 + ((k * 13) % 7) * 0.012; // tiny per-round pitch variation
      const gain = ctx.createGain();
      gain.gain.value = this.masterVolume * this.sfxVolume * (rounds > 1 ? 0.85 : 1);
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(ctx.currentTime + k * gap);
    }
    return true;
  }

  play(type: SoundType): void {
    if (!this.enabled) return;
    try {
      if (!this.filesProbed) void this.probeFiles();
      if (this.playFile(type)) return; // real SFX file if present
      this.generateSound(type); // otherwise procedural fallback
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

