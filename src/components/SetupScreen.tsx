export function SetupScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-canvas gap-8 p-8">
      <div className="max-w-md w-full space-y-8">
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">Setup Required</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Some host dependencies are missing. Please install them before continuing.
          </p>
        </div>

        <div className="space-y-4">
          <SetupItem
            name="Python 3.11+"
            command="brew install python@3.11"
            description="Required to run the backend"
          />
          <SetupItem
            name="claude-agent-sdk"
            command="pip install claude-agent-sdk"
            description="Required for the autonomous coding agent"
          />
          <SetupItem
            name="Git 2.5+"
            command="brew install git"
            description="Required for git worktree support"
          />
        </div>

        <div className="text-sm text-muted-foreground">
          <p>After installing the dependencies above, open <strong>Settings</strong> (gear icon) to configure your GitHub token and Anthropic API key.</p>
        </div>

        <button
          onClick={() => window.location.reload()}
          className="w-full rounded-lg bg-primary text-primary-foreground px-4 py-3 text-sm font-semibold hover:bg-primary/90 shadow-glow-sm hover:shadow-glow transition-all"
        >
          Check Again
        </button>
      </div>
    </div>
  )
}

function SetupItem({
  name,
  command,
  description
}: {
  name: string
  command: string
  description: string
}) {
  return (
    <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{name}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <pre className="text-xs font-mono text-muted-foreground bg-secondary/60 rounded-lg px-3 py-2 border border-border/40">
        {command}
      </pre>
    </div>
  )
}
