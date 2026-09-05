import { type ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Radar,
  Target,
  Activity,
  Plug,
  ShieldCheck,
  Menu,
  LogOut,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  LockKeyhole,
  ListTodo,
  Compass,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useUser, useClerk } from "@clerk/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { WorkspaceSearch } from "@/components/workspace-search";

interface ShellProps {
  children: ReactNode;
  demo?: boolean;
}
interface Profile {
  name: string;
  email: string;
  image?: string;
  initials: string;
  signOut: () => void;
}
const navigation = [
  { href: "/dashboard", label: "Dashboard", title: "Daily radar", icon: Radar },
  {
    href: "/opportunities",
    label: "Opportunities",
    title: "Opportunities",
    icon: Target,
  },
  {
    href: "/work-queue",
    label: "Work queue",
    title: "Work queue",
    icon: ListTodo,
  },
  { href: "/insights", label: "Insights", title: "Insights", icon: Lightbulb },
  { href: "/signals", label: "Signals", title: "Signal feed", icon: Activity },
  {
    href: "/setup",
    label: "Workspace setup",
    title: "Workspace setup",
    icon: Compass,
  },
  { href: "/sources", label: "Sources", title: "Sources", icon: Plug },
  {
    href: "/quality",
    label: "Data Quality",
    title: "Data quality",
    icon: ShieldCheck,
  },
];

export function Shell({ children, demo = false }: ShellProps) {
  return demo ? (
    <WorkspaceShell demo>{children}</WorkspaceShell>
  ) : (
    <AuthenticatedShell>{children}</AuthenticatedShell>
  );
}
function AuthenticatedShell({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <WorkspaceShell
      profile={
        user
          ? {
              name: user.fullName || "My workspace",
              email: user.primaryEmailAddress?.emailAddress || "",
              image: user.imageUrl,
              initials: `${user.firstName?.charAt(0) || ""}${user.lastName?.charAt(0) || ""}`,
              signOut: () => {
                void signOut({ redirectUrl: basePath || "/" });
              },
            }
          : undefined
      }
    >
      {children}
    </WorkspaceShell>
  );
}
function WorkspaceShell({
  children,
  demo = false,
  profile,
}: ShellProps & { profile?: Profile }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const active = navigation.find(
    (item) => location === item.href || location.startsWith(`${item.href}/`),
  );
  const nav = (mobile = false) => (
    <nav
      className="grid gap-1"
      aria-label={mobile ? "Mobile navigation" : "Workspace navigation"}
    >
      {navigation.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setMobileOpen(false)}
          aria-current={active?.href === item.href ? "page" : undefined}
          className={
            "workspace-nav-item " + (item.href === "/setup" ? "mt-5" : "")
          }
          data-testid={`nav-${item.label.toLowerCase().replace(" ", "-")}`}
        >
          <item.icon className="workspace-nav-icon size-[18px]" />
          {item.label}
          {active?.href === item.href && (
            <span className="ml-auto size-1 rounded-full bg-blue-500/70" />
          )}
        </Link>
      ))}
    </nav>
  );
  const brand = (
    <Link href="/dashboard" className="flex items-center gap-3">
      <span className="brand-lens">
        <Radar className="size-[23px]" strokeWidth={1.6} />
      </span>
      <span>
        <strong className="block text-[20px] font-semibold tracking-[-.045em] text-foreground">
          Hookpoint<span className="text-primary">.</span>
        </strong>
        <span className="text-[10px] font-medium tracking-[.025em] text-muted-foreground">
          Opportunity Radar
        </span>
      </span>
    </Link>
  );
  const account = profile ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-14 w-full justify-start gap-3 rounded-2xl px-2 text-foreground hover:bg-white/70"
          data-testid="button-user-menu"
        >
          <Avatar className="size-8">
            <AvatarImage src={profile.image} alt="" />
            <AvatarFallback className="bg-blue-100/70 text-blue-700">
              {profile.initials || "HP"}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-semibold">
              {profile.name}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {profile.email}
            </span>
          </span>
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>My account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={profile.signOut}
          data-testid="menu-item-logout"
        >
          <LogOut className="mr-2 size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : (
    <div className="glass-inset flex items-center gap-2.5 p-3">
      <div className="rounded-full border border-white bg-white/70 p-2 text-slate-500">
        <Radar className="size-4" />
      </div>
      <div>
        <p className="text-[12px] font-semibold text-foreground">
          {demo ? "Local workspace" : "Your workspace"}
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {demo ? "Live collection disabled" : "Private intelligence"}
        </p>
      </div>
    </div>
  );
  return (
    <div className="workspace-layout">
      <div className="workspace-atmosphere" aria-hidden="true" />
      <a
        className="sr-only z-50 focus:not-sr-only focus:absolute focus:rounded focus:bg-white focus:p-4"
        href="#workspace-main"
      >
        Skip to content
      </a>
      <aside className="workspace-sidebar glass-panel">
        <div className="px-3 pb-10 pt-3">{brand}</div>
        <p className="mb-3 px-4 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-400">
          Workspace
        </p>
        {nav()}
        <div className="mt-auto pt-8">
          <div className="mb-4 flex items-center gap-2 px-3 text-[10px] text-muted-foreground">
            <LockKeyhole className="size-3.5" />
            {demo ? "Isolated on this computer" : "Private workspace"}
          </div>
          {account}
        </div>
      </aside>
      <div className="min-w-0">
        <header className="workspace-header glass-toolbar">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Open navigation"
                data-testid="button-mobile-navigation"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="glass-popover m-3 flex h-[calc(100dvh-24px)] w-[280px] flex-col overflow-y-auto rounded-[28px] p-5"
            >
              <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
              <div className="mb-7 mt-6">{brand}</div>
              {nav(true)}
              <div className="mt-auto">{account}</div>
            </SheetContent>
          </Sheet>
          <div className="hidden items-center gap-2.5 text-[12px] md:flex">
            <span className="text-muted-foreground">Workspace</span>
            <ChevronRight className="size-3.5 text-muted-foreground" />
            <span className="font-medium">
              {active?.title || "Account brief"}
            </span>
          </div>
          {demo && (
            <span className="workspace-local-badge">Local workspace</span>
          )}
          <div className="ml-auto">
            <WorkspaceSearch />
          </div>
        </header>
        <main id="workspace-main" className="workspace-content">
          {children}
        </main>
      </div>
    </div>
  );
}
