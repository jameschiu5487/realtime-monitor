import Link from "next/link";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Labels for figures computed from a child strategy's own virtual book.
 *
 * A child of a parent strategy (e.g. a Kepler sub-strategy) shares one real
 * exchange account with its siblings. Its equity_curve / pnl_series are a
 * simulation from its own fills, mark prices, fees and funding — not account
 * money. The real account equity lives on the parent page.
 *
 * No hooks, so this renders from server and client components alike.
 */
export const SIMULATED_EQUITY_LABEL = "模擬權益（虛擬帳本）";

export const SIMULATED_EQUITY_NOTE =
  "子策略權益由各自的虛擬帳本（自身成交、標記價、手續費、資金費）計算，為模擬值，不等於帳戶實際資金；帳戶實際資金見上方。";

/** Same note for a child page, where the real money is on the parent page, not above. */
const CHILD_PAGE_NOTE =
  "此處權益由本子策略的虛擬帳本（自身成交、標記價、手續費、資金費）計算，為模擬值，不等於帳戶實際資金。";

export function SimulatedEquityBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        className
      )}
    >
      {SIMULATED_EQUITY_LABEL}
    </Badge>
  );
}

/**
 * Info box explaining that the figures around it are simulated.
 *
 * With `parent`, it is a child page's note and links to the parent page for
 * the real account money. Without it, it is the parent page's own note under
 * the children section ("帳戶實際資金見上方").
 */
export function SimulatedEquityNote({
  parent,
  className,
}: {
  parent?: { strategy_id: string; name: string } | null;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-xs sm:text-sm text-muted-foreground",
        className
      )}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p>
        {parent ? (
          <>
            <span className="font-medium text-foreground">{SIMULATED_EQUITY_LABEL}</span>
            {"："}
            {CHILD_PAGE_NOTE}
            帳戶實際資金請見母策略{" "}
            <Link
              href={`/strategies/${parent.strategy_id}`}
              className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
            >
              {parent.name}
            </Link>
            。
          </>
        ) : (
          SIMULATED_EQUITY_NOTE
        )}
      </p>
    </div>
  );
}
