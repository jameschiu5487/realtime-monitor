"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  Wallet,
  TestTube,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Radar,
  Menu,
  X,
  Dice5,
  FileBarChart,
  ArrowRightLeft,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { LogoutButton } from "@/components/auth/logout-button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navItems = [
  { title: "Overview", href: "/", icon: LayoutDashboard },
  { title: "Strategies", href: "/strategies", icon: TrendingUp },
  { title: "Positions", href: "/positions", icon: Wallet },
  { title: "Opportunity", href: "/opportunity", icon: Radar },
  { title: "Basis", href: "/basis-monitor", icon: ArrowRightLeft },
  { title: "Polymarket", href: "/polymarket", icon: Dice5 },
  { title: "Backtest", href: "/backtest", icon: TestTube },
  { title: "Report", href: "/report", icon: FileBarChart },
  { title: "Settings", href: "/settings", icon: Settings },
];

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";

interface SidebarProps {
  userEmail?: string;
}

export function Sidebar({ userEmail }: SidebarProps) {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored !== null) {
      setIsCollapsed(stored === "true");
    }
  }, []);

  // Close mobile sidebar on navigation
  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname]);

  const toggleCollapsed = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(newState));
  };

  if (!mounted) {
    return (
      <>
        {/* Mobile top bar placeholder */}
        <div className="fixed top-0 left-0 right-0 z-30 flex h-12 items-center border-b bg-background px-3 md:hidden">
          <div className="h-5 w-5 bg-muted animate-pulse rounded" />
          <div className="ml-3 h-4 w-24 bg-muted animate-pulse rounded" />
        </div>
        {/* Desktop sidebar placeholder */}
        <div className="hidden md:flex h-full w-64 flex-col border-r bg-sidebar">
          <div className="flex h-14 items-center border-b px-4">
            <div className="h-5 w-28 bg-muted animate-pulse rounded" />
          </div>
        </div>
      </>
    );
  }

  return (
    <TooltipProvider delayDuration={0}>
      {/* ===== MOBILE: Top bar with hamburger ===== */}
      <div className="fixed top-0 left-0 right-0 z-30 flex h-12 items-center gap-3 border-b bg-background/95 backdrop-blur-sm px-3 md:hidden">
        <button
          onClick={() => setIsMobileOpen(true)}
          className="flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent transition-colors -ml-1"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold truncate">Trading System</span>
      </div>

      {/* ===== MOBILE: Backdrop ===== */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* ===== MOBILE: Sidebar drawer ===== */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-sidebar shadow-xl md:hidden",
          "transition-transform duration-300 ease-in-out",
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4 shrink-0">
          <Link
            href="/"
            className="font-semibold truncate text-sm"
            onClick={() => setIsMobileOpen(false)}
          >
            Trading System
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMobileOpen(false)}
            className="h-8 w-8 shrink-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.title}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t p-3 shrink-0">
          {userEmail && (
            <div className="mb-3 truncate text-xs text-muted-foreground">
              {userEmail}
            </div>
          )}
          <div className="flex items-center gap-2">
            <ThemeToggle collapsed={false} />
            <LogoutButton collapsed={false} />
          </div>
        </div>
      </div>

      {/* ===== DESKTOP: Normal sidebar ===== */}
      <div
        className={cn(
          "hidden md:flex h-full flex-col border-r bg-sidebar transition-all duration-300 ease-in-out",
          isCollapsed ? "w-16" : "w-64"
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center border-b shrink-0",
            isCollapsed ? "justify-center px-2" : "justify-between px-4"
          )}
        >
          {!isCollapsed && (
            <Link
              href="/"
              className="flex items-center gap-2 font-semibold truncate"
            >
              <span className="text-sm">Trading System</span>
            </Link>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleCollapsed}
                className="h-8 w-8 shrink-0"
              >
                {isCollapsed ? (
                  <PanelLeft className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
                <span className="sr-only">
                  {isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            </TooltipContent>
          </Tooltip>
        </div>

        <nav
          className={cn(
            "flex-1 space-y-1 overflow-y-auto",
            isCollapsed ? "p-2" : "p-3"
          )}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));

            const linkContent = (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center rounded-lg text-sm font-medium transition-colors",
                  isCollapsed
                    ? "h-10 w-10 justify-center"
                    : "gap-3 px-3 py-2.5",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!isCollapsed && <span>{item.title}</span>}
              </Link>
            );

            if (isCollapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right">{item.title}</TooltipContent>
                </Tooltip>
              );
            }

            return <div key={item.href}>{linkContent}</div>;
          })}
        </nav>

        <div
          className={cn(
            "border-t shrink-0",
            isCollapsed ? "p-2" : "p-3"
          )}
        >
          {!isCollapsed && userEmail && (
            <div className="mb-3 truncate text-xs text-muted-foreground">
              {userEmail}
            </div>
          )}
          <div
            className={cn(
              "flex items-center",
              isCollapsed ? "flex-col gap-2" : "gap-2"
            )}
          >
            <ThemeToggle collapsed={isCollapsed} />
            <LogoutButton collapsed={isCollapsed} />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
