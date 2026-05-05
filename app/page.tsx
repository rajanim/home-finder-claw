import { Badge } from "@/components/ui/badge";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="flex w-full max-w-2xl flex-col items-start gap-6">
        <Badge variant="secondary">Phase 0 skeleton</Badge>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Hello Home Finder Claw
        </h1>
        <p className="text-lg text-muted-foreground">
          Multi-agent, voice-enabled real estate search for New York City.
          Search, ranking, neighborhood research, comparison, voice mode, and a
          Fair Housing guard arrive in later phases.
        </p>
        <p className="text-sm text-muted-foreground">
          Status check: <code className="rounded bg-muted px-2 py-1">/api/health</code>
        </p>
      </div>
    </main>
  );
}
