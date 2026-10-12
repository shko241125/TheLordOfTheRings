import { TREES, view, type Ctx, type Tree } from '../dialogue';

/**
 * 대화 창: NPC 이름 + 말 한 줄 + 선택지(최대 3, 숫자 키 1~3 또는 클릭). '상점' 선택지는 onShop을 부른다.
 * 상점·장비 창과 같은 자리(일시정지 화면 안)에 뜬다.
 */
export function createDialoguePanel(host: HTMLElement, ctx: () => Ctx, onShop: () => void) {
  const style = document.createElement('style');
  style.textContent = `
    #talk { display: none; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(560px, calc(100vw - 24px));
      padding: 14px 18px; background: rgba(10,9,8,.96); border: 1px solid #5a5040; color: #d8cbb0; font: 14px/1.6 serif; text-align: left; cursor: default; z-index: 2; }
    #talk h3 { margin: 0 0 6px; font-weight: normal; color: #e8c890; }
    #talk .say { font-style: italic; margin-bottom: 10px; }
    #talk button { display: block; width: 100%; text-align: left; margin: 4px 0; font: 14px serif; padding: 5px 10px; background: #1d1a16; color: #d8cbb0; border: 1px solid #5a5040; cursor: pointer; }
    #talk button:hover { border-color: #cbbd9e; }
  `;
  document.head.appendChild(style);
  const panel = Object.assign(document.createElement('div'), { id: 'talk' });
  host.append(panel);
  panel.addEventListener('click', (e) => e.stopPropagation());
  let tree: Tree | null = null;
  let name = '';
  let node = '';
  let picks: (() => void)[] = [];

  function render() {
    if (!tree) return;
    const v = view(tree, node, ctx());
    panel.innerHTML = '<h3></h3><div class="say"></div>';
    panel.querySelector('h3')!.textContent = name;
    panel.querySelector('.say')!.textContent = `“${v.say}”`;
    picks = v.choices.map((ch) => () => {
      if (ch.action === 'shop') {
        api.close();
        onShop();
      } else if (ch.action === 'close' || !ch.to) api.close();
      else {
        node = ch.to;
        render();
      }
    });
    v.choices.forEach((ch, i) => {
      const b = document.createElement('button');
      b.textContent = `${i + 1}. ${ch.label}`;
      b.addEventListener('click', picks[i]!);
      panel.append(b);
    });
  }

  const api = {
    get open() {
      return panel.style.display === 'block';
    },
    show(kind: keyof typeof TREES, who: string) {
      tree = TREES[kind];
      name = who;
      node = tree.start;
      panel.style.display = 'block';
      render();
    },
    /** 숫자 키 1~3 */
    pick(i: number) {
      picks[i]?.();
    },
    close() {
      panel.style.display = 'none';
    },
  };
  return api;
}
