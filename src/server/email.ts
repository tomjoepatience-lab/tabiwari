type EmailKind = 'verify_email' | 'reset_password';

const APP_URL = (process.env.PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

export async function sendAuthEmail(
  to: string,
  displayName: string,
  kind: EmailKind,
  token: string,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn('[email] RESEND_API_KEY / AUTH_EMAIL_FROM is not configured');
    return false;
  }

  const action = kind === 'verify_email' ? 'verify' : 'reset';
  const url = `${APP_URL}/auth-action?action=${action}&token=${encodeURIComponent(token)}`;
  const isVerify = kind === 'verify_email';
  const subject = isVerify ? '【マネコ】メールアドレスを確認してください' : '【マネコ】パスワード再設定';
  const heading = isVerify ? 'メールアドレスの確認' : 'パスワードの再設定';
  const description = isVerify
    ? '下のボタンを押して、マネコへの登録を完了してください。このリンクは24時間有効です。'
    : '下のボタンから新しいパスワードを設定してください。このリンクは30分間有効です。心当たりがなければ、このメールは無視してください。';
  const button = isVerify ? 'メールアドレスを確認する' : 'パスワードを再設定する';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html: `<!doctype html><html lang="ja"><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#29231e;background:#fffaf3;padding:32px">
        <div style="max-width:520px;margin:auto;background:#fff;border:1px solid #eadfce;border-radius:20px;padding:28px">
          <h1 style="font-size:22px;margin:0 0 16px">🐱 ${heading}</h1>
          <p>${escapeHtml(displayName)}さん、こんにちは。</p>
          <p style="line-height:1.7">${description}</p>
          <p style="margin:28px 0"><a href="${url}" style="display:inline-block;background:#e8792e;color:white;text-decoration:none;padding:13px 20px;border-radius:12px;font-weight:700">${button}</a></p>
          <p style="font-size:12px;color:#756b62;word-break:break-all">ボタンが開かない場合：${url}</p>
        </div>
      </body></html>`,
    }),
  });
  if (!response.ok) {
    console.error('[email] Resend error:', response.status, await response.text());
    return false;
  }
  return true;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] || char);
}

export async function notifySupportRequest(email: string, message: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  const to = process.env.SUPPORT_EMAIL;
  if (!apiKey || !from || !to) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email,
      subject: '【マネコ】サポートへのお問い合わせ',
      text: `返信先: ${email}\n\n${message}`,
    }),
  });
  if (!response.ok) {
    console.error('[email] support notification error:', response.status, await response.text());
    return false;
  }
  return true;
}
