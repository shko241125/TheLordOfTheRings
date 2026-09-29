import type { DirectorPhase, SimEvent } from '../sim/types';

/**
 * 소리 (Web Audio로 합성 — 음원 파일 없음, 라이선스 없음).
 *  - 북소리: 디렉터 BPM을 그대로 소리로. 저음 사인이 110 → 42Hz로 떨어지는 '둥' + 짧은 잡음 '탁'.
 *    '둥-둥' 강약 2박, 먼 북은 저역 필터로 뭉개고 가까운 북은 열어 준다. 동굴 잔향(합성 임펄스).
 *  - 저음 드론(바람·광산의 웅웅거림), 휘두르기·타격·돌의 감각 효과음.
 * 브라우저 자동재생 정책: 첫 클릭(start)에서 resume() 해야 소리가 난다.
 * 예약은 오디오 시계 기준 '앞질러 예약'(lookahead) — setTimeout 흔들림이 박자에 새지 않는다.
 */
export function createAudio() {
  let ctx: AudioContext | null = null;
  let master: GainNode;
  let drumBus: GainNode;
  let drumFilter: BiquadFilterNode;
  let sfx: GainNode;
  let nextBeat = 0;
  let beatIndex = 0;
  let bpm = 0;
  let phase: DirectorPhase = 'relax';
  let noise: AudioBuffer;
  let onBeat: ((strong: boolean) => void) | null = null;

  function impulse(c: AudioContext, seconds: number, decay: number) {
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  function init() {
    const c = new AudioContext();
    ctx = c;
    master = c.createGain();
    master.gain.value = 0.8;
    const verb = c.createConvolver();
    verb.buffer = impulse(c, 3.2, 2.6); // 넓은 석실의 긴 잔향
    const wet = c.createGain();
    wet.gain.value = 0.45;
    verb.connect(wet).connect(master);
    master.connect(c.destination);

    drumFilter = c.createBiquadFilter();
    drumFilter.type = 'lowpass';
    drumFilter.frequency.value = 300;
    drumBus = c.createGain();
    drumBus.gain.value = 0;
    drumBus.connect(drumFilter);
    drumFilter.connect(master);
    drumFilter.connect(verb);

    sfx = c.createGain();
    sfx.gain.value = 0.7;
    sfx.connect(master);
    sfx.connect(verb);

    noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // 드론: 살짝 어긋난 두 저음 + 걸러 낸 바람 잡음
    const drone = c.createGain();
    drone.gain.value = 0.05;
    drone.connect(master);
    for (const f of [55, 55.6, 82.4]) {
      const o = c.createOscillator();
      o.frequency.value = f;
      o.connect(drone);
      o.start();
    }
    const wind = c.createBufferSource();
    wind.buffer = noise;
    wind.loop = true;
    const wf = c.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 220;
    wf.Q.value = 0.6;
    const wg = c.createGain();
    wg.gain.value = 0.035;
    wind.connect(wf).connect(wg).connect(master);
    wind.start();
    nextBeat = c.currentTime + 0.1;
  }

  function drum(t: number, strong: boolean) {
    const c = ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(strong ? 110 : 95, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.35);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(strong ? 1 : 0.6, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(g).connect(drumBus);
    o.start(t);
    o.stop(t + 1.2);
    // 가죽 치는 소리
    const n = c.createBufferSource();
    n.buffer = noise;
    const nf = c.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 500;
    const ng = c.createGain();
    ng.gain.setValueAtTime(strong ? 0.5 : 0.3, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    n.connect(nf).connect(ng).connect(drumBus);
    n.start(t);
    n.stop(t + 0.1);
  }

  function burst(freq: number, q: number, dur: number, gain: number, sweepTo?: number) {
    const c = ctx!;
    const t = c.currentTime;
    const n = c.createBufferSource();
    n.buffer = noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(sfx);
    n.start(t);
    n.stop(t + dur + 0.02);
  }

  function tone(freq: number, dur: number, gain: number) {
    const c = ctx!;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  return {
    /** 사용자 클릭 안에서 호출 (자동재생 정책) */
    async unlock() {
      if (!ctx) init();
      if (ctx!.state !== 'running') await ctx!.resume();
    },
    get running() {
      return ctx?.state === 'running';
    },
    onBeat(cb: (strong: boolean) => void) {
      onBeat = cb;
    },
    /** 매 렌더 프레임: 디렉터 상태 → 북 템포·거리감, 앞질러 예약 */
    update(directorBpm: number, directorPhase: DirectorPhase) {
      if (!ctx || ctx.state !== 'running') return;
      bpm = directorBpm;
      phase = directorPhase;
      const t = ctx.currentTime;
      // 거리감: 고조 = 멀리서(뭉갠 소리, 작게) → 절정 = 가까이(열린 소리, 크게)
      const near = phase === 'peak' ? 1 : phase === 'warn' ? 0.7 : phase === 'buildup' ? 0.3 : phase === 'fade' ? 0.35 : 0;
      drumBus.gain.setTargetAtTime(bpm > 0 ? 0.25 + near * 0.75 : 0, t, 0.8);
      drumFilter.frequency.setTargetAtTime(250 + near * 1400, t, 0.8);
      if (bpm <= 0) {
        nextBeat = t + 0.1;
        return;
      }
      const interval = 60 / bpm;
      while (nextBeat < t + 0.2) {
        const strong = beatIndex % 2 === 0;
        drum(nextBeat, strong);
        if (onBeat && phase === 'peak') {
          const delay = Math.max(0, (nextBeat - t) * 1000);
          setTimeout(() => onBeat?.(strong), delay);
        }
        beatIndex++;
        nextBeat += interval;
      }
    },
    event(ev: SimEvent) {
      if (!ctx || ctx.state !== 'running') return;
      if (ev.type === 'swing') burst(ev.actor < 0 ? 900 : 700, 1.2, 0.16, ev.actor < 0 ? 0.5 : 0.25, 2200);
      else if (ev.type === 'hit') {
        burst(180, 0.8, 0.12, 0.9);
        tone(ev.heavy ? 70 : 95, 0.18, 0.5);
      } else if (ev.type === 'playerHit') {
        burst(120, 0.7, 0.2, 1);
        tone(60, 0.25, 0.6);
      } else if (ev.type === 'parry') {
        tone(1320, 0.5, 0.25);
        tone(1980, 0.35, 0.12);
        burst(3000, 3, 0.08, 0.4);
      } else if (ev.type === 'door') {
        // 돌문이 끌리는 낮은 울림
        burst(70, 0.6, 2.6, 0.9, 40);
        tone(46, 2.4, 0.35);
      } else if (ev.type === 'rest') {
        burst(600, 0.7, 0.9, ev.first ? 0.6 : 0.25, 200); // 불이 확 붙는 소리
        tone(ev.first ? 196 : 220, 1.6, 0.12);
      } else if (ev.type === 'sense') {
        // 돌을 두드리는 '톡' + 길게 울리는 공명
        burst(1400, 4, 0.05, 0.8);
        tone(420, 1.8, 0.2);
        tone(630, 1.4, 0.1);
      }
    },
  };
}
