export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export interface EmailAdapter {
  send(msg: EmailMessage): Promise<{ messageId: string }>;
}

type SmtpOptions = {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user?: string;
  pass?: string;
  rejectUnauthorized: boolean;
};

/**
 * Generic SMTP adapter (nodemailer). Works for both the local Mailpit sink
 * (no auth, port 1025, secure off) and a production ESP such as Amazon SES,
 * Postmark, or Resend (auth + TLS). All behaviour comes from env so no code
 * change is needed between environments.
 */
export class SmtpAdapter implements EmailAdapter {
  constructor(private readonly options: SmtpOptions) {}

  async send(msg: EmailMessage): Promise<{ messageId: string }> {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: this.options.host,
      port: this.options.port,
      secure: this.options.secure,
      auth:
        this.options.user && this.options.pass
          ? { user: this.options.user, pass: this.options.pass }
          : undefined,
      tls: { rejectUnauthorized: this.options.rejectUnauthorized },
    });

    const info = await transport.sendMail({
      from: this.options.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });

    return { messageId: String(info.messageId ?? `smtp-${Date.now()}`) };
  }
}

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

let cached: EmailAdapter | null = null;

export function getEmailAdapter(): EmailAdapter {
  if (cached) return cached;

  const isProd = process.env.NODE_ENV === "production";
  const port = Number(process.env.SMTP_PORT ?? "1025");

  cached = new SmtpAdapter({
    host: process.env.SMTP_HOST ?? "localhost",
    port,
    // Default secure on the implicit-TLS port (465) unless overridden.
    secure: envBool(process.env.SMTP_SECURE, port === 465),
    from: process.env.SMTP_FROM ?? "Atlas COC <noreply@localhost>",
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    // Verify certificates in production; relax for the local Mailpit sink.
    rejectUnauthorized: envBool(process.env.SMTP_REJECT_UNAUTHORIZED, isProd),
  });
  return cached;
}
