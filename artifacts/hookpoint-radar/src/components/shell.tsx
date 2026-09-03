import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Radar, Target, Activity, Plug, ShieldCheck, Menu, LogOut, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useUser, useClerk } from "@clerk/react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  const [location] = useLocation();
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: Radar },
    { href: "/opportunities", label: "Opportunities", icon: Target },
    { href: "/signals", label: "Signals", icon: Activity },
    { href: "/sources", label: "Sources", icon: Plug },
    { href: "/quality", label: "Data Quality", icon: ShieldCheck },
  ];

  const NavLinks = () => (
    <>
      {navItems.map((item) => {
        const isActive = location === item.href || location.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href}>
            <div
              data-testid={`nav-${item.label.toLowerCase().replace(" ", "-")}`}
              className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${
                isActive
                  ? "bg-primary/10 text-primary font-medium"
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
    <div className="flex min-h-[100dvh] w-full bg-background flex-col md:flex-row">
      {/* Mobile Nav */}
      <header className="flex h-14 items-center justify-between border-b bg-card px-4 md:hidden">
        <div className="flex items-center gap-3">
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-ml-2 md:hidden"
                data-testid="button-mobile-navigation"
              >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle navigation menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[240px] sm:w-[280px]">
              <div className="flex items-center gap-2 mb-8 mt-4">
                <img src={`${basePath}/logo.svg`} alt="Hookpoint Logo" className="h-6 w-6" />
                <span className="text-lg font-bold">Radar</span>
              </div>
              <nav className="grid gap-2">
                <NavLinks />
              </nav>
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 font-semibold">
            <img src={`${basePath}/logo.svg`} alt="Hookpoint Logo" className="h-5 w-5" />
            <span>Radar</span>
          </div>
        </div>

        {isLoaded && user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full overflow-hidden h-8 w-8">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user.imageUrl} alt={user.fullName || "User"} />
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">
                    {user.firstName?.charAt(0)}{user.lastName?.charAt(0)}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{user.fullName}</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {user.primaryEmailAddress?.emailAddress}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut({ redirectUrl: basePath || "/" })} className="text-destructive focus:text-destructive cursor-pointer">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden border-r bg-card md:flex md:w-[240px] lg:w-[280px] shrink-0 flex-col">
        <div className="flex h-14 lg:h-[60px] items-center border-b px-6">
          <Link href="/dashboard">
            <div className="flex items-center gap-3 font-bold cursor-pointer text-lg">
              <img src={`${basePath}/logo.svg`} alt="Hookpoint Logo" className="h-6 w-6" />
              <span className="tracking-tight">Hookpoint</span>
            </div>
          </Link>
        </div>

        <div className="flex-1 overflow-auto py-6">
          <nav className="grid items-start px-4 text-sm font-medium gap-1">
            <NavLinks />
          </nav>
        </div>

        <div className="mt-auto p-4 border-t border-border/50">
          <div className="mb-4 rounded-lg bg-muted/50 p-4 text-xs shadow-sm border border-border/50">
            <p className="font-semibold mb-1 flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-primary" /> Guidelines</p>
            <p className="text-muted-foreground leading-relaxed">
              Scores indicate hypothesis, not buyer intent. Suppressed accounts require manual review.
            </p>
          </div>

          {isLoaded && user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="w-full justify-start gap-3 h-12 px-2 hover:bg-muted" data-testid="button-user-menu">
                  <Avatar className="h-8 w-8 border border-border/50">
                    <AvatarImage src={user.imageUrl} alt={user.fullName || "User"} />
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {user.firstName?.charAt(0)}{user.lastName?.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col items-start overflow-hidden">
                    <span className="text-sm font-medium truncate w-full text-left">{user.fullName}</span>
                    <span className="text-xs text-muted-foreground truncate w-full text-left">{user.primaryEmailAddress?.emailAddress}</span>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="right" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut({ redirectUrl: basePath || "/" })} className="text-destructive focus:text-destructive cursor-pointer" data-testid="menu-item-logout">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-slate-50/50 dark:bg-slate-900/50">
        <div className="mx-auto max-w-6xl p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}