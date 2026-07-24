export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export interface EmailAdapter {
  send(msg: EmailMessage): Promise<{ messageId: string }>;
}

export class MailpitAdapter implements EmailAdapter {
  constructor(
    private readonly options: {
      host: string;
      port: number;
      from: string;
    },
  ) {}

  async send(msg: EmailMessage): Promise<{ messageId: string }> {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: this.options.host,
      port: this.options.port,
      secure: false,
      tls: { rejectUnauthorized: false },
    });

    const info = await transport.sendMail({
      from: this.options.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });

    return { messageId: String(info.messageId ?? `mailpit-${Date.now()}`) };
  }
}

let cached: EmailAdapter | null = null;

export function getEmailAdapter(): EmailAdapter {
  if (cached) return cached;
  cached = new MailpitAdapter({
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number(process.env.SMTP_PORT ?? "1025"),
    from: process.env.SMTP_FROM ?? "Atlas COC <noreply@localhost>",
  });
  return cached;
}
