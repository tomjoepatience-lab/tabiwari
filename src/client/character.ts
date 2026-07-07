// マネコ — 3Dトゥーン猫キャラクター（プロシージャル生成・外部モデル不使用）
// mountCharacter(container) でステージを生成し、気分・体型・リアクションを操作できる。
import * as THREE from 'three';

export type Mood = 'normal' | 'happy' | 'excited' | 'worried' | 'tired' | 'sleepy';
export type ReactionKind = 'ramen' | 'drink' | 'cafe' | 'sweets' | 'shopping' | 'wear' | 'generic';
export type Costume = 'none' | 'beret' | 'scarf';

export type StageVariant = 'stage' | 'street' | 'peek';

export interface CharacterCtl {
  setMood(m: Mood): void;
  setChubby(f: number): void; // 0(スリム)〜1(まんまる)
  react(kind: ReactionKind): void;
  speak(text: string, ms?: number): void;
  wear(c: Costume): void;
  setFloaties(items: { emoji: string; label?: string }[]): void; // 最近買ったものをステージに浮かべる
  onTap?: () => void;
  dispose(): void;
}

// ---- 色パレット（アニメ調・やわらかい） --------------------------------
const C = {
  fur: 0xf7e7c5,       // 本体クリーム
  furShade: 0xefd9a8,
  belly: 0xfff8e9,     // おなか
  earIn: 0xf5b8c4,     // 内耳ピンク
  outline: 0x4a3b30,   // 輪郭線こげ茶
  eye: 0x40312a,
  blush: 0xffb3ac,
  coral: 0xe8845c,     // 衣装・小物のアクセント
  green: 0x1f9d63,
} as const;

// ---- トゥーン素材ヘルパー ----------------------------------------------
let gradientMap: THREE.DataTexture | null = null;
function toonGradient(): THREE.DataTexture {
  if (gradientMap) return gradientMap;
  const colors = new Uint8Array([140, 190, 235, 255]); // 4段階
  gradientMap = new THREE.DataTexture(colors, colors.length, 1, THREE.RedFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  return gradientMap;
}
function toon(color: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
}
// 反転ハル方式の輪郭線（メッシュの子として追加）
function addOutline(mesh: THREE.Mesh, thickness = 1.045) {
  const mat = new THREE.MeshBasicMaterial({ color: C.outline, side: THREE.BackSide });
  const outline = new THREE.Mesh(mesh.geometry, mat);
  outline.scale.setScalar(thickness);
  mesh.add(outline);
}

// ---- 口（Canvasテクスチャで表情を描く） --------------------------------
type MouthShape = 'omega' | 'smile' | 'open' | 'flat' | 'worry' | 'yum';
function drawMouth(ctx: CanvasRenderingContext2D, shape: MouthShape) {
  const w = 256, h = 192;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#4a3b30';
  ctx.fillStyle = '#4a3b30';
  ctx.lineWidth = 13;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const cx = w / 2;
  ctx.beginPath();
  if (shape === 'omega') { // ω 猫口
    ctx.arc(cx - 34, 80, 34, Math.PI * 0.05, Math.PI * 0.95);
    ctx.moveTo(cx + 68, 80);
    ctx.arc(cx + 34, 80, 34, Math.PI * 0.05, Math.PI * 0.95);
    ctx.stroke();
  } else if (shape === 'smile') {
    ctx.arc(cx, 60, 52, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  } else if (shape === 'open') { // 食べる・びっくり
    ctx.ellipse(cx, 90, 40, 50, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c96a6a';
    ctx.beginPath();
    ctx.ellipse(cx, 108, 24, 22, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape === 'flat') {
    ctx.moveTo(cx - 40, 84); ctx.lineTo(cx + 40, 84);
    ctx.stroke();
  } else if (shape === 'worry') { // への字
    ctx.arc(cx, 130, 50, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
  } else if (shape === 'yum') { // にっこり＋舌
    ctx.arc(cx, 56, 54, Math.PI * 0.12, Math.PI * 0.88);
    ctx.stroke();
    ctx.fillStyle = '#e98a92';
    ctx.beginPath();
    ctx.ellipse(cx, 116, 20, 24, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- 小物（リアクション用プロップ） ------------------------------------
function makeRamen(): THREE.Group {
  const g = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.18, 0.24, 24), toon(0xfffaf2));
  addOutline(bowl, 1.05);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.305, 0.27, 0.09, 24), toon(0xd05a48));
  band.position.y = 0.05;
  const noodle = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 14), toon(0xf3d789));
  noodle.scale.set(1, 0.4, 1); noodle.position.y = 0.13;
  const naruto = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 16), toon(0xffffff));
  naruto.position.set(0.08, 0.22, 0.05);
  const spiral = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.012, 8, 16), toon(0xf08a9b));
  spiral.rotation.x = Math.PI / 2; spiral.position.set(0.08, 0.24, 0.05);
  const stick1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 8), toon(0xa9744a));
  stick1.position.set(-0.1, 0.32, 0); stick1.rotation.z = 0.5;
  const stick2 = stick1.clone(); stick2.position.x = -0.04; (stick2 as THREE.Mesh).rotation.z = 0.42;
  g.add(bowl, band, noodle, naruto, spiral, stick1, stick2);
  return g;
}
function makeBeer(): THREE.Group {
  const g = new THREE.Group();
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.34, 20), toon(0xf3b53c));
  addOutline(mug, 1.06);
  const foam = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 12), toon(0xfffdf5));
  foam.scale.set(1, 0.5, 1); foam.position.y = 0.19;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 10, 20), toon(0xf3b53c));
  handle.position.set(0.18, 0, 0);
  g.add(mug, foam, handle);
  return g;
}
function makeCoffee(): THREE.Group {
  const g = new THREE.Group();
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.22, 20), toon(0xffffff));
  addOutline(cup, 1.06);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.02, 20), toon(0x8a5a3b));
  top.position.y = 0.1;
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.115, 0.1, 20), toon(0xc9a06a));
  sleeve.position.y = -0.02;
  g.add(cup, top, sleeve);
  return g;
}
function makeCupcake(): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.1, 0.16, 20), toon(0xc9a06a));
  addOutline(base, 1.06);
  const cream = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 12), toon(0xf8c7d6));
  cream.scale.set(1, 0.8, 1); cream.position.y = 0.14;
  const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), toon(0xd0453f));
  cherry.position.y = 0.28;
  g.add(base, cream, cherry);
  return g;
}
function makeBag(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.4, 0.2), toon(C.coral));
  addOutline(body, 1.05);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 8, 20, Math.PI), toon(0xa9744a));
  handle.position.y = 0.2;
  const heart = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), toon(0xfff2dd));
  heart.position.set(0, 0.02, 0.11);
  g.add(body, handle, heart);
  return g;
}
const PROP_BUILDERS: Record<string, () => THREE.Group> = {
  ramen: makeRamen, drink: makeBeer, cafe: makeCoffee, sweets: makeCupcake,
  shopping: makeBag, generic: makeBag, wear: makeBag,
};

// 金貨（お金の国の飾り）
function coinTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f6c945';
  x.beginPath(); x.arc(64, 64, 62, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#d9a916'; x.lineWidth = 8;
  x.beginPath(); x.arc(64, 64, 50, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#a8790a';
  x.font = 'bold 64px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('¥', 64, 66);
  return new THREE.CanvasTexture(c);
}
let coinFaceTex: THREE.CanvasTexture | null = null;
function makeCoin(radius = 0.22): THREE.Mesh {
  if (!coinFaceTex) coinFaceTex = coinTexture();
  const side = new THREE.MeshToonMaterial({ color: 0xd9a916, gradientMap: toonGradient() });
  const face = new THREE.MeshBasicMaterial({ map: coinFaceTex });
  return new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.06, 28), [side, face, face]);
}

// 絵文字スプライト（買ったものを背景に浮かべる。label 付きなら白タグも描く）
function emojiSprite(emoji: string, label?: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const x = c.getContext('2d')!;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '110px system-ui';
  x.fillText(emoji, 128, label ? 88 : 132);
  if (label) {
    x.font = 'bold 30px "M PLUS Rounded 1c", system-ui';
    const w = Math.min(240, x.measureText(label).width + 36);
    x.fillStyle = 'rgba(255,255,255,0.95)';
    x.strokeStyle = '#e3c56a';
    x.lineWidth = 4;
    const rx = 128 - w / 2, ry = 156, rh = 48;
    x.beginPath();
    (x as any).roundRect ? (x as any).roundRect(rx, ry, w, rh, 24) : x.rect(rx, ry, w, rh);
    x.fill(); x.stroke();
    x.fillStyle = '#5a4326';
    x.fillText(label, 128, ry + rh / 2 + 2);
  }
  const m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.95 });
  return new THREE.Sprite(m);
}

// ---- マネコタウンの建物・道（street バリアント用） -----------------------
function stripeTexture(a: string, b: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const x = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? a : b; x.fillRect(i * 16, 0, 16, 32); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function signTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fffdf6';
  x.strokeStyle = '#c99b2e';
  x.lineWidth = 8;
  (x as any).roundRect ? ((x as any).roundRect(6, 6, 244, 84, 20), x.fill(), x.stroke()) : (x.fillRect(6, 6, 244, 84), x.strokeRect(6, 6, 244, 84));
  x.fillStyle = '#5a4326';
  x.font = 'bold 44px "M PLUS Rounded 1c", system-ui';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 128, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function makeShop(wall: number, stripeA: string, stripeB: string, sign: string): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.3, 1.1), toon(wall));
  body.position.y = 0.65;
  addOutline(body, 1.03);
  const awning = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 1.8, 20, 1, false, 0, Math.PI),
    new THREE.MeshToonMaterial({ map: stripeTexture(stripeA, stripeB), gradientMap: toonGradient() })
  );
  awning.rotation.z = Math.PI / 2;
  awning.position.set(0, 1.02, 0.62);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.06), toon(0x8a5a3b));
  door.position.set(-0.35, 0.31, 0.56);
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.06), toon(0xbfe6f5));
  win.position.set(0.4, 0.62, 0.56);
  const signMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 0.42),
    new THREE.MeshBasicMaterial({ map: signTexture(sign), transparent: true })
  );
  signMesh.position.set(0, 1.62, 0.4);
  g.add(body, awning, door, win, signMesh);
  return g;
}
function roadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const x = c.getContext('2d')!;
  const grad = x.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#EDB33F');
  grad.addColorStop(1, '#FBDD7E');
  x.fillStyle = grad;
  x.fillRect(0, 0, 128, 512);
  x.strokeStyle = 'rgba(255,255,255,0.9)';
  x.lineWidth = 7;
  x.setLineDash([34, 26]);
  x.beginPath(); x.moveTo(64, 0); x.lineTo(64, 512); x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- 本体 ---------------------------------------------------------------
export function mountCharacter(container: HTMLElement, opts: { variant?: StageVariant } = {}): CharacterCtl {
  const variant: StageVariant = opts.variant ?? 'stage';
  // 注意: container には .stage-holder（高さ指定）が付いている。
  // ここで別の height 指定クラスを足すと上書きされて高さ0に潰れるので足さない。
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'stage-canvas';
  container.appendChild(canvasWrap);

  // 吹き出し（HTMLオーバーレイ・日本語がくっきり出る）
  const bubble = document.createElement('div');
  bubble.className = 'stage-bubble hidden';
  container.appendChild(bubble);
  let bubbleTimer: number | undefined;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvasWrap.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // キャラが画面の下半分に収まり、上の吹き出しと重ならないフレーミング
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  if (variant === 'peek') {
    camera.position.set(0, 2.15, 4.4);       // 大人モード: 上半身アップ
    camera.lookAt(0, 1.95, 0);
  } else if (variant === 'street') {
    camera.position.set(0, 2.9, 10.2);       // こどもモード: 街が見える引き
    camera.lookAt(0, 1.5, 0);
  } else {
    camera.position.set(0, 2.2, 8.6);
    camera.lookAt(0, 1.55, 0);
  }

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8ecd9, 1.15));
  const sun = new THREE.DirectionalLight(0xfff1da, 1.6);
  sun.position.set(3, 6, 4);
  scene.add(sun);

  // 地面（stage=パステルの丘 / street=砂の広場＋金の道）＋落ち影
  if (variant !== 'peek') {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(variant === 'street' ? 7 : 4.4, 48), toon(variant === 'street' ? 0xe6c184 : 0xd6ecd9));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const sctx = shadowCanvas.getContext('2d')!;
    const grad = sctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    grad.addColorStop(0, variant === 'street' ? 'rgba(120,85,30,0.35)' : 'rgba(70,110,80,0.35)');
    grad.addColorStop(1, 'rgba(70,110,80,0)');
    sctx.fillStyle = grad; sctx.fillRect(0, 0, 128, 128);
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false })
    );
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.01;
    scene.add(blob);
  }
  if (variant === 'street') {
    // 金の道（奥へ伸びる）＋パンや・ゲームショップ
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 14),
      new THREE.MeshBasicMaterial({ map: roadTexture() })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.005, -1);
    scene.add(road);
    const panya = makeShop(0xfff1d6, '#E8483F', '#FFFDF6', 'パンや');
    panya.position.set(-3.1, 0, -3.2);
    panya.rotation.y = 0.45;
    scene.add(panya);
    const gameShop = makeShop(0xbfe9f2, '#3E9E9C', '#CFF3F0', 'ゲーム');
    gameShop.position.set(3.1, 0, -3.0);
    gameShop.rotation.y = -0.45;
    scene.add(gameShop);
  }

  // ---- キャラクター組み立て ------------------------------------------
  const cat = new THREE.Group();
  scene.add(cat);

  // 体（chubby でふくらむ）
  const bodyGrp = new THREE.Group();
  cat.add(bodyGrp);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.82, 32, 32), toon(C.fur));
  body.scale.set(1, 1.04, 0.92);
  body.position.y = 0.85;
  addOutline(body);
  bodyGrp.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.58, 28, 28), toon(C.belly));
  belly.scale.set(0.95, 1.0, 0.62);
  belly.position.set(0, 0.8, 0.33);
  bodyGrp.add(belly);

  // 脚
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 16), toon(C.furShade));
    leg.scale.set(1, 0.62, 1.15);
    leg.position.set(0.32 * sx, 0.16, 0.18);
    addOutline(leg);
    bodyGrp.add(leg);
  }

  // 腕（肩ピボットで振れる）
  const armL = new THREE.Group(), armR = new THREE.Group();
  for (const [grp, sx] of [[armL, -1], [armR, 1]] as [THREE.Group, number][]) {
    grp.position.set(0.66 * sx, 1.28, 0.12);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.3, 6, 16), toon(C.fur));
    arm.position.y = -0.22;
    addOutline(arm);
    grp.add(arm);
    grp.rotation.z = 0.85 * sx; // だらんと下げる
    cat.add(grp);
  }

  // しっぽ（球の連なりでカール）
  const tail = new THREE.Group();
  tail.position.set(0, 0.55, -0.72);
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.05, 0.25, -0.22),
    new THREE.Vector3(0.02, 0.62, -0.28),
    new THREE.Vector3(-0.08, 0.9, -0.1),
    new THREE.Vector3(-0.05, 1.0, 0.12),
  ]);
  for (let i = 0; i <= 10; i++) {
    const p = tailCurve.getPoint(i / 10);
    const r = 0.11 - i * 0.006;
    const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), toon(i >= 8 ? C.belly : C.fur));
    seg.position.copy(p);
    if (i % 3 === 0) addOutline(seg, 1.08);
    tail.add(seg);
  }
  cat.add(tail);

  // 頭
  const headGrp = new THREE.Group();
  headGrp.position.y = 1.92;
  cat.add(headGrp);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 32), toon(C.fur));
  head.scale.set(1.06, 0.94, 0.96);
  addOutline(head);
  headGrp.add(head);

  // 耳
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.42, 24), toon(C.fur));
    ear.position.set(0.48 * sx, 0.62, -0.05);
    ear.rotation.z = -0.5 * sx;
    addOutline(ear, 1.035);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.28, 20), toon(C.earIn));
    inner.position.set(0, -0.03, 0.1);
    ear.add(inner);
    headGrp.add(ear);
  }

  // 目（大きな瞳＋ハイライト2つ）まばたきは scale.y
  const eyeL = new THREE.Group(), eyeR = new THREE.Group();
  for (const [grp, sx] of [[eyeL, -1], [eyeR, 1]] as [THREE.Group, number][]) {
    grp.position.set(0.31 * sx, 0.06, 0.7); // 頭の楕円表面より前に出す
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 16), new THREE.MeshBasicMaterial({ color: C.eye }));
    ball.scale.set(0.8, 1.25, 0.45);
    const hi1 = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    hi1.position.set(0.035 * sx, 0.07, 0.05);
    const hi2 = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    hi2.position.set(-0.03 * sx, -0.05, 0.055);
    grp.add(ball, hi1, hi2);
    headGrp.add(grp);
  }

  // ほっぺ
  const blushMat = new THREE.MeshBasicMaterial({ color: C.blush, transparent: true, opacity: 0.65 });
  for (const sx of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), blushMat);
    b.position.set(0.5 * sx, -0.14, 0.64);
    b.lookAt(b.position.clone().multiplyScalar(2).add(new THREE.Vector3(0, 0, 1)));
    headGrp.add(b);
  }

  // 口（Canvas テクスチャ）
  const mouthCanvas = document.createElement('canvas');
  mouthCanvas.width = 256; mouthCanvas.height = 192;
  const mouthCtx = mouthCanvas.getContext('2d')!;
  const mouthTex = new THREE.CanvasTexture(mouthCanvas);
  let mouthShape: MouthShape = 'omega';
  const setMouth = (s: MouthShape) => {
    if (mouthShape === s) return;
    mouthShape = s;
    drawMouth(mouthCtx, s);
    mouthTex.needsUpdate = true;
  };
  drawMouth(mouthCtx, 'omega');
  const mouth = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.375),
    new THREE.MeshBasicMaterial({ map: mouthTex, transparent: true })
  );
  mouth.position.set(0, -0.18, 0.78); // 頭の表面より前（埋まると見えない）
  headGrp.add(mouth);

  // 汗（worried）・Zzz（sleepy）
  const sweat = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), toon(0x9fd2f2));
  sweat.scale.set(0.8, 1.2, 0.8);
  sweat.position.set(0.62, 0.42, 0.35);
  sweat.visible = false;
  headGrp.add(sweat);
  const zzzCanvas = document.createElement('canvas');
  zzzCanvas.width = 128; zzzCanvas.height = 128;
  const zctx = zzzCanvas.getContext('2d')!;
  zctx.font = 'bold 44px system-ui';
  zctx.fillStyle = '#6f87b8';
  zctx.fillText('Z', 10, 100); zctx.font = 'bold 32px system-ui'; zctx.fillText('z', 56, 70);
  zctx.font = 'bold 22px system-ui'; zctx.fillText('z', 88, 40);
  const zzz = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(zzzCanvas), transparent: true }));
  zzz.scale.set(0.7, 0.7, 1);
  zzz.position.set(0.8, 0.9, 0);
  zzz.visible = false;
  headGrp.add(zzz);

  // 衣装
  const beret = new THREE.Group();
  {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), toon(C.coral));
    cap.scale.set(1, 0.62, 1);
    addOutline(cap, 1.05);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 8), toon(0xa9744a));
    stem.position.y = 0.32;
    beret.add(cap, stem);
    beret.position.set(0.14, 0.6, 0);
    beret.rotation.z = -0.22;
    beret.visible = false;
    headGrp.add(beret);
  }
  const scarf = new THREE.Group();
  {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.13, 12, 28), toon(0xd0453f));
    ring.rotation.x = Math.PI / 2;
    const tailPart = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.4, 0.08), toon(0xd0453f));
    tailPart.position.set(0.22, -0.3, 0.42);
    tailPart.rotation.z = 0.15;
    scarf.add(ring, tailPart);
    scarf.position.y = 1.42;
    scarf.visible = false;
    cat.add(scarf);
  }
  const costumes: Record<Exclude<Costume, 'none'>, THREE.Group> = { beret, scarf };

  // キラキラ＋金貨（リアクション演出）
  const sparkGrp = new THREE.Group();
  scene.add(sparkGrp);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd76a });
  const sparks: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  function burstSparks(at: THREE.Vector3) {
    for (let i = 0; i < 12; i++) {
      const m = i % 3 === 0 ? makeCoin(0.09) : new THREE.Mesh(new THREE.OctahedronGeometry(0.05), sparkMat);
      m.position.copy(at);
      sparkGrp.add(m);
      const a = (i / 12) * Math.PI * 2;
      sparks.push({ m, v: new THREE.Vector3(Math.cos(a) * 1.4, 2 + Math.random(), Math.sin(a) * 1.4), life: 0.8 });
    }
  }

  // お金の国の飾り: 地面の金貨＋回る金貨（peek では出さない）
  const spinCoins: THREE.Group[] = [];
  if (variant !== 'peek') {
    for (const [px, pz, rot] of [[1.35, 0.9, 0.4], [-1.5, 0.5, -0.8], [1.0, -1.0, 1.7], [-1.1, 1.2, 2.4]] as [number, number, number][]) {
      const coin = makeCoin();
      coin.position.set(px, 0.035, pz);
      coin.rotation.y = rot;
      scene.add(coin);
    }
    for (const [px, py, pz] of [[-2.1, 2.3, -1.2], [2.15, 1.7, -0.9], [0, 3.1, -1.8]] as [number, number, number][]) {
      const pivot = new THREE.Group();
      const coin = makeCoin(0.19);
      coin.rotation.x = Math.PI / 2; // 立てる
      pivot.add(coin);
      pivot.position.set(px, py, pz);
      scene.add(pivot);
      spinCoins.push(pivot);
    }
  }

  // 最近買ったものの浮遊スプライト（street では道ぞいの看板ふうに）
  const floatGrp = new THREE.Group();
  scene.add(floatGrp);
  let floaties: { s: THREE.Sprite; baseY: number; phase: number; speed: number }[] = [];
  function setFloaties(items: { emoji: string; label?: string }[]) {
    for (const f of floaties) { floatGrp.remove(f.s); f.s.material.map?.dispose(); f.s.material.dispose(); }
    floaties = [];
    if (variant === 'peek') return;
    items.slice(0, 10).forEach((it, i) => {
      const s = emojiSprite(it.emoji, it.label);
      const side = i % 2 === 0 ? -1 : 1;
      let x: number, y: number, z: number, sc: number;
      if (variant === 'street') {
        // 道の左右に、手前から奥へ並べる
        x = side * (1.9 + (i % 3) * 0.5);
        y = 1.1 + ((i * 29) % 12) / 10;
        z = 1.5 - Math.floor(i / 2) * 1.4;
        sc = 1.15 - Math.floor(i / 2) * 0.12;
      } else {
        x = side * (1.3 + (i % 5) * 0.35);
        y = 1.0 + ((i * 37) % 20) / 10;
        z = -1.0 - ((i * 23) % 10) / 10;
        sc = 0.55 + ((i * 13) % 4) * 0.08;
      }
      s.position.set(x, y, z);
      s.scale.set(Math.max(0.4, sc), Math.max(0.4, sc), 1);
      floatGrp.add(s);
      floaties.push({ s, baseY: y, phase: i * 1.7, speed: 0.7 + (i % 3) * 0.25 });
    });
  }

  // ---- 状態 ------------------------------------------------------------
  let mood: Mood = 'normal';
  let chubby = 0;           // 現在値（スムーズに追従）
  let chubbyTarget = 0;
  let disposed = false;
  let lastInteract = performance.now();

  // リアクションのタイムライン
  type Reaction = { kind: ReactionKind; t: number; prop: THREE.Group | null };
  let current: Reaction | null = null;
  const queue: ReactionKind[] = [];
  const REACT_DUR = 2.6;

  function startReaction(kind: ReactionKind) {
    const prop = kind === 'wear' ? null : PROP_BUILDERS[kind]().clone();
    if (prop) {
      prop.position.set(0.9, 0.6, 0.7);
      prop.scale.setScalar(0.01);
      scene.add(prop);
    }
    current = { kind, t: 0, prop };
    if (kind === 'wear') {
      // 衣装をローテーション
      const order: Costume[] = ['beret', 'scarf', 'none'];
      const idx = order.findIndex((c) => c !== 'none' && costumes[c as 'beret' | 'scarf'].visible);
      wearCostume(order[(idx + 1) % order.length]);
      burstSparks(new THREE.Vector3(0, 1.9, 0.4));
    }
  }
  function wearCostume(c: Costume) {
    beret.visible = c === 'beret';
    scarf.visible = c === 'scarf';
  }

  const moodMouth: Record<Mood, MouthShape> = {
    normal: 'omega', happy: 'smile', excited: 'smile', worried: 'worry', tired: 'flat', sleepy: 'omega',
  };

  // まばたき
  let nextBlink = 2 + Math.random() * 3;
  let blinkT = -1; // 0〜0.22 で進行中

  // ---- ループ ------------------------------------------------------------
  const clock = new THREE.Clock();
  let elapsed = 0;
  function frame() {
    if (disposed) return;
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    const t = elapsed;

    // 放置で眠くなる（90秒）
    const idleMs = performance.now() - lastInteract;
    const effMood: Mood = idleMs > 90_000 && !current ? 'sleepy' : mood;
    zzz.visible = effMood === 'sleepy';
    sweat.visible = effMood === 'worried';
    if (effMood === 'sleepy') zzz.position.y = 0.9 + Math.sin(t * 2) * 0.06;
    if (effMood === 'worried') { sweat.position.y = 0.42 - (t % 1.4) * 0.12; (sweat.material as THREE.MeshToonMaterial).opacity = 1; }

    // 体型（なめらかに追従）
    chubby += (chubbyTarget - chubby) * Math.min(1, dt * 2);
    const puff = 1 + chubby * 0.28;
    bodyGrp.scale.set(puff, 1 + chubby * 0.06, puff);
    blushMat.opacity = 0.55 + chubby * 0.3;

    // 基本の生き物感
    const bounceAmp = effMood === 'excited' ? 0.08 : effMood === 'sleepy' || effMood === 'tired' ? 0.012 : 0.03;
    const speed = effMood === 'excited' ? 3.4 : effMood === 'sleepy' ? 1.2 : 2.1;
    cat.position.y = Math.abs(Math.sin(t * speed)) * bounceAmp;
    body.scale.y = 1.04 + Math.sin(t * 2.2) * 0.012; // 呼吸
    tail.rotation.z = Math.sin(t * (effMood === 'excited' ? 5 : 1.6)) * 0.28;
    tail.rotation.x = Math.sin(t * 0.9) * 0.08;
    headGrp.rotation.z = Math.sin(t * 0.7) * 0.04 + (effMood === 'tired' ? 0.08 : 0);
    headGrp.rotation.x = effMood === 'sleepy' ? 0.18 : effMood === 'tired' ? 0.1 : Math.sin(t * 1.1) * 0.02;

    // 腕（通常はゆらゆら・興奮時はバンザイ）
    const armBase = effMood === 'excited' ? -0.6 : 0.85;
    armL.rotation.z = -armBase + Math.sin(t * 2.2) * 0.08;
    armR.rotation.z = armBase - Math.sin(t * 2.2) * 0.08;

    // まばたき（sleepy は半目固定）
    if (effMood === 'sleepy' || effMood === 'tired') {
      eyeL.scale.y = eyeR.scale.y = 0.35;
    } else {
      nextBlink -= dt;
      if (nextBlink <= 0 && blinkT < 0) { blinkT = 0; nextBlink = 2 + Math.random() * 3.5; }
      if (blinkT >= 0) {
        blinkT += dt;
        const k = blinkT / 0.22;
        eyeL.scale.y = eyeR.scale.y = k < 0.5 ? 1 - k * 2 * 0.94 : 0.06 + (k - 0.5) * 2 * 0.94;
        if (k >= 1) { blinkT = -1; eyeL.scale.y = eyeR.scale.y = 1; }
      }
    }

    // リアクション再生
    if (!current && queue.length) startReaction(queue.shift()!);
    if (current) {
      current.t += dt;
      const rt = current.t;
      const p = current.prop;
      if (current.kind === 'wear' || current.kind === 'generic' || current.kind === 'shopping') {
        // ぴょんぴょん跳ねる＋（あれば）小物を掲げる
        cat.position.y = Math.abs(Math.sin(rt * 6)) * 0.22;
        armL.rotation.z = 0.6; armR.rotation.z = -0.6;
        if (p) {
          const k = Math.min(1, rt * 3);
          p.scale.setScalar(k * 0.9 + 0.01);
          p.position.set(0.75, 1.7 + Math.abs(Math.sin(rt * 6)) * 0.22, 0.55);
          p.rotation.y += dt * 2;
        }
        setMouth('smile');
      } else {
        // 食べる・飲む系: 口元に運んでもぐもぐ
        if (p) {
          const k = Math.min(1, rt * 2.5);
          p.scale.setScalar(0.01 + k * 0.99);
          const hold = new THREE.Vector3(0.32, 1.45, 0.78);
          p.position.lerpVectors(new THREE.Vector3(0.9, 0.6, 0.7), hold, k);
          p.rotation.y = Math.sin(rt * 2) * 0.2;
        }
        armR.rotation.z = -0.15; // 持ち上げ
        if (rt > 0.5 && rt < REACT_DUR - 0.5) {
          setMouth(Math.floor(rt * 6) % 2 === 0 ? 'open' : 'yum');
          headGrp.rotation.x = 0.06 + Math.sin(rt * 12) * 0.03; // もぐもぐ
        } else if (rt >= REACT_DUR - 0.5) {
          setMouth('yum');
        }
      }
      if (rt >= REACT_DUR) {
        if (p) { burstSparks(p.position.clone()); scene.remove(p); }
        current = null;
        setMouth(moodMouth[mood]);
      }
    } else {
      setMouth(moodMouth[effMood]);
    }

    // 飾りの金貨・浮遊する買い物
    for (let i = 0; i < spinCoins.length; i++) {
      spinCoins[i].rotation.y += dt * (1.2 + i * 0.4);
      spinCoins[i].position.y += Math.sin(t * (0.8 + i * 0.3) + i * 2) * dt * 0.15;
    }
    for (const f of floaties) {
      f.s.position.y = f.baseY + Math.sin(t * f.speed + f.phase) * 0.18;
      f.s.position.x += Math.sin(t * 0.3 + f.phase) * dt * 0.05;
    }

    // キラキラ更新
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= dt;
      s.v.y -= dt * 6;
      s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.x += dt * 8; s.m.rotation.y += dt * 8;
      s.m.scale.setScalar(Math.max(0.01, s.life));
      if (s.life <= 0) { sparkGrp.remove(s.m); sparks.splice(i, 1); }
    }

    renderer.render(scene, camera);
  }

  // ---- リサイズ・タップ --------------------------------------------------
  function resize() {
    const w = canvasWrap.clientWidth || 300;
    const h = canvasWrap.clientHeight || 300;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvasWrap);
  resize();

  renderer.domElement.addEventListener('click', () => {
    lastInteract = performance.now();
    if (!current) queue.push('generic');
    ctl.onTap?.();
  });

  frame();

  // ---- コントローラ --------------------------------------------------------
  const ctl: CharacterCtl = {
    setMood(m) { mood = m; lastInteract = performance.now(); },
    setChubby(f) { chubbyTarget = Math.max(0, Math.min(1, f)); },
    react(kind) {
      lastInteract = performance.now();
      if (queue.length < 3) queue.push(kind);
    },
    speak(text, ms) {
      lastInteract = performance.now();
      bubble.textContent = text;
      bubble.classList.remove('hidden');
      bubble.classList.remove('pop');
      void bubble.offsetWidth; // アニメ再発火
      bubble.classList.add('pop');
      if (bubbleTimer) clearTimeout(bubbleTimer);
      bubbleTimer = window.setTimeout(() => bubble.classList.add('hidden'), ms ?? 3200 + text.length * 60);
    },
    wear(c) { wearCostume(c); },
    setFloaties(emojis) { setFloaties(emojis); },
    dispose() {
      disposed = true;
      ro.disconnect();
      if (bubbleTimer) clearTimeout(bubbleTimer);
      renderer.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      container.replaceChildren();
    },
  };
  return ctl;
}
