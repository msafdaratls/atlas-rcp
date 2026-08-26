"use client";

import {
  BarChart3,
  Briefcase,
  Building2,
  ClipboardCheck,
  ClipboardList,
  FilePlus2,
  Files,
  FileSearch,
  FileText,
  FlaskConical,
  FolderKanban,
  HeartPulse,
  Headphones,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  TicketPercent,
  Users,
} from "lucide-react";
import type { Role } from "@prisma/client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavItem = {
  key: string;
  href: string;
  icon: LucideIcon;
  /** Roles allowed to see this item. Omitted = visible to every role in the shell. */
  roles?: Role[];
};

const CLIENT_NAV: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  {
    key: "newRequest",
    href: "/requests/new",
    icon: FilePlus2,
    roles: ["CLIENT_OWNER", "CLIENT_ADMIN", "CLIENT_USER"],
  },
  {
    key: "myRequests",
    href: "/requests",
    icon: ClipboardList,
    roles: ["CLIENT_OWNER", "CLIENT_ADMIN", "CLIENT_USER"],
  },
  {
    key: "reports",
    href: "/reports",
    icon: FileText,
    roles: ["CLIENT_OWNER", "CLIENT_ADMIN", "CLIENT_USER"],
  },
  {
    key: "statement",
    href: "/statement",
    icon: Receipt,
    roles: ["CLIENT_OWNER", "CLIENT_ADMIN", "CLIENT_FINANCE"],
  },
  { key: "company", href: "/company", icon: Building2 },
  { key: "support", href: "/support", icon: Headphones },
];

/** Mirrors Atlas permission → role map in `src/lib/rbac.ts`. */
const REQUESTS_ADMIN_ROLES: Role[] = [
  "INTAKE_OFFICER",
  "EVALUATOR",
  "TECHNICAL_REVIEWER",
  "DECISION_MAKER",
  "SYSTEM_ADMIN",
  "QUALITY_MANAGER",
];

const CLIENTS_READ_ROLES: Role[] = [
  "INTAKE_OFFICER",
  "DECISION_MAKER",
  "FINANCE",
  "SYSTEM_ADMIN",
  "QUALITY_MANAGER",
];

const ADMIN_NAV: NavItem[] = [
  // admin:dashboard — any Atlas staff (shell is Atlas-only)
  { key: "dashboard", href: "", icon: LayoutDashboard },
  {
    key: "workQueues",
    href: "/queues",
    icon: FolderKanban,
    roles: REQUESTS_ADMIN_ROLES,
  },
  {
    key: "requests",
    href: "/requests",
    icon: ClipboardList,
    roles: REQUESTS_ADMIN_ROLES,
  },
  {
    key: "documents",
    href: "/documents",
    icon: Files,
    roles: REQUESTS_ADMIN_ROLES,
  },
  {
    key: "clients",
    href: "/clients",
    icon: Users,
    roles: CLIENTS_READ_ROLES,
  },
  {
    key: "catalogue",
    href: "/catalogue",
    icon: Package,
    roles: ["CATALOGUE_MANAGER", "SYSTEM_ADMIN"],
  },
  {
    key: "laboratories",
    href: "/laboratories",
    icon: FlaskConical,
    roles: ["CATALOGUE_MANAGER", "SYSTEM_ADMIN"],
  },
  {
    key: "engagements",
    href: "/engagements",
    icon: Briefcase,
    roles: REQUESTS_ADMIN_ROLES,
  },
  {
    key: "labelEvalSfda",
    href: "/label-evaluator/sfda",
    icon: FileSearch,
    roles: REQUESTS_ADMIN_ROLES,
  },
  {
    key: "labelEvalCosmetics",
    href: "/label-evaluator/cosmetics",
    icon: ClipboardCheck,
    roles: REQUESTS_ADMIN_ROLES,
  },
  {
    key: "coupons",
    href: "/coupons",
    icon: TicketPercent,
    roles: ["CATALOGUE_MANAGER", "FINANCE", "SYSTEM_ADMIN"],
  },
  {
    key: "finance",
    href: "/finance",
    icon: Receipt,
    roles: ["FINANCE", "SYSTEM_ADMIN"],
  },
  {
    key: "quality",
    href: "/quality",
    icon: Shield,
    roles: ["QUALITY_MANAGER", "SYSTEM_ADMIN", "DECISION_MAKER"],
  },
  {
    key: "audit",
    href: "/audit",
    icon: ScrollText,
    roles: ["SYSTEM_ADMIN", "QUALITY_MANAGER"],
  },
  // Overview analytics — any Atlas (same as dashboard)
  { key: "analytics", href: "/analytics", icon: BarChart3 },
  {
    key: "systemHealth",
    href: "/system-health",
    icon: HeartPulse,
    roles: ["SYSTEM_ADMIN"],
  },
  {
    key: "settings",
    href: "/settings",
    icon: Settings,
    roles: ["SYSTEM_ADMIN"],
  },
];

type AppSidebarProps = {
  mode: "client" | "admin";
  basePath: string;
  /** Session roles, used to hide nav items the current user can't act on. */
  roles?: Role[];
  collapsed?: boolean;
  onNavigate?: () => void;
  className?: string;
  /** Count of not-yet-started requests, shown as a badge on the "requests" nav item. */
  newRequestsCount?: number;
};

export function AppSidebar({
  mode,
  basePath,
  roles,
  collapsed = false,
  onNavigate,
  className,
  newRequestsCount = 0,
}: AppSidebarProps) {
  const t = useTranslations(mode === "client" ? "nav.client" : "nav.admin");
  const pathname = usePathname();
  const items = (mode === "client" ? CLIENT_NAV : ADMIN_NAV).filter(
    (item) => !item.roles || item.roles.some((role) => roles?.includes(role)),
  );

  // Pick the item with the longest matching href so that e.g. "/requests/new"
  // only activates "New Request" and not the "/requests" ("My Requests") item.
  const activeKey = items.reduce<{ key: string | null; len: number }>(
    (best, item) => {
      const href = `${basePath}${item.href}`;
      const matches =
        item.href === ""
          ? pathname === href || pathname === `${basePath}/`
          : pathname === href || pathname.startsWith(`${href}/`);
      return matches && href.length > best.len
        ? { key: item.key, len: href.length }
        : best;
    },
    { key: null, len: -1 },
  ).key;

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-e border-line bg-surface",
        collapsed ? "w-[4.5rem]" : "w-60",
        className,
      )}
    >
      <nav className="flex-1 space-y-1 overflow-y-auto overscroll-contain p-2" aria-label={mode}>
        {items.map((item) => {
          const href = `${basePath}${item.href}`;
          const active = item.key === activeKey;
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={href}
              onClick={onNavigate}
              title={t(item.key)}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors duration-150 ease-out",
                collapsed && "justify-center px-0",
                active
                  ? "bg-atlas-green-tint text-atlas-green-600"
                  : "text-ink-800 hover:bg-surface-alt",
              )}
            >
              <span className="relative inline-flex shrink-0">
                <Icon className="size-5" aria-hidden />
                {item.key === "requests" && newRequestsCount > 0 ? (
                  <span className="absolute -end-1.5 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-state-bad px-1 font-data text-[10px] font-semibold leading-none text-white">
                    {newRequestsCount > 99 ? "99+" : newRequestsCount}
                  </span>
                ) : null}
              </span>
              {!collapsed ? <span>{t(item.key)}</span> : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export { CLIENT_NAV, ADMIN_NAV };
