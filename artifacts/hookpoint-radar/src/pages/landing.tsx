import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Radar, Target, Activity, ArrowRight, ShieldCheck, Database, Zap, Lock } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/20">
      <header className="absolute top-0 w-full flex h-16 items-center justify-between px-6 lg:px-12 z-50">
        <div className="flex items-center gap-2 font-bold text-lg">
          <img src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/logo.svg`} alt="Hookpoint" className="h-6 w-6" />
          <span>Hookpoint</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/sign-in">
            <Button variant="ghost" className="font-medium hover:bg-muted">Sign In</Button>
          </Link>
          <Link href="/sign-up">
            <Button className="font-medium bg-primary text-primary-foreground shadow-sm">Get Started</Button>
          </Link>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden flex items-center justify-center">
          <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))] dark:bg-grid-slate-700/25 dark:[mask-image:linear-gradient(0deg,rgba(255,255,255,0.1),rgba(255,255,255,0.5))] -z-10" />

          <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center max-w-5xl">
            <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-primary/10 text-primary mb-8 animate-in slide-in-from-bottom-4 duration-700">
              <Zap className="mr-1 h-3.5 w-3.5" /> Private Beta Now Open
            </div>

            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-8 animate-in slide-in-from-bottom-6 duration-700 delay-150 fill-mode-both leading-[1.1]">
              Opportunity Intelligence<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-cyan-500">
                Backed by Evidence.
              </span>
            </h1>

            <p className="mt-4 text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto mb-10 animate-in slide-in-from-bottom-8 duration-700 delay-300 fill-mode-both">
              A private, secure workspace that tells your growth team exactly where to focus, why right now, and what requires human judgment.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in duration-700 delay-500 fill-mode-both">
              <Link href="/sign-up">
                <Button size="lg" className="w-full sm:w-auto h-12 px-8 text-base shadow-md">
                  Start Your Pilot <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Value Props Section */}
        <section className="py-24 bg-slate-50 dark:bg-slate-900/50 border-y border-slate-200 dark:border-slate-800">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid md:grid-cols-3 gap-12 max-w-5xl mx-auto">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="h-12 w-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <Database className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold">Honest Ingestion</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Seamless evidence ingestion from your configured connectors. No black boxes. We show you exactly what we find and why it matters.
                </p>
              </div>
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="h-12 w-12 rounded-xl bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center text-cyan-600 dark:text-cyan-400">
                  <Target className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold">Account Prioritization</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Identify high-fit, high-intent accounts immediately. Ranked intelligently by our proprietary evidence engine.
                </p>
              </div>
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="h-12 w-12 rounded-xl bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center text-sky-600 dark:text-sky-400">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold">Built-In Guardrails</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Automated conflict detection and safety holds. Ambiguous signals are queued for your team's manual review.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Dashboard Preview Section */}
        <section className="py-24 md:py-32">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">A briefing room for modern operators</h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Stop sifting through noise. Hookpoint surfaces the exact signals you need to act, wrapped in a workspace designed for speed and clarity.
              </p>
            </div>

            <div className="rounded-2xl border bg-card text-card-foreground shadow-2xl overflow-hidden transform-gpu perspective-1000 rotate-x-1 rotate-y-[-1deg] hover:rotate-x-0 hover:rotate-y-0 transition-transform duration-700">
              <div className="border-b bg-muted/40 p-4 flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-red-400" />
                  <div className="h-3 w-3 rounded-full bg-amber-400" />
                  <div className="h-3 w-3 rounded-full bg-green-400" />
                </div>
                <div className="ml-4 flex-1 h-6 bg-background rounded border flex items-center px-3 text-xs text-muted-foreground/70 font-mono">
                  <Lock className="h-3 w-3 mr-2" /> hookpoint.app/dashboard
                </div>
              </div>
              <div className="p-1 sm:p-4 bg-slate-100 dark:bg-slate-900 h-[400px] md:h-[600px] flex items-center justify-center relative overflow-hidden">
                {/* Abstract visualization of the dashboard to avoid fake data issues, looks like a UI wireframe */}
                <div className="absolute inset-0 p-8 grid grid-cols-1 md:grid-cols-4 gap-6 opacity-80 pointer-events-none">
                  {/* Sidebar skeleton */}
                  <div className="hidden md:block col-span-1 space-y-4">
                    <div className="h-8 w-32 bg-slate-200 dark:bg-slate-800 rounded-md mb-8" />
                    {[1, 2, 3, 4, 5].map(i => (
                      <div key={i} className="h-10 w-full bg-slate-200 dark:bg-slate-800 rounded-md" />
                    ))}
                  </div>

                  {/* Main content skeleton */}
                  <div className="col-span-1 md:col-span-3 space-y-6">
                    <div className="flex justify-between items-end">
                      <div className="space-y-2">
                        <div className="h-10 w-48 bg-slate-200 dark:bg-slate-800 rounded-md" />
                        <div className="h-4 w-64 bg-slate-200 dark:bg-slate-800 rounded-md" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-28 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl" />
                      ))}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="md:col-span-2 h-64 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl" />
                      <div className="col-span-1 h-64 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl" />
                    </div>
                  </div>
                </div>

                {/* Overlay text */}
                <div className="relative z-10 bg-white/90 dark:bg-slate-950/90 backdrop-blur-md px-8 py-6 rounded-2xl border shadow-lg text-center">
                  <Radar className="h-10 w-10 text-primary mx-auto mb-3" />
                  <h3 className="text-xl font-bold mb-2">Workspace Protected</h3>
                  <p className="text-sm text-muted-foreground mb-4">Sign in to access your intelligence dashboard.</p>
                  <Link href="/sign-in">
                    <Button size="sm">Sign In to Dashboard</Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-12 bg-card text-card-foreground">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-semibold">
            <img src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/logo.svg`} alt="Hookpoint" className="h-5 w-5 grayscale opacity-50" />
            <span className="text-muted-foreground">Hookpoint Radar</span>
          </div>
          <div className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Hookpoint. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
