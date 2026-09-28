# 모리아의 그림자 (M1 — 전투 코어)

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 단위·이동 테스트 + 결정성 회귀 테스트
npm run build        # 타입 검사 + 프로덕션 빌드
```

## 조작

| 동작 | 키보드·마우스 | 게임패드 |
| --- | --- | --- |
| 이동 | WASD | 왼쪽 스틱 (반 기울기 = 걷기) |
| 시점 | 마우스 (클릭해서 잠금, Esc 해제) | 오른쪽 스틱 |
| 질주 / 회피 | Space 길게 / 짧게 | B 길게 / 짧게 |
| 웅크리기 | C (토글) | L3 |
| 약공격 (4타 콤보) / 강공격 (누르고 있다 떼기) | 좌클릭 / 우클릭 | X / Y |
| 패링 | Shift | LB |
| 락온 | 휠 클릭 | R3 |
| 횃불 내려놓기·줍기·예비 켜기 / 던지기 | F 짧게 / 길게 | 십자키 위 짧게 / 길게 |
| 돌의 감각(음파, 8초 재사용) | V | 십자키 아래 |
| 다시 시작 (쓰러졌을 때) | R | — |

`?shake=0` — 화면 흔들림 끄기 (접근성)

## URL 옵션

- `?class=human|dwarf|elf` — 클래스 (키·속도·복장이 다르다)
- `?rig=ual|kaykit` — 캐릭터 에셋 비교 (기본 ual: 사실적 비율 / kaykit: SD 비율)
- `?backend=webgl` — WebGL2 폴백 강제

## 구조

- `src/core` — 고정 60Hz 루프, 시드 난수, 결정적 삼각함수·atan2, 입력(키보드·마우스·게임패드)
- `src/sim` — 결정적 시뮬레이션 (three.js·DOM 의존 없음, Node에서 실행 가능)
  - `player.ts` 이동·행동(콤보·강공격·회피·패링·스태미나·입력 버퍼·락온), `combat.ts` 수치·판정
  - `enemy.ts` 고블린 AI(순찰→의심→추격→공전⇄공격, 공격 토큰 2), `perception.ts` 빛·소음 감지 필드
  - `torch.ts` 횃불 들기·내려놓기·던지기, `nav.ts` navcat 내비메시·경로, `move.ts` Rapier KCC 공용 이동
- `src/render` — 렌더러, 씬, 카메라(락온·흔들림), 캐릭터(`character.ts`), 애니메이션(`locomotion.ts` 이동+행동 레이어, `actionTime.ts` 타격 순간 맞춤), 복장(`props.ts`), 고블린(`goblins.ts`), HUD(`hud.ts`)
- `tests/golden/determinism.json` — 결정성 기준 해시. 레벨·물리·이동 파라미터를 의도적으로 바꿨을 때만 재생성한다.

에셋 출처와 라이선스는 `CREDITS.md`.

## 결정성 규칙

1. 게임 로직은 `stepSim` 안에서만, dt = 1/60 고정
2. `Math.random` 금지 → `core/rng.ts`
3. 시뮬레이션에서 `Math.sin/cos/atan2` 금지 → `core/trig.ts` (정수 각도, 1회전 = 4096)
4. Rapier 바디는 `level.solids` 배열 순서대로 생성
5. 애니메이션은 렌더 전용 — 시뮬레이션은 상태만 내보내고, 공격 클립은 타격 순간을 판정 틱에 맞춰 시간 왜곡한다
6. navcat은 `findPath`만 쓴다 — crowd 모듈은 `Math.sin/cos`를 써서 엔진마다 결과가 다를 수 있다
