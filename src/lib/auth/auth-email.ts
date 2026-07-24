import { getEmailAdapter } from "@/server/notifications/email-adapter";
import { log } from "@/lib/logger";

type AuthEmailKind = "verify" | "reset";

const COPY: Record<
  AuthEmailKind,
  Record<"ar" | "en", { subject: string; heading: string; body: string; cta: string; ignore: string }>
> = {
  verify: {
    en: {
      subject: "Verify your Atlas account",
      heading: "Confirm your email",
      body: "Confirm this email address to activate your Atlas account.",
      cta: "Verify email",
      ignore: "If you didn't create an account, ignore this email.",
    },
    ar: {
      subject: "تفعيل حساب أطلس",
      heading: "تأكيد بريدك الإلكتروني",
      body: "أكّد بريدك الإلكتروني لتفعيل حسابك في أطلس.",
      cta: "تأكيد البريد",
      ignore: "إذا لم تنشئ حسابًا، تجاهل هذه الرسالة.",
    },
  },
  reset: {
    en: {
      subject: "Reset your Atlas password",
      heading: "Reset your password",
      body: "We received a request to reset your password. This link expires in 1 hour.",
      cta: "Reset password",
      ignore: "If you didn't request this, ignore this email — your password is unchanged.",
    },
    ar: {
      subject: "إعادة تعيين كلمة مرور أطلس",
      heading: "إعادة تعيين كلمة المرور",
      body: "تلقّينا طلبًا لإعادة تعيين كلمة مرورك. تنتهي صلاحية الرابط خلال ساعة.",
      cta: "إعادة تعيين كلمة المرور",
      ignore: "إذا لم تطلب ذلك، تجاهل الرسالة — لم تتغير كلمة مرورك.",
    },
  },
};

function renderHtml(
  locale: "ar" | "en",
  c: (typeof COPY)["verify"]["en"],
  link: string,
): string {
  const dir = locale === "ar" ? "rtl" : "ltr";
  return `<!doctype html><html lang="${locale}" dir="${dir}"><body style="margin:0;background:#F2F5F2;font-family:Arial,Helvetica,sans-serif;color:#252821">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #DDD;border-radius:12px;overflow:hidden">
      <tr><td style="background:#519E53;height:6px"></td></tr>
      <tr><td style="padding:28px 28px 8px"><h1 style="margin:0;font-size:20px;color:#1C2229">${c.heading}</h1></td></tr>
      <tr><td style="padding:0 28px 20px;font-size:14px;line-height:1.6;color:#4D4D4D">${c.body}</td></tr>
      <tr><td style="padding:0 28px 28px">
        <a href="${link}" style="display:inline-block;background:#519E53;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">${c.cta}</a>
      </td></tr>
      <tr><td style="padding:0 28px 28px;font-size:12px;color:#6B7280">${c.ignore}</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/** App origin for links: AUTH_URL preferred, then NEXT_PUBLIC_APP_URL. */
function appOrigin(): string {
  return (
    process.env.AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

async function sendAuthEmail(
  kind: AuthEmailKind,
  input: { to: string; locale: string; path: string },
): Promise<void> {
  const locale = input.locale === "en" ? "en" : "ar";
  const c = COPY[kind][locale];
  const link = `${appOrigin()}${input.path}`;
  const html = renderHtml(locale, c, link);
  const text = `${c.heading}\n\n${c.body}\n\n${c.cta}: ${link}\n\n${c.ignore}`;

  await getEmailAdapter().send({ to: input.to, subject: c.subject, html, text });
}

export async function sendVerificationEmail(input: {
  to: string;
  locale: string;
  token: string;
}): Promise<boolean> {
  try {
    await sendAuthEmail("verify", {
      to: input.to,
      locale: input.locale,
      path: `/${input.locale}/verify-email?token=${input.token}`,
    });
    return true;
  } catch (error) {
    log.error("auth-email", "verification email failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}

export async function sendPasswordResetEmail(input: {
  to: string;
  locale: string;
  token: string;
}): Promise<boolean> {
  try {
    await sendAuthEmail("reset", {
      to: input.to,
      locale: input.locale,
      path: `/${input.locale}/reset-password?token=${input.token}`,
    });
    return true;
  } catch (error) {
    log.error("auth-email", "password reset email failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}
