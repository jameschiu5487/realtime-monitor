"use client";

import { logout } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  return (
    <form action={logout}>
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        title="Logout"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </form>
  );
}
