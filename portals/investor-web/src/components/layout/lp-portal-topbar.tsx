"use client"

import { setLpClientScope } from "@/lib/lp-portal/client-scope"
import { ValuationBadge } from "@/components/lp-portal/valuation-badge"
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Bell, Building2, CalendarDays, FileText, LogOut, Menu, Search, Settings, User as UserIcon, X } from "lucide-react"
import { signOut, useSessionUser, userInitials } from "@matanho/portal-kit/session"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ORG_NAME, ORG_LOGO_PATH } from "@/lib/branding"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { useLpPortal } from "@/components/lp-portal/lp-portal-context"
import { LpPortalSidebar } from "@/components/layout/lp-portal-sidebar"
import { lpPortalApi } from "@/lib/api/lp-portal-api"
import { formatDate } from "@/lib/lp-portal/format"
import { mapDocumentRow } from "@/lib/lp-portal/mappers"

const navigationResults = [
  { label: "Dashboard", detail: "Portfolio overview", href: "/lp-portal", icon: Building2 },
  { label: "Capital Activity", detail: "Calls and distributions", href: "/lp-portal/capital-activity", icon: Building2 },
  { label: "Performance", detail: "Investment value history", href: "/lp-portal/performance", icon: Building2 },
  { label: "Documents", detail: "Reports and notices", href: "/lp-portal/documents", icon: FileText },
  { label: "Account Activity", detail: "Transactions and statements", href: "/lp-portal/account-activity", icon: Building2 },
  { label: "Requests", detail: "Open investor requests", href: "/lp-portal/requests", icon: FileText },
]

function PortalSearch({ mobile = false }: { mobile?: boolean }) {
  const router = useRouter()
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [docResults, setDocResults] = React.useState<
    Array<{ label: string; detail: string; href: string; icon: typeof FileText }>
  >([])

  React.useEffect(() => {
    const term = query.trim()
    if (!term) {
      setDocResults([])
      return
    }
    const timer = window.setTimeout(() => {
      void lpPortalApi
        .getDocuments({ q: term, pageSize: 5 })
        .then((res) =>
          setDocResults(
            res.data.items.map((doc) => {
              const row = mapDocumentRow(doc)
              return {
                label: row.title,
                detail: row.category,
                href: `/lp-portal/documents?document=${row.id}`,
                icon: FileText,
              }
            }),
          ),
        )
        .catch(() => setDocResults([]))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const results = React.useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return navigationResults.slice(0, 4)
    const pages = navigationResults.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(term))
    return [...pages, ...docResults].slice(0, 6)
  }, [query, docResults])

  const goTo = (href: string) => {
    setOpen(false)
    setQuery("")
    router.push(href)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative w-full">
          <Input
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && results[0]) goTo(results[0].href)
            }}
            type="search"
            aria-label="Search investor portal"
            placeholder={mobile ? "Search portal..." : "Search funds, documents, pages..."}
            className="h-9 rounded-full border-border bg-background pl-4 pr-10 text-xs shadow-none placeholder:text-muted-foreground"
          />
          <Search className="pointer-events-none absolute right-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={7}
        className="w-[var(--radix-popover-trigger-width)] rounded-xl border-border p-1.5 shadow-lg"
      >
        {results.length ? (
          results.map((result) => {
            const Icon = result.icon
            return (
              <button
                key={`${result.href}-${result.label}`}
                type="button"
                onClick={() => goTo(result.href)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-semibold">{result.label}</span>
                  <span className="block truncate text-[9px] text-muted-foreground">{result.detail}</span>
                </span>
              </button>
            )
          })
        ) : (
          <p className="px-3 py-5 text-center text-[11px] text-muted-foreground">No matching results</p>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** LP Portal header — fund/as-of controls plus module switcher, notifications, and profile. */
export function LpPortalTopbar() {
  const [mobileNavigationOpen, setMobileNavigationOpen] = React.useState(false)
  const {
    session,
    client,
    funds,
    selectedFundId,
    setSelectedFundId,
    asOfDate,
    setAsOfDate,
    valuationStatus,
    unreadCounts,
    notifications,
    notificationsLoading,
  } = useLpPortal()

  const orgName = client?.legalName ?? "LP Portal"
  const clientOptions = session?.clients ?? []
  const sessionUser = useSessionUser()
  const userName = sessionUser?.name ?? "Investor"
  const userRole = sessionUser?.roles.find((r) => r.portal === "investor")?.label ?? "Investor portal"
  const initials = userInitials(userName)

  const formattedAsOfDate = React.useMemo(
    () =>
      asOfDate
        ? new Date(`${asOfDate}T00:00:00`).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "—",
    [asOfDate],
  )

  const portalUnreadTotal =
    unreadCounts.requests + unreadCounts.messages + unreadCounts.notices

  return (
    <TooltipProvider>
    <div data-matanho-shared-topbar className="shrink-0 border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="flex h-20 items-center gap-2 px-6 lg:gap-3">
        <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 rounded-full lg:hidden"
              aria-label="Open portal navigation"
            >
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[288px] p-0 sm:max-w-[288px]">
            <SheetHeader className="sr-only">
              <SheetTitle>LP Portal navigation</SheetTitle>
            </SheetHeader>
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2 z-10 rounded-full"
                aria-label="Close navigation"
              >
                <X className="size-4" />
              </Button>
            </SheetClose>
            <LpPortalSidebar mobile onNavigate={() => setMobileNavigationOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* Only on the mobile drawer breakpoint. From lg up the sidebar sits
            beside this bar and carries the brand itself, so showing it here too
            put two copies of the logo side by side. */}
        <Link
          href="/home"
          className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-80 lg:hidden"
          aria-label="Matanho home"
        >
          <img
            src={ORG_LOGO_PATH}
            alt={ORG_NAME}
            className="h-10 w-auto object-contain"
            height={40}
            width={140}
          />
        </Link>

        <div className="hidden min-w-0 items-center gap-2 sm:flex">
          <div className="min-w-0 leading-tight">
            <p className="truncate text-xs font-semibold text-foreground">LP Portal</p>
            {clientOptions.length > 1 ? (
              <select
                aria-label="Investor relationship"
                data-testid="lp-client-switcher"
                className="max-w-[180px] truncate rounded border border-border bg-background text-[10px] text-muted-foreground"
                value={session?.client.investorId ?? ""}
                onChange={(e) => {
                  setLpClientScope(e.target.value)
                  window.location.reload()
                }}
              >
                {clientOptions.map((c) => (
                  <option key={c.investorId} value={c.investorId}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="truncate text-[10px] text-muted-foreground">{orgName}</p>
            )}
          </div>
        </div>

        <div className="hidden min-w-[200px] max-w-md flex-1 md:block">
          <PortalSearch />
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-1.5 lg:gap-2">
          <Select value={selectedFundId} onValueChange={setSelectedFundId}>
            <SelectTrigger
              size="sm"
              className="h-9 w-[128px] rounded-full border-border px-3 text-[11px] shadow-none sm:w-[150px]"
            >
              <Building2 className="size-3.5 shrink-0 text-primary" />
              <SelectValue placeholder="Select fund" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Funds</SelectItem>
              {funds.map((fund) => (
                <SelectItem key={fund.id} value={fund.id}>
                  {fund.shortName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <label className="relative hidden h-9 cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-3 text-[10px] text-muted-foreground md:flex">
            <span className="font-medium">As of</span>
            <span className="min-w-[82px] text-[11px] font-semibold text-foreground">{formattedAsOfDate}</span>
            <CalendarDays className="size-3.5 text-muted-foreground" />
            <input
              type="date"
              value={asOfDate}
              onChange={(event) => setAsOfDate(event.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Valuation as-of date"
            />
          </label>

          <div className="hidden h-9 min-w-[108px] flex-col justify-center rounded-full border border-border bg-background px-3 lg:flex">
            <span className="text-[7px] font-medium uppercase tracking-wide text-muted-foreground">Valuation</span>
            <ValuationBadge status={valuationStatus} className="text-[10px]" />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative size-9 shrink-0 rounded-full"
                aria-label={`${portalUnreadTotal} portal items need attention`}
              >
                <Bell className="size-[18px] text-muted-foreground" />
                {portalUnreadTotal > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold leading-none text-white">
                    {portalUnreadTotal > 9 ? "9+" : portalUnreadTotal}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-xl">
              <DropdownMenuLabel className="flex items-center justify-between">
                <span>Portal alerts</span>
                {portalUnreadTotal > 0 && (
                  <span className="text-[10px] font-normal text-primary">{portalUnreadTotal} open</span>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {notificationsLoading ? (
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  Loading alerts…
                </DropdownMenuItem>
              ) : notifications.length > 0 ? (
                notifications.map((item) => (
                  <DropdownMenuItem key={item.id} asChild>
                    <Link href={item.href} className="items-start py-2.5">
                      <span>
                        <b className="block text-xs">{item.title}</b>
                        <span className="text-[10px] text-muted-foreground">
                          {[item.fundName, formatDate(item.createdAt, "datetime")].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </Link>
                  </DropdownMenuItem>
                ))
              ) : portalUnreadTotal > 0 ? (
                <>
                  {unreadCounts.requests > 0 && (
                    <DropdownMenuItem asChild>
                      <Link href="/lp-portal/requests" className="items-start py-2.5">
                        <span>
                          <b className="block text-xs">Open requests</b>
                          <span className="text-[10px] text-muted-foreground">{unreadCounts.requests} awaiting action</span>
                        </span>
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {unreadCounts.messages > 0 && (
                    <DropdownMenuItem asChild>
                      <Link href="/lp-portal/requests?tab=messages" className="items-start py-2.5">
                        <span>
                          <b className="block text-xs">Unread messages</b>
                          <span className="text-[10px] text-muted-foreground">{unreadCounts.messages} new</span>
                        </span>
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {unreadCounts.notices > 0 && (
                    <DropdownMenuItem asChild>
                      <Link href="/lp-portal/notices" className="items-start py-2.5">
                        <span>
                          <b className="block text-xs">Notices</b>
                          <span className="text-[10px] text-muted-foreground">{unreadCounts.notices} unread</span>
                        </span>
                      </Link>
                    </DropdownMenuItem>
                  )}
                </>
              ) : (
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  No open portal alerts
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/lp-portal/notices">View all notices</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="p-2 h-auto cursor-pointer flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground transition-colors">
                <Avatar className="w-10 h-10">
                  <AvatarFallback className="bg-primary text-primary-foreground text-base">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="flex items-center gap-2 p-2">
                <Avatar className="w-10 h-10">
                  <AvatarFallback className="bg-primary text-primary-foreground text-base">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {userName}
                  </span>
                  <span className="text-xs text-muted-foreground capitalize">
                    {userRole}
                  </span>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/lp-portal/organisation">
                  <UserIcon size={18} className="mr-2" />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/lp-portal/settings">
                  <Settings size={18} className="mr-2" />
                  Settings
                </Link>
              </DropdownMenuItem>
              {sessionUser ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onClick={() => void signOut()}>
                    <LogOut size={18} className="mr-2" />
                    Sign Out
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2 md:hidden">
        <PortalSearch mobile />
        <label className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border text-muted-foreground">
          <CalendarDays className="size-4" />
          <input
            type="date"
            value={asOfDate}
            onChange={(event) => setAsOfDate(event.target.value)}
            className="sr-only"
            aria-label="Valuation as-of date"
          />
        </label>
      </div>
    </div>
    </TooltipProvider>
  )
}
