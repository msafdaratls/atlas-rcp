import type { DefaultSession } from "next-auth";
import type { Role } from "@prisma/client";

declare module "next-auth" {
  interface User {
    organisationId: string;
    roles: Role[];
    fullNameEn: string;
    fullNameAr: string;
    orgType: "CLIENT" | "ATLAS";
    orgNameEn: string;
    orgNameAr: string;
    orgLogoKey: string | null;
    locale: string;
  }

  interface Session {
    user: {
      id: string;
      organisationId: string;
      roles: Role[];
      fullNameEn: string;
      fullNameAr: string;
      orgType: "CLIENT" | "ATLAS";
      orgNameEn: string;
      orgNameAr: string;
      orgLogoKey: string | null;
      locale: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    organisationId: string;
    roles: Role[];
    fullNameEn: string;
    fullNameAr: string;
    orgType: "CLIENT" | "ATLAS";
    orgNameEn: string;
    orgNameAr: string;
    orgLogoKey: string | null;
    locale: string;
  }
}
