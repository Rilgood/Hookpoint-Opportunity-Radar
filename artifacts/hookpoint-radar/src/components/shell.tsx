import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Radar, Target, Activity, Plug, ShieldCheck, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: Radar },
    { href: "/opportunities", label: "Opportunities", icon: Target },
    { href: "/signals", label: "Signals", icon: Activity },
    { href: "/sources", label: "Sources", icon: Plug },
    { href: "/quality", label: "Data Quality", icon: ShieldCheck },
  ];

  const NavLinks = () => (
    <>
      {navItems.map((item) => {
        const isActive =
          location === item.href ||
          (item.href !== "/" && location.startsWith(item.href));
        return (
          <Link key={item.href} href={item.href}>
            <div
              data-testid={`nav-${item.label.toLowerCase().replace(" ", "-")}`}
              className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${
                isActive
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </div>
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="flex min-h-screen w-full bg-background flex-col md:flex-row">
      {/* Mobile Nav */}
      <header className="flex h-14 items-center gap-4 border-b bg-card px-4 md:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              data-testid="button-mobile-navigation"
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle navigation menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[240px] sm:w-[280px]">
            <div className="flex items-center gap-2 mb-8 mt-4">
              <Radar className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold">Radar</span>
            </div>
            <nav className="grid gap-2">
              <NavLinks />
            </nav>
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2 font-semibold">
          <Radar className="h-5 w-5 text-primary" />
          <span>Hookpoint Radar</span>
        </div>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden border-r bg-card md:block md:w-[240px] lg:w-[280px] shrink-0">
        <div className="flex h-full max-h-screen flex-col">
          <div className="flex h-14 items-center border-b px-6 lg:h-[60px]">
            <Link href="/">
              <div className="flex items-center gap-2 font-bold cursor-pointer text-lg">
                <Radar className="h-6 w-6 text-primary" />
                <span>Hookpoint</span>
              </div>
            </Link>
          </div>
          <div className="flex-1 overflow-auto py-6">
            <nav className="grid items-start px-4 text-sm font-medium gap-1">
              <NavLinks />
            </nav>
          </div>
          <div className="mt-auto p-4">
            <div className="rounded-lg bg-muted p-4 text-xs shadow-sm">
              <p className="font-semibold mb-1">Product Guardrails</p>
              <p className="text-muted-foreground leading-relaxed">
                Scores indicate hypothesis, not buyer intent. Suppressed
                accounts require manual review.
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
