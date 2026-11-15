// Invio email per il recupero password, tramite Resend (https://resend.com).
import type { Env } from './lib';

export function mailConfigured(env: Env): boolean {
  return env.MAIL_DRY_RUN === '1' || (!!env.RESEND_API_KEY && !!env.RECOVERY_EMAIL);
}

export async function sendMail(env: Env, subject: string, text: string): Promise<void> {
  if (env.MAIL_DRY_RUN === '1') return;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM || 'Ledgy <onboarding@resend.dev>',
      to: [env.RECOVERY_EMAIL],
      subject,
      text,
    }),
  });
  if (!res.ok) {
    console.error('Invio email fallito', res.status, await res.text());
    throw new Error("Invio dell'email non riuscito");
  }
}
