import type { DirectorPhase, SimEvent } from '../sim/types';

/**
 * 소리 (Web Audio로 합성 — 음원 파일 없음, 라이선스 없음).
 *  - 북소리: 디렉터 BPM을 그대로 소리로. 저음 사인이 110 → 42Hz로 떨어지는 '둥' + 짧은 잡음 '탁'.
 *    '둥-둥' 강약 2박, 먼 북은 저역 필터로 뭉개고 가까운 북은 열어 준다. 동굴 잔향(합성 임펄스).
 *  - 저음 드론(바람·광산의 웅웅거림), 휘두르기·타격·돌의 감각 효과음.
 *  - 공간 음향 (계획서 12장 "소리는 두 번째 시야"): 자리가 있는 사건(적의 휘두르기·경계·활·타격 등)은 HRTF 패너를 거쳐
 *    카메라 기준 방향·거리로 들린다. 자리가 없는 사건(플레이어 피격·구매·레벨업)은 그대로 가운데.
 * 브라우저 자동재생 정책: 첫 클릭(start)에서 resume() 해야 소리가 난다.
 * 예약은 오디오 시계 기준 '앞질러 예약'(lookahead) — setTimeout 흔들림이 박자에 새지 않는다.
 */
export type At = { x: number; y: number; z: number };

/**
 * 방 크기 → 잔향 양 0..1 (계획서 12장: 넓은 홀에만 리버브, 좁은 통로는 드라이).
 * 방 상자의 좁은 쪽 가로 폭으로 정한다 — 통로·계단(3~6m)은 0, 폭 26m 이상 홀은 1.
 * ponytail: 상자 폭만 본다 (천장 높이·바깥 공간 구분 없음) — 서문 밖처럼 하늘이 열린 곳도 벽 사이로 울린다
 */
export function roomReverb(room: { min: readonly number[]; max: readonly number[] }): number {
  const narrow = Math.min(room.max[0]! - room.min[0]!, room.max[2]! - room.min[2]!);
  return Math.max(0, Math.min(1, (narrow - 6) / 20));
}

export function createAudio() {
  let ctx: AudioContext | null = null;
  let master: GainNode;
  let wet: GainNode;
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
    wet = c.createGain();
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

  function burst(freq: number, q: number, dur: number, gain: number, sweepTo?: number, out: AudioNode = sfx) {
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
    n.connect(f).connect(g).connect(out);
    n.start(t);
    n.stop(t + dur + 0.02);
  }

  function tone(freq: number, dur: number, gain: number, out: AudioNode = sfx, glideTo?: number) {
    const c = ctx!;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** 한 사건용 패너 (소리가 끝나면 노드가 함께 버려진다). 거리 3m까지는 그대로, 그 뒤로 점점 작아진다 */
  function place(at: At): AudioNode {
    const p = new PannerNode(ctx!, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 3, rolloffFactor: 1.2, positionX: at.x, positionY: at.y, positionZ: at.z });
    p.connect(sfx);
    return p;
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
    /** 매 렌더 프레임: 듣는 자리 = 카메라 (위치·앞 방향) */
    listen(px: number, py: number, pz: number, fx: number, fy: number, fz: number) {
      if (!ctx || ctx.state !== 'running') return;
      const l = ctx.listener;
      const t = ctx.currentTime;
      if (l.positionX) {
        l.positionX.setValueAtTime(px, t);
        l.positionY.setValueAtTime(py, t);
        l.positionZ.setValueAtTime(pz, t);
        l.forwardX.setValueAtTime(fx, t);
        l.forwardY.setValueAtTime(fy, t);
        l.forwardZ.setValueAtTime(fz, t);
      } else {
        // Firefox 옛 판: AudioParam 대신 메서드만 있다
        l.setPosition(px, py, pz);
        l.setOrientation(fx, fy, fz, 0, 1, 0);
      }
    },
    /** 지금 방의 잔향 양 0..1 (roomReverb). 방을 옮기면 1초쯤에 걸쳐 바뀐다 */
    space(amount: number) {
      if (!ctx || ctx.state !== 'running') return;
      wet.gain.setTargetAtTime(0.06 + amount * 0.54, ctx.currentTime, 0.4);
    },
    /** at: 사건이 난 자리 (없으면 가운데에서 들린다) */
    event(ev: SimEvent, at?: At | null) {
      if (!ctx || ctx.state !== 'running') return;
      const out = at ? place(at) : sfx;
      if (ev.type === 'swing') burst(ev.actor < 0 ? 900 : 700, 1.2, 0.16, ev.actor < 0 ? 0.5 : 0.45, 2200, out);
      else if (ev.type === 'hit') {
        burst(180, 0.8, 0.12, 0.9, undefined, out);
        tone(ev.heavy ? 70 : 95, 0.18, 0.5, out);
      } else if (ev.type === 'alert') {
        // 고블린이 알아챘다: 짧게 갈라지는 외침 — 어둠 속에서 어느 쪽인지 귀로 안다
        burst(1100, 2.5, 0.28, 0.7, 600, out);
        tone(330, 0.25, 0.18, out, 220);
      } else if (ev.type === 'death') {
        burst(500, 1, 0.4, 0.5, 120, out);
        tone(180, 0.4, 0.2, out, 80);
      } else if (ev.type === 'block' || ev.type === 'guardBreak') {
        tone(ev.type === 'block' ? 520 : 260, 0.3, 0.3, out);
        burst(2200, 2, 0.06, 0.5, undefined, out);
      } else if (ev.type === 'pickup') {
        if (ev.kind === 'gold') for (const [i, f] of [1760, 2350].entries()) setTimeout(() => tone(f, 0.18, 0.12), i * 60);
        else if (ev.kind !== 'full') tone(ev.kind === 'mithril' ? 1480 : 660 + ev.grade * 110, 0.5, 0.15);
      } else if (ev.type === 'gear') {
        if (ev.what === 'drink') tone(300, 0.35, 0.25, sfx, 180); // 꿀꺽
        else if (ev.what === 'buy') tone(1760, 0.2, 0.12);
        else if (ev.what === 'upgrade') {
          tone(880, 0.3, 0.3);
          burst(2600, 3, 0.1, 0.5);
        } else burst(1200, 1.5, 0.08, 0.3); // 장착·해제·버리기: 쇠붙이 덜컥
      } else if (ev.type === 'levelUp' || ev.type === 'page') {
        for (const [i, f] of (ev.type === 'levelUp' ? [392, 494, 587] : [523, 659]).entries()) setTimeout(() => tone(f, 0.9, 0.12), i * 120);
      } else if (ev.type === 'playerHit') {
        burst(120, 0.7, 0.2, 1);
        tone(60, 0.25, 0.6);
      } else if (ev.type === 'parry') {
        tone(1320, 0.5, 0.25);
        tone(1980, 0.35, 0.12);
        burst(3000, 3, 0.08, 0.4);
      } else if (ev.type === 'door') {
        // 돌문이 끌리는 낮은 울림
        burst(70, 0.6, 2.6, 0.9, 40, out);
        tone(46, 2.4, 0.35, out);
      } else if (ev.type === 'slam') {
        // 땅이 울린다
        tone(38, 0.9, 0.9, out);
        burst(160, 0.6, 0.7, 1, 50, out);
      } else if (ev.type === 'pillar') {
        burst(400, 0.5, 1.8, 0.9, 80, out); // 돌이 무너져 내리는 소리
        tone(52, 1.2, 0.5, out);
      } else if (ev.type === 'shoot') {
        tone(640, 0.12, 0.35, out); // 시위 튕기는 소리
        burst(2400, 2, 0.12, 0.45, 900, out);
      } else if (ev.type === 'arrowStuck') {
        burst(500, 2, 0.07, 0.4, undefined, out);
      } else if (ev.type === 'whistle') {
        tone(1560, 0.5, 0.18, out);
        tone(1980, 0.4, 0.12, out);
      } else if (ev.type === 'crack') {
        burst(260, 1.2, 0.25, 0.7, 120); // 돌이 갈라지는 둔탁한 소리
      } else if (ev.type === 'collapse') {
        if (ev.stage === 'fall') burst(300, 0.5, 1.6, 0.7, 70);
        else if (ev.stage === 'impact') {
          tone(34, 1.4, 1);
          burst(140, 0.5, 1.4, 1, 45);
        }
      } else if (ev.type === 'companion') {
        // 곤도르의 뿔나팔 (두 음이 겹친 긴 저음)
        tone(147, 1.3, 0.35);
        tone(220, 1.1, 0.2);
        burst(900, 1.5, 0.3, 0.4, 400);
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
