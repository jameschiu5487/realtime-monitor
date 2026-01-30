"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  Wallet,
  FileText,
  TestTube,
  Settings,
  Bell,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { LogoutButton } from "@/components/auth/logout-button";

const navItems = [
  {
    title: "Overview",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Strategies",
    href: "/strategies",
    icon: TrendingUp,
  },
  {
    title: "Positions",
    href: "/positions",
    icon: Wallet,
  },
  {
    title: "Orders",
    href: "/orders",
    icon: FileText,
  },
  {
    title: "Backtest",
    href: "/backtest",
    icon: TestTube,
  },
  {
    title: "Settings",
    href: "/settings",
    icon: Settings,
  },
];

interface SidebarProps {
  userEmail?: string;
}

export function Sidebar({ userEmail }: SidebarProps) {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-64 flex-col border-r bg-sidebar">
      <div className="flex h-16 items-center justify-between border-b px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <h1>Backtest System</h1>
        </Link>
      </div>
      <nav className="flex-1 space-y-1 p-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.title}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-4">
        {userEmail && (
          <div className="mb-3 truncate text-xs text-muted-foreground">
            {userEmail}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon">
            <Bell className="h-4 w-4" />
            <span className="sr-only">Notifications</span>
          </Button>
          <ThemeToggle />
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
