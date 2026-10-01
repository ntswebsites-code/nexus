"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import {
  Activity,
  BellRing,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  FolderLock,
  HandCoins,
  LayoutDashboard,
  Mail,
  MessageSquareText,
  ReceiptText,
  Repeat2,
  Settings,
  TrendingUp,
  WalletCards,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLpPortal } from "@/components/lp-portal/lp-portal-context"
import { cn } from "@/lib/utils"
import { ORG_LOGO_PATH, ORG_NAME } from "@/lib/branding"

interface LpPortalSidebarProps {
  mobile?: boolean
  onNavigate?: () => void
}

const baseNavigation = [
  { label: "Dashboard", href: "/lp-portal", icon: LayoutDashboard },
  { label: "Performance", href: "/lp-portal/performance", icon: TrendingUp },
  { label: "Account Activity", href: "/lp-portal/account-activity", icon: Activity },
  { label: "Capital Calls", href: "/lp-portal/capital-activity?tab=calls", icon: CircleDollarSign },
  { label: "Distributions", href: "/lp-portal/capital-activity?tab=distributions", icon: HandCoins },
  { label: "Subscriptions & Redemptions", href: "/lp-portal/subscriptions-redemptions", icon: Repeat2 },
  { label: "Statements & Reports", href: "/lp-portal/documents?category=Fund%20Reports", icon: ReceiptText },
  { label: "Documents", href: "/lp-portal/documents", icon: FolderLock },
  { label: "Requests", href: "/lp-portal/requests", icon: Mail, countKey: "requests" as const },
  { label: "Messages", href: "/lp-portal/requests?tab=messages", icon: MessageSquareText, countKey: "messages" as const },
  { label: "Notices", href: "/lp-portal/notices", icon: BellRing, countKey: "notices" as const },
  { label: "My Organisation", href: "/lp-portal/organisation", icon: Building2 },
  { label: "Settings", href: "/lp-portal/settings", icon: Settings },
]

const privateCapitalItems = [
  { label: "Fund Overview", href: "/lp-portal" },
  { label: "Commitment", href: "/lp-portal#capital-position" },
  { label: "Capital Calls", href: "/lp-portal/capital-activity?tab=calls" },
  { label: "Distributions", href: "/lp-portal/capital-activity?tab=distributions" },
  { label: "Capital Account", href: "/lp-portal/account-activity?structure=private-capital" },
]

const openEndedItems = [
  { label: "Fund Overview", href: "/lp-portal" },
  { label: "Investor Account", href: "/lp-portal#open-ended-account" },
  { label: "Subscriptions", href: "/lp-portal/subscriptions-redemptions?type=subscriptions" },
  { label: "Redemptions", href: "/lp-portal/subscriptions-redemptions?type=redemptions" },
  { label: "Account Holdings", href: "/lp-portal/account-activity?structure=open-ended" },
]

export function LpPortalSidebar({ mobile = false, onNavigate }: LpPortalSidebarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { operatingModel, unreadCounts } = useLpPortal()
  const [collapsed, setCollapsed] = React.useState(false)
  const [investmentsOpen, setInvestmentsOpen] = React.useState(false)
  const isCollapsed = mobile ? false : collapsed

  const isActive = (href: string) => {
    const [hrefWithoutQuery, query] = href.split("?")
    const hrefPath = hrefWithoutQuery.split("#")[0]
    if (href.includes("#")) return false
    if (hrefPath === "/lp-portal") return pathname === hrefPath
    if (!pathname.startsWith(hrefPath)) return false
    if (hrefPath === "/lp-portal/requests") {
      const expectsMessages = query === "tab=messages"
      return expectsMessages ? searchParams.get("tab") === "messages" : searchParams.get("tab") !== "messages"
    }
    if (query?.startsWith("tab=")) return searchParams.get("tab") === query.slice(4)
    return true
  }

  const investmentGroups =
    operatingModel === "MIXED"
      ? [
          { title: "Private Capital", items: privateCapitalItems },
          { title: "Open-Ended", items: openEndedItems },
        ]
      : [{
          title: operatingModel === "PRIVATE_CAPITAL" ? "Private Capital" : "Open-Ended",
          items: operatingModel === "PRIVATE_CAPITAL" ? privateCapitalItems : openEndedItems,
        }]

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-[#edf0f5] bg-white transition-[width] duration-200",
        mobile ? "w-full" : isCollapsed ? "w-[62px]" : "w-[206px]",
      )}
    >
      {/* Brand lockup. The sidebar now runs the full height beside the topbar
          rather than starting below it, so it opens with the logo like the
          staff-side modules do. Hidden on the mobile drawer, where the topbar
          already shows the brand. */}
      {!mobile && (
        <div
          className={cn(
            "flex h-20 shrink-0 items-center border-b border-[#edf0f5]",
            isCollapsed ? "justify-center px-2" : "px-4",
          )}
        >
          {isCollapsed ? (
            <span
              className="grid h-9 w-9 place-items-center rounded-lg bg-[#1e293b] text-sm font-bold text-white"
              aria-hidden="true"
            >
              {ORG_NAME.charAt(0)}
            </span>
          ) : (
            <img
              src={ORG_LOGO_PATH}
              alt={ORG_NAME}
              className="h-9 w-auto max-w-[140px] object-contain object-left"
            />
          )}
        </div>
      )}

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        <Link
          href="/lp-portal"
          onClick={onNavigate}
          title={isCollapsed ? "Dashboard" : undefined}
          className={cn(
            "flex min-h-10 items-center gap-3 rounded-xl px-2.5 text-[11px] font-medium transition-colors",
            isActive("/lp-portal") && pathname === "/lp-portal"
              ? "bg-[#f0f5fd] font-semibold text-[#1262d6]"
              : "text-[#202634] hover:bg-[#f6f8fb]",
            isCollapsed && "justify-center px-0",
          )}
        >
          <span className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-[#8792a6]",
            isActive("/lp-portal") && pathname === "/lp-portal" && "bg-[#e6effd] text-[#1262d6]",
          )}>
            <LayoutDashboard className="size-4" />
          </span>
          {!isCollapsed && <span>Dashboard</span>}
        </Link>

        <div>
          <button
            type="button"
            title={isCollapsed ? "My Investments" : undefined}
            onClick={() => {
              if (isCollapsed) setCollapsed(false)
              setInvestmentsOpen((open) => !open)
            }}
            className={cn(
              "flex min-h-10 w-full items-center gap-3 rounded-xl px-2.5 text-[11px] font-medium text-[#202634] transition-colors hover:bg-[#f6f8fb]",
              pathname.startsWith("/lp-portal/investments") && "bg-[#f0f5fd] font-semibold text-[#1262d6]",
              isCollapsed && "justify-center px-0",
            )}
          >
            <span className="flex size-7 shrink-0 items-center justify-center text-[#8792a6]">
              <WalletCards className="size-4" />
            </span>
            {!isCollapsed && (
              <span className="flex-1 text-left">My Investments</span>
            )}
          </button>

          {!isCollapsed && investmentsOpen && (
            <div className="ml-6 border-l border-[#e4e9f1] py-1 pl-3">
              {investmentGroups.map((group) => (
                <div key={group.title} className="mb-1 last:mb-0">
                  {investmentGroups.length > 1 && (
                    <p className="px-2 pb-1 pt-2 text-[8px] font-semibold uppercase tracking-wider text-[#9aa3b2]">
                      {group.title}
                    </p>
                  )}
                  {group.items.map((item) => (
                    <Link
                      key={`${group.title}-${item.label}`}
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        "block rounded-xl px-2 py-1.5 text-[10px] text-[#6f798b] hover:bg-[#f6f8fb] hover:text-[#202634]",
                        isActive(item.href) && "bg-[#f0f5fd] font-medium text-[#1262d6]",
                      )}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {baseNavigation.slice(1).map((item) => {
          const Icon = item.icon
          const count = item.countKey ? unreadCounts[item.countKey] : undefined
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              title={isCollapsed ? item.label : undefined}
              className={cn(
                "flex min-h-10 items-center gap-3 rounded-xl px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                isActive(item.href)
                  ? "bg-[#f0f5fd] font-semibold text-[#1262d6]"
                  : "text-[#202634] hover:bg-[#f6f8fb]",
                isCollapsed && "relative justify-center px-0",
              )}
            >
              <span className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-[#8792a6]",
                isActive(item.href) && "bg-[#e6effd] text-[#1262d6]",
              )}>
                <Icon className="size-4" />
              </span>
              {!isCollapsed && <span className="min-w-0 flex-1 leading-tight">{item.label}</span>}
              {typeof count === "number" && count > 0 && (
                <span className={cn(
                  "flex size-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#075fd8] text-[8px] font-semibold text-white",
                  isCollapsed && "absolute right-0 top-0 size-4 min-w-0 px-0",
                )}>
                  {count}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {!mobile && (
        <div className="p-2 pb-4">
          <Button
            variant="ghost"
            onClick={() => setCollapsed((value) => !value)}
            className={cn(
              "h-9 w-full rounded-full px-1.5 text-[10px] font-medium text-[#313846] hover:bg-[#f6f8fb]",
              isCollapsed ? "justify-center" : "justify-start gap-2",
            )}
            aria-label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
          >
            <span className="flex size-5 items-center justify-center rounded-full border border-[#9ba5b5] text-[#667085]">
              {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronLeft className="size-3" />}
            </span>
            {!isCollapsed && <span>Collapse navigation</span>}
          </Button>
        </div>
      )}
    </aside>
  )
}
