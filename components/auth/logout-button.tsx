"use client";

import { logout } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface LogoutButtonProps {
  collapsed?: boolean;
}

export function LogoutButton({ collapsed }: LogoutButtonProps) {
  return (
    <form action={logout}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
          >
            <LogOut className="h-4 w-4" />
            <span className="sr-only">Logout</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side={collapsed ? "right" : "top"}>
          Logout
        </TooltipContent>
      </Tooltip>
    </form>
  );
}
