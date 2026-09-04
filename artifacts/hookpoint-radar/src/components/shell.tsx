import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Radar, Target, Activity, Plug, ShieldCheck, Menu, LogOut, Lightbulb } from "lucide-react";
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
    { href: "/insights", label: "Insights", icon: Lightbulb },
    { href: "/signals", label: "Signals", icon: Activity },
    { href: "/sources", label: "Sources", icon: Plug },
    { href: "/quality", label: "Data Quality", icon: ShieldCheck },
  ];

  const NavLinks = ({ isMobile = false }: { isMobile?: boolean }) => (
    <>
      {navItems.map((item) => {
        const isActive = location === item.href || location.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href}>
            <div
              data-testid={`nav-${item.label.toLowerCase().replace(" ", "-")}`}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer text-sm font-medium ${
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                  : isMobile
                    ? "text-foreground hover:bg-muted"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <item.icon className={`h-[18px] w-[18px] ${isActive ? "" : "opacity-70"}`} />
              {item.label}
            </div>
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="flex min-h-[100dvh] w-full bg-background flex-col md:flex-row font-sans">
      {/* Mobile Nav */}
      <header className="flex h-16 items-center justify-between border-b bg-card px-4 md:hidden shrink-0 shadow-sm z-20">
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
            <SheetContent side="left" className="w-[260px] sm:w-[300px] border-r-0">
              <div className="flex items-center gap-2 mb-8 mt-2 text-primary">
                <div className="bg-primary text-primary-foreground p-1.5 rounded-lg">
                  <Radar className="h-5 w-5" />
                </div>
                <span className="text-xl font-bold tracking-tight">Hookpoint</span>
              </div>
              <nav className="grid gap-1">
                <NavLinks isMobile />
              </nav>
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 text-primary">
            <div className="bg-primary text-primary-foreground p-1 rounded-md">
              <Radar className="h-4 w-4" />
            </div>
            <span className="font-bold tracking-tight">Hookpoint</span>
          </div>
        </div>

        {isLoaded && user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full overflow-hidden h-8 w-8 ring-2 ring-primary/20">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user.imageUrl} alt={user.fullName || "User"} />
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
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
      <aside className="hidden bg-sidebar text-sidebar-foreground md:flex md:w-[260px] shrink-0 flex-col shadow-xl z-20">
        <div className="flex h-20 items-center px-6 mb-2">
          <Link href="/dashboard">
            <div className="flex items-center gap-3 cursor-pointer text-sidebar-primary-foreground hover:opacity-90 transition-opacity">
              <div className="bg-white text-sidebar p-1.5 rounded-lg shadow-sm">
                <Radar className="h-5 w-5" />
              </div>
              <span className="text-xl font-bold tracking-tight">Hookpoint</span>
            </div>
          </Link>
        </div>

        <div className="flex-1 overflow-auto py-2 px-4">
          <div className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-3 px-2">
            Your workspace
          </div>
          <nav className="grid items-start gap-1">
            <NavLinks />
          </nav>
        </div>

        <div className="mt-auto p-4">
          <div className="mb-4 rounded-xl bg-sidebar-accent/30 border border-sidebar-accent/50 p-4 text-xs">
            <p className="font-semibold mb-1.5 flex items-center gap-1.5 text-white">
              <ShieldCheck className="h-3.5 w-3.5" /> Guidelines
            </p>
            <p className="text-sidebar-foreground/80 leading-relaxed">
              Scores indicate hypothesis, not buyer intent. Suppressed accounts require manual review.
            </p>
          </div>

          {isLoaded && user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="w-full justify-start gap-3 h-14 px-3 rounded-xl hover:bg-sidebar-accent hover:text-white text-sidebar-foreground" data-testid="button-user-menu">
                  <Avatar className="h-8 w-8 ring-2 ring-sidebar-primary/20">
                    <AvatarImage src={user.imageUrl} alt={user.fullName || "User"} />
                    <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs font-bold">
                      {user.firstName?.charAt(0)}{user.lastName?.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col items-start overflow-hidden flex-1">
                    <span className="text-sm font-semibold truncate w-full text-left text-white">{user.fullName}</span>
                    <span className="text-xs opacity-70 truncate w-full text-left">{user.primaryEmailAddress?.emailAddress}</span>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="right" className="w-56 ml-2 rounded-xl">
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
      <main className="flex-1 overflow-auto bg-background flex flex-col relative z-10">
        <header className="hidden md:flex h-20 items-center px-10 border-b border-border/60 bg-card shrink-0 shadow-sm/50">
           <div className="flex-1" />
           {/* Top header - empty for now, aligns with reference keeping top right clean except for maybe notifications or profile if it was there */}
        </header>
        <div className="p-6 md:p-10 mx-auto max-w-6xl w-full flex-1">
          {children}
        </div>
      </main>
    </div>
  );
}
