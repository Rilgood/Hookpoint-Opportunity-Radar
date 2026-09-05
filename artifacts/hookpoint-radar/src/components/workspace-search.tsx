import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  useListRadarCompanies,
  getListRadarCompaniesQueryKey,
} from "@workspace/api-client-react";
import { ArrowRight, Building2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandGroup,
} from "@/components/ui/command";

export function WorkspaceSearch() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [, navigate] = useLocation();
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
  const params = { q: query || undefined, limit: 6 };
  const results = useListRadarCompanies(params, {
    query: { enabled: open, queryKey: getListRadarCompaniesQueryKey(params) },
  });
  const pendingSearch = search.trim() !== query;
  const go = (path: string) => {
    setOpen(false);
    setSearch("");
    navigate(path);
  };
  return (
    <>
      <Button
        variant="outline"
        className="workspace-search-trigger gap-2 px-3.5 shadow-none"
        onClick={() => setOpen(true)}
        aria-label="Search workspace"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Find an account…</span>
        <kbd className="ml-8 hidden rounded-md border border-slate-200/60 bg-white/50 px-1.5 py-0.5 font-sans text-[10px] md:inline">
          ⌘ K
        </kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0">
          <DialogTitle className="sr-only">Search workspace</DialogTitle>
          <DialogDescription className="sr-only">
            Find an account or jump to a workspace page. Use the arrow keys to
            select a result.
          </DialogDescription>
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search by company name or domain…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {(results.isLoading || pendingSearch) && (
                <p className="p-5 text-sm text-muted-foreground" role="status">
                  Searching accounts…
                </p>
              )}
              {results.isError && (
                <div className="p-5 text-sm text-destructive">
                  Account search is unavailable.{" "}
                  <button
                    className="underline"
                    onClick={() => void results.refetch()}
                  >
                    Retry
                  </button>
                </div>
              )}
              {results.data && !pendingSearch && (
                <CommandGroup
                  heading={query ? "Matching accounts" : "Top accounts"}
                >
                  {results.data.data.data.map((company) => (
                    <CommandItem
                      key={company.id}
                      value={company.id}
                      onSelect={() => {
                        if (search.trim() === query)
                          go(`/opportunities/${company.id}`);
                      }}
                      className="gap-3 py-3"
                    >
                      <Building2 className="size-4 text-muted-foreground" />
                      <div className="flex-1">
                        <p className="font-medium">{company.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {company.domain || company.industry}
                        </p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">
                        {company.opportunity_score}
                      </span>
                    </CommandItem>
                  ))}
                  {results.data.data.total === 0 && (
                    <p className="px-3 py-5 text-sm text-muted-foreground">
                      No matching accounts.
                    </p>
                  )}
                </CommandGroup>
              )}
              <CommandGroup heading="Go to">
                <CommandItem onSelect={() => go("/work-queue")}>
                  <ArrowRight className="mr-3 size-4" />
                  Work queue
                </CommandItem>
                <CommandItem onSelect={() => go("/setup")}>
                  <ArrowRight className="mr-3 size-4" />
                  Workspace setup
                </CommandItem>
                <CommandItem onSelect={() => go("/opportunities")}>
                  <ArrowRight className="mr-3 size-4" />
                  All opportunities
                </CommandItem>
                <CommandItem onSelect={() => go("/sources")}>
                  <ArrowRight className="mr-3 size-4" />
                  Manage sources
                </CommandItem>
                <CommandItem onSelect={() => go("/quality")}>
                  <ArrowRight className="mr-3 size-4" />
                  Review data quality
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
