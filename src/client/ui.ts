// 共通の DOM ヘルパー（main.ts / kids.ts / adult.ts で共用）

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: cls, ...rest } = props as any;
  if (cls) node.className = cls;
  Object.assign(node, rest);
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

export const yen = (n: number) => '¥' + n.toLocaleString('ja-JP');
export const signedYen = (n: number) => (n >= 0 ? '+' : '−') + '¥' + Math.abs(n).toLocaleString('ja-JP');

export function fmtDate(s: string) { return s ? s.slice(0, 10).replace(/-/g, '/') : ''; }

export function labeled(label: string, control: HTMLElement) {
  return el('label', { class: 'field' }, [el('span', { class: 'field-label', textContent: label }), control]);
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
