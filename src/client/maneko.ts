// マネコ（キャラクター）一元管理。kids.ts / journey.ts の循環importを解消するため、
// マネコ本体（manekoHtml）とステージ別の装備（stageAccessoriesHtml）をここに集約する。
// 座標系はすべて 300×370（デザイン ManekoStage.dc.html / maneko-home-game-2a と同一）。

// マネコ本体（描き込みリッチ版・300×370）。2a マークアップの忠実コピー。
//   collar:true（既定）… 従来どおり赤い首輪＋鈴を出力（ホーム互換）。
//   collar:false        … 首輪＋鈴を省く（ステージ別首輪 collar* を重ねて使うとき）。
export function manekoHtml(opts?: { collar?: boolean }): string {
  const collar = opts?.collar !== false;
  return `
    <div id="m-cat-shadow" style="position:absolute;left:78px;bottom:10px;width:144px;height:26px;border-radius:50%;background:radial-gradient(ellipse at center, rgba(120,70,0,.35), rgba(120,70,0,0) 70%);animation:mshadow 3s ease-in-out infinite"></div>
    <div id="m-cat-body" style="position:absolute;inset:0;animation:mfloat 3s ease-in-out infinite">
      <div style="position:absolute;right:26px;bottom:88px;width:70px;height:24px;border-radius:14px;background:linear-gradient(90deg,#E8791B,#FFB65C);transform-origin:left center;animation:mwag 2.2s ease-in-out infinite;box-shadow:inset 0 -4px 6px rgba(160,80,0,.3)">
        <div style="position:absolute;right:6px;top:3px;bottom:3px;width:8px;border-radius:4px;background:rgba(200,90,10,.55)"></div>
        <div style="position:absolute;right:20px;top:3px;bottom:3px;width:7px;border-radius:4px;background:rgba(200,90,10,.45)"></div>
        <div style="position:absolute;right:33px;top:3px;bottom:3px;width:6px;border-radius:4px;background:rgba(200,90,10,.35)"></div>
      </div>
      <div style="position:absolute;left:96px;bottom:32px;width:46px;height:26px;border-radius:50%;background:linear-gradient(180deg,#FFC56E,#F0912C);box-shadow:inset 0 -4px 6px rgba(170,85,0,.35)"></div>
      <div style="position:absolute;left:160px;bottom:32px;width:46px;height:26px;border-radius:50%;background:linear-gradient(180deg,#FFC56E,#F0912C);box-shadow:inset 0 -4px 6px rgba(170,85,0,.35)"></div>
      <div style="position:absolute;left:70px;bottom:42px;width:160px;height:150px;border-radius:50% 50% 47% 47%;background:radial-gradient(circle at 35% 25%, #FFC96F, #FF9E3D 55%, #E8791B);box-shadow:inset -12px -16px 24px rgba(180,80,0,.30), inset 10px 12px 20px rgba(255,255,255,.35)"></div>
      <div style="position:absolute;left:80px;bottom:150px;width:30px;height:10px;border-radius:6px;background:rgba(200,90,10,.6);transform:rotate(20deg)"></div>
      <div style="position:absolute;left:84px;bottom:126px;width:24px;height:9px;border-radius:6px;background:rgba(200,90,10,.5);transform:rotate(16deg)"></div>
      <div style="position:absolute;left:192px;bottom:150px;width:30px;height:10px;border-radius:6px;background:rgba(200,90,10,.6);transform:rotate(-20deg)"></div>
      <div style="position:absolute;left:194px;bottom:126px;width:24px;height:9px;border-radius:6px;background:rgba(200,90,10,.5);transform:rotate(-16deg)"></div>
      <div style="position:absolute;left:108px;bottom:52px;width:84px;height:92px;border-radius:50%;background:radial-gradient(circle at 42% 28%, #FFF6E0, #FFE3AE)"></div>
      <div style="position:absolute;left:130px;bottom:70px;width:40px;height:40px;border-radius:50%;border:3px solid #E8B62B;background:radial-gradient(circle at 35% 30%, #FFEFAE, #FFD54A 55%, #DFA318);box-shadow:inset 0 -4px 6px rgba(160,100,0,.4);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:#A9750B">¥</div>
      <div style="position:absolute;left:58px;top:126px;width:32px;height:56px;border-radius:16px;background:linear-gradient(180deg,#FFC56E,#EF8A24);transform-origin:50% 88%;animation:mbeckon 1.5s ease-in-out infinite;box-shadow:inset -4px -6px 8px rgba(170,85,0,.3)"></div>
      <div style="position:absolute;left:208px;top:176px;width:32px;height:52px;border-radius:16px;background:linear-gradient(180deg,#FFC56E,#EF8A24);transform:rotate(-30deg);box-shadow:inset -4px -6px 8px rgba(170,85,0,.3)"></div>
      <div style="position:absolute;left:98px;top:46px;width:0;height:0;border-left:17px solid transparent;border-right:17px solid transparent;border-bottom:34px solid #E8791B;transform:rotate(-16deg)"></div>
      <div style="position:absolute;left:106px;top:58px;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:18px solid #FFB3BC;transform:rotate(-16deg)"></div>
      <div style="position:absolute;left:186px;top:46px;width:0;height:0;border-left:17px solid transparent;border-right:17px solid transparent;border-bottom:34px solid #E8791B;transform:rotate(16deg)"></div>
      <div style="position:absolute;left:194px;top:60px;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:18px solid #FFB3BC;transform:rotate(16deg)"></div>
      <div style="position:absolute;left:76px;top:70px;width:148px;height:130px;border-radius:50%;background:radial-gradient(circle at 35% 25%, #FFC96F, #FF9E3D 55%, #E8791B);box-shadow:inset -12px -14px 22px rgba(180,80,0,.28), inset 10px 10px 18px rgba(255,255,255,.35)"></div>
      <div style="position:absolute;left:136px;top:78px;width:7px;height:18px;border-radius:4px;background:#DF7014;transform:rotate(-8deg)"></div>
      <div style="position:absolute;left:148px;top:76px;width:7px;height:20px;border-radius:4px;background:#DF7014"></div>
      <div style="position:absolute;left:160px;top:78px;width:7px;height:18px;border-radius:4px;background:#DF7014;transform:rotate(8deg)"></div>
      <div style="position:absolute;left:80px;top:130px;width:16px;height:7px;border-radius:4px;background:rgba(200,90,10,.5);transform:rotate(-14deg)"></div>
      <div style="position:absolute;left:204px;top:130px;width:16px;height:7px;border-radius:4px;background:rgba(200,90,10,.5);transform:rotate(14deg)"></div>
      <div style="position:absolute;left:122px;top:132px;width:56px;height:36px;border-radius:50%;background:radial-gradient(circle at 50% 30%, #FFF4D8, #FFE6B4)"></div>
      <div style="position:absolute;left:112px;top:112px;width:30px;height:32px;border-radius:50%;background:#FFF9EC;box-shadow:inset 0 2px 3px rgba(120,80,20,.25)">
        <div style="position:absolute;left:5px;top:5px;width:20px;height:22px;border-radius:50%;background:radial-gradient(circle at 40% 30%, #FFC963, #E8871A 60%, #B35E08)"></div>
        <div style="position:absolute;left:11px;top:8px;width:8px;height:17px;border-radius:50%;background:#1A0F08"></div>
        <div style="position:absolute;left:8px;top:8px;width:7px;height:7px;border-radius:50%;background:#FFFFFF"></div>
        <div style="position:absolute;left:19px;top:19px;width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.9)"></div>
      </div>
      <div style="position:absolute;left:158px;top:112px;width:30px;height:32px;border-radius:50%;background:#FFF9EC;box-shadow:inset 0 2px 3px rgba(120,80,20,.25)">
        <div style="position:absolute;left:5px;top:5px;width:20px;height:22px;border-radius:50%;background:radial-gradient(circle at 40% 30%, #FFC963, #E8871A 60%, #B35E08)"></div>
        <div style="position:absolute;left:11px;top:8px;width:8px;height:17px;border-radius:50%;background:#1A0F08"></div>
        <div style="position:absolute;left:8px;top:8px;width:7px;height:7px;border-radius:50%;background:#FFFFFF"></div>
        <div style="position:absolute;left:19px;top:19px;width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.9)"></div>
      </div>
      <div style="position:absolute;left:97px;top:150px;width:18px;height:11px;border-radius:50%;background:#FF9AA8;opacity:.85"></div>
      <div style="position:absolute;left:186px;top:150px;width:18px;height:11px;border-radius:50%;background:#FF9AA8;opacity:.85"></div>
      <div style="position:absolute;left:145px;top:144px;width:10px;height:7px;border-radius:50% 50% 60% 60%;background:#F08BA8"></div>
      <div style="position:absolute;left:137px;top:151px;width:12px;height:9px;border-bottom:2.5px solid #8A4B12;border-radius:0 0 12px 12px"></div>
      <div style="position:absolute;left:151px;top:151px;width:12px;height:9px;border-bottom:2.5px solid #8A4B12;border-radius:0 0 12px 12px"></div>
      <div style="position:absolute;left:74px;top:138px;width:26px;height:2.5px;border-radius:2px;background:rgba(140,80,20,.5);transform:rotate(8deg)"></div>
      <div style="position:absolute;left:74px;top:148px;width:26px;height:2.5px;border-radius:2px;background:rgba(140,80,20,.5);transform:rotate(-4deg)"></div>
      <div style="position:absolute;left:200px;top:138px;width:26px;height:2.5px;border-radius:2px;background:rgba(140,80,20,.5);transform:rotate(-8deg)"></div>
      <div style="position:absolute;left:200px;top:148px;width:26px;height:2.5px;border-radius:2px;background:rgba(140,80,20,.5);transform:rotate(4deg)"></div>
      ${collar ? `
      <div style="position:absolute;left:118px;top:190px;width:66px;height:14px;border-radius:8px;background:linear-gradient(180deg,#E8483F,#B92626);box-shadow:inset 0 -3px 4px rgba(120,10,10,.5)"></div>
      <div style="position:absolute;left:141px;top:198px;width:20px;height:20px;border-radius:50%;background:radial-gradient(circle at 38% 30%, #FFEFAE, #FFD54A 55%, #D9971A);box-shadow:0 2px 4px rgba(120,80,0,.4)">
        <div style="position:absolute;left:2px;top:9px;width:16px;height:2px;background:#8A5E0A"></div>
        <div style="position:absolute;left:8px;bottom:2px;width:4px;height:5px;border-radius:2px;background:#8A5E0A"></div>
      </div>` : ''}
      <div style="position:absolute;left:196px;top:132px;width:48px;height:48px;border-radius:50%;border:3px solid #E8B62B;background:radial-gradient(circle at 35% 30%, #FFEFAE, #FFD54A 55%, #DFA318);box-shadow:inset 0 -5px 7px rgba(160,100,0,.45), 0 5px 10px rgba(180,110,0,.3);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#A9750B;animation:mspin 3s linear infinite">¥</div>
      <div style="position:absolute;left:52px;top:60px;width:12px;height:12px;background:#FFF3B8;animation:msparkle 2.1s ease-in-out infinite"></div>
      <div style="position:absolute;left:246px;top:96px;width:9px;height:9px;background:#FFF3B8;animation:msparkle 2.1s ease-in-out infinite;animation-delay:-.8s"></div>
    </div>`;
}

// ステージ別の装備（0..4）。ManekoStage.dc.html の sc-if 分岐を 300×370 座標系のまま移植。
//   0 びんぼう長屋 : 絆創膏＋縄の首輪
//   1 かけだしの町 : 麦わら帽子＋革の首輪
//   2 にぎわい商店街: 羽根帽子＋ベスト＋宝石首輪＋蝶ネクタイ
//   3 大都会タワマン: シルクハット＋マント＋宝石首輪＋蝶ネクタイ
//   4 黄金の都      : 王冠＋マント＋モノクル＋王しゃく＋宝石首輪＋蝶ネクタイ
// マント(accCape)は猫本体より背面に置くため back に分ける。それ以外は body の前(front)。
export function stageAccessoriesHtml(stage: number): { back: string; front: string } {
  const cape = `
    <div style="position:absolute;left:66px;top:150px;width:168px;height:150px;border-radius:20px 20px 44px 44px;background:linear-gradient(180deg,#C0392B,#8E2018);box-shadow:inset -10px -10px 20px rgba(90,10,10,.4)"></div>
    <div style="position:absolute;left:60px;top:146px;width:180px;height:22px;border-radius:12px;background:linear-gradient(180deg,#FFF6EC,#E8DCC8);box-shadow:0 2px 4px rgba(120,80,20,.25)"></div>`;
  const vest = `
    <div style="position:absolute;left:96px;bottom:44px;width:44px;height:96px;border-radius:40% 10% 30% 40%;background:linear-gradient(180deg,#6C4CA6,#4E3480);box-shadow:inset -4px -6px 10px rgba(40,20,80,.4)"></div>
    <div style="position:absolute;left:162px;bottom:44px;width:44px;height:96px;border-radius:10% 40% 40% 30%;background:linear-gradient(180deg,#6C4CA6,#4E3480);box-shadow:inset 4px -6px 10px rgba(40,20,80,.4)"></div>
    <div style="position:absolute;left:120px;bottom:96px;width:8px;height:8px;border-radius:50%;background:#F5C542"></div>
    <div style="position:absolute;left:120px;bottom:78px;width:8px;height:8px;border-radius:50%;background:#F5C542"></div>`;
  const scepter = `
    <div style="position:absolute;left:236px;top:96px;width:8px;height:96px;border-radius:4px;background:linear-gradient(180deg,#F5C542,#C89A2E);transform:rotate(-14deg);transform-origin:bottom center"></div>
    <div style="position:absolute;left:224px;top:78px;width:30px;height:30px;border-radius:50%;border:3px solid #E8B62B;background:radial-gradient(circle at 35% 30%,#FFF3C8,#FFD54A 55%,#DFA318);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:#A9750B;transform:rotate(-14deg);box-shadow:0 3px 8px rgba(180,110,0,.4)">¥</div>
    <div style="position:absolute;left:230px;top:70px;width:9px;height:9px;background:#FFF7C8;animation:msparkle 1.8s ease-in-out infinite"></div>`;
  const patch = `
    <div style="position:absolute;left:92px;top:104px;width:26px;height:12px;border-radius:4px;background:#F3E3C4;border:1.5px solid #D8C29A;transform:rotate(-24deg);box-shadow:0 1px 2px rgba(120,80,20,.3)">
      <div style="position:absolute;left:11px;top:1px;width:2px;height:8px;background:#C8B084"></div>
      <div style="position:absolute;left:6px;top:4px;width:12px;height:2px;background:#C8B084"></div>
    </div>`;
  const monocle = `
    <div style="position:absolute;left:154px;top:108px;width:40px;height:40px;border-radius:50%;border:3px solid #E7BE5C;box-shadow:0 2px 5px rgba(150,100,20,.35), inset 0 0 8px rgba(255,255,255,.5)"></div>
    <div style="position:absolute;left:158px;top:146px;width:3px;height:34px;background:#C89A2E;transform:rotate(10deg);transform-origin:top"></div>`;
  const straw = `
    <div style="position:absolute;left:86px;top:52px;width:128px;height:20px;border-radius:50%;background:linear-gradient(180deg,#F0CE7E,#D8A94A);box-shadow:0 3px 6px rgba(150,100,20,.3)"></div>
    <div style="position:absolute;left:118px;top:20px;width:64px;height:44px;border-radius:50% 50% 30% 30%;background:linear-gradient(180deg,#F5D98C,#DDAF52);box-shadow:inset -6px -6px 10px rgba(150,100,20,.3)"></div>
    <div style="position:absolute;left:118px;top:50px;width:64px;height:12px;background:#C0392B;border-radius:4px"></div>`;
  // 羽根つき帽子: 設計値(top:22/42/2)のままでは頭頂(y70)から浮いて見えるため、fable裁定で+16px下げて頭に接地
  const featherHat = `
    <div style="position:absolute;left:120px;top:38px;width:74px;height:26px;border-radius:40px 40px 8px 8px;background:linear-gradient(180deg,#4E3480,#3A2660);transform:rotate(-8deg);box-shadow:inset -4px -4px 8px rgba(20,10,50,.5)"></div>
    <div style="position:absolute;left:118px;top:58px;width:80px;height:10px;border-radius:6px;background:#F5C542;transform:rotate(-8deg)"></div>
    <div style="position:absolute;left:176px;top:18px;width:14px;height:40px;border-radius:8px 8px 12px 12px;background:linear-gradient(180deg,#FF7EA8,#E0447E);transform:rotate(24deg);box-shadow:0 2px 4px rgba(150,40,90,.3)"></div>`;
  // 王冠: 設計値(top:18/40)では頭頂(y70)から約20px浮くため、fable裁定で+16px下げて頭に接地
  const crown = `
    <div style="position:absolute;left:116px;top:34px;width:70px;height:30px;background:linear-gradient(180deg,#FFE9A0,#E7BE5C);clip-path:polygon(0 100%,0 30%,17% 62%,34% 0,50% 55%,66% 0,83% 62%,100% 30%,100% 100%);box-shadow:0 3px 6px rgba(150,100,20,.35)"></div>
    <div style="position:absolute;left:120px;top:56px;width:62px;height:10px;border-radius:4px;background:linear-gradient(180deg,#F5C542,#C89A2E)"></div>
    <div style="position:absolute;left:145px;top:42px;width:11px;height:11px;border-radius:50%;background:#E0447E;box-shadow:0 0 4px rgba(220,60,120,.6)"></div>
    <div style="position:absolute;left:124px;top:52px;width:7px;height:7px;border-radius:50%;background:#4F9FD8"></div>
    <div style="position:absolute;left:171px;top:52px;width:7px;height:7px;border-radius:50%;background:#4F9FD8"></div>
    <div style="position:absolute;left:112px;top:24px;width:9px;height:9px;background:#FFF7C8;animation:msparkle 1.7s ease-in-out infinite"></div>`;
  const topHat = `
    <div style="position:absolute;left:110px;top:50px;width:80px;height:14px;border-radius:50%;background:linear-gradient(180deg,#3A3540,#26222B);box-shadow:0 3px 6px rgba(30,30,40,.3)"></div>
    <div style="position:absolute;left:124px;top:8px;width:52px;height:44px;border-radius:6px 6px 3px 3px;background:linear-gradient(90deg,#3E3945,#2A2631 70%,#211E27);box-shadow:inset -5px -4px 10px rgba(0,0,0,.4),inset 5px 4px 7px rgba(255,255,255,.12)"></div>
    <div style="position:absolute;left:124px;top:36px;width:52px;height:8px;background:#C0392B"></div>
    <div style="position:absolute;left:117px;top:2px;width:9px;height:9px;background:#FFF7C8;animation:msparkle 1.7s ease-in-out infinite"></div>`;
  const collarRope = `
    <div style="position:absolute;left:118px;top:190px;width:66px;height:12px;border-radius:8px;background:repeating-linear-gradient(45deg,#B89768 0 5px,#9A7C4E 5px 10px);box-shadow:inset 0 -2px 3px rgba(90,60,20,.4)"></div>
    <div style="position:absolute;left:143px;top:196px;width:16px;height:16px;border-radius:50%;background:radial-gradient(circle at 38% 30%,#E8D9B0,#B89768);border:1.5px solid #8A6C3E;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#6E5228">¥</div>`;
  const collarLeather = `
    <div style="position:absolute;left:118px;top:190px;width:66px;height:13px;border-radius:8px;background:linear-gradient(180deg,#9A5E30,#6E3E18);box-shadow:inset 0 -3px 4px rgba(60,30,10,.5)"></div>
    <div style="position:absolute;left:141px;top:197px;width:20px;height:20px;border-radius:50%;background:radial-gradient(circle at 38% 30%,#FFEFAE,#FFD54A 55%,#D9971A);box-shadow:0 2px 4px rgba(120,80,0,.4);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#8A5E0A">¥</div>`;
  const collarJewel = `
    <div style="position:absolute;left:114px;top:188px;width:74px;height:14px;border-radius:9px;background:linear-gradient(180deg,#F5C542,#C89A2E);box-shadow:inset 0 -3px 4px rgba(150,100,20,.5),0 2px 4px rgba(150,100,20,.3)"></div>
    <div style="position:absolute;left:124px;top:191px;width:8px;height:8px;border-radius:50%;background:#4F9FD8"></div>
    <div style="position:absolute;left:168px;top:191px;width:8px;height:8px;border-radius:50%;background:#4F9FD8"></div>
    <div style="position:absolute;left:141px;top:196px;width:20px;height:20px;transform:rotate(45deg);background:linear-gradient(135deg,#FF7EA8,#D6316C);box-shadow:0 3px 6px rgba(180,40,90,.4)"></div>`;
  const bow = `
    <div style="position:absolute;left:130px;top:206px;width:16px;height:18px;background:#C0392B;clip-path:polygon(100% 0,100% 100%,0 50%);border-radius:3px"></div>
    <div style="position:absolute;left:154px;top:206px;width:16px;height:18px;background:#C0392B;clip-path:polygon(0 0,0 100%,100% 50%);border-radius:3px"></div>
    <div style="position:absolute;left:145px;top:209px;width:10px;height:12px;border-radius:3px;background:#8E2018"></div>`;

  switch (stage) {
    case 0: return { back: '', front: patch + collarRope };
    case 1: return { back: '', front: straw + collarLeather };
    case 2: return { back: '', front: vest + collarJewel + bow + featherHat };
    case 3: return { back: cape, front: collarJewel + bow + topHat };
    case 4: return { back: cape, front: monocle + collarJewel + bow + crown + scepter };
    default: return { back: '', front: '' };
  }
}
