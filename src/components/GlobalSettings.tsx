import { useState, useEffect } from 'react'
import type { GitHubUser } from '../types'
import { Github } from 'lucide-react'
import { Field } from './ui/field'
import { ErrorBlock } from './ui/error-block'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { Separator } from './ui/separator'

export function GlobalSettings() {
  const [anthropicKey, setAnthropicKey] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [githubUser, setGithubUser] = useState<GitHubUser | null>(null)
  const [tokenDirty, setTokenDirty] = useState(false)
  const [tokenVerifying, setTokenVerifying] = useState(false)
  const [tokenVerifyError, setTokenVerifyError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    window.api.getCredentials().then((creds) => {
      if (creds.anthropic_api_key) setAnthropicKey(creds.anthropic_api_key)
      if (creds.github_token) {
        setGithubToken(creds.github_token)
        window.api.validateGithubToken({ token: creds.github_token })
          .then((user) => { setGithubUser(user); setTokenDirty(false) })
          .catch(() => {})
      }
    }).catch(() => {})
  }, [])

  async function verifyToken(token: string): Promise<GitHubUser | null> {
    setTokenVerifying(true)
    setTokenVerifyError(null)
    try {
      const user = await window.api.validateGithubToken({ token })
      setGithubUser(user)
      setTokenDirty(false)
      return user
    } catch (err: unknown) {
      const isAuthError =
        err instanceof Error &&
        (err.message.includes('401') || err.message.includes('Bad credentials'))
      setTokenVerifyError(
        isAuthError
          ? 'Invalid token — check that it has the required scopes (repo, user:email).'
          : 'Verification failed. Please check your token and try again.'
      )
      setGithubUser(null)
      return null
    } finally {
      setTokenVerifying(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      let user = githubUser
      if (githubToken.trim() && (tokenDirty || !user)) {
        user = await verifyToken(githubToken.trim())
        if (!user) { setSaving(false); return }
      }
      await window.api.setCredentials({
        anthropic_api_key: anthropicKey.trim(),
        github_token: githubToken.trim(),
        git_name: user?.name || '',
        git_email: user?.email || '',
      })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err: unknown) {
      setSaveError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-backlog-gradient">
      <div className="min-h-full flex flex-col justify-center max-w-lg mx-auto p-8 w-full space-y-6">

        <div className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">Credentials</h2>
          <p className="text-sm text-muted-foreground">
            Stored encrypted on this machine. Shared across all projects.
            The agent backend restarts automatically when you save.
          </p>
        </div>

        <Separator />

        <div className="space-y-5">
          <Field label="Anthropic API Key">
            <Input
              type="password"
              placeholder="sk-ant-xxxxxxxxxxxx"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              className="font-mono text-sm"
              autoComplete="off"
            />
          </Field>

        </div>

        <Separator />

        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <Github className="h-5 w-5 text-foreground" />
            <h3 className="text-base font-semibold tracking-tight">GitHub</h3>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Repositories, commits, and pull requests. The agent uses this to clone, push, and open PRs.
          </p>
          <Field label="Personal access token">
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="ghp_xxxxxxxxxxxx"
                value={githubToken}
                onChange={(e) => {
                  setGithubToken(e.target.value)
                  setTokenDirty(true)
                  setGithubUser(null)
                  setTokenVerifyError(null)
                }}
                className="font-mono text-sm flex-1"
                autoComplete="off"
              />
              {githubToken.trim() && (tokenDirty || !githubUser) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => verifyToken(githubToken.trim())}
                  disabled={tokenVerifying}
                  className="shrink-0"
                >
                  {tokenVerifying ? 'Verifying…' : 'Verify'}
                </Button>
              )}
            </div>
          </Field>

          {tokenVerifyError && (
            <ErrorBlock message={tokenVerifyError} className="-mt-2" />
          )}

          {githubUser && !tokenDirty && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-success/10 border border-success/20">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/5 shrink-0">
                <Github className="h-5 w-5 text-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-none">Connected as @{githubUser.login}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{githubUser.email}</p>
              </div>
              <span className="text-xs font-medium text-success shrink-0">Connected</span>
            </div>
          )}

          {!githubUser && (
            <p className="text-xs text-muted-foreground -mt-2">
              Token needs <code className="font-mono">repo</code> and <code className="font-mono">user:email</code> scopes.
              Commits will be attributed using the name and email on your GitHub account.
            </p>
          )}
        </div>

        {saveError && <ErrorBlock message={saveError} />}
        {saveSuccess && <p className="text-sm text-success">Saved. Backend restarted.</p>}

        <Button onClick={handleSave} disabled={saving} className="w-full mt-2">
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

