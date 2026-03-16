"""
Git worktree operations.

All git commands use asyncio.create_subprocess_exec for non-blocking execution.
Authentication is done via PAT embedded in the remote URL.
"""
from __future__ import annotations

import asyncio
import os
import shutil
from pathlib import Path
from urllib.parse import urlparse


WORKSPACE_ROOT = Path.home() / "felix-kanban"


class GitError(Exception):
    pass


async def _run_git(*args: str, cwd: Path | None = None) -> str:
    """Run a git command, raise GitError on non-zero exit."""
    process = await asyncio.create_subprocess_exec(
        "git",
        *args,
        cwd=str(cwd) if cwd else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        # git commit outputs "nothing to commit" to stdout, not stderr — use stdout as fallback
        error_output = stderr.decode().strip() or stdout.decode().strip()
        raise GitError(f"git {' '.join(args)} failed: {error_output}")
    return stdout.decode().strip()


def _auth_url(repo_url: str) -> str:
    """Embed GITHUB_TOKEN into the remote URL for authentication."""
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        return repo_url
    parsed = urlparse(repo_url)
    # Strip any pre-existing credentials so we never double-embed
    host = parsed.hostname or parsed.netloc
    port = f":{parsed.port}" if parsed.port else ""
    return f"https://x-access-token:{token}@{host}{port}{parsed.path}"


def _repo_name_from_url(repo_url: str) -> str:
    path = urlparse(repo_url).path.rstrip("/")
    return path.split("/")[-1].removesuffix(".git")


def _git_identity() -> tuple[str, str]:
    """Read git identity from environment (set by Electron from stored credentials)."""
    name = (
        os.environ.get("GIT_COMMITTER_NAME")
        or os.environ.get("GIT_AUTHOR_NAME")
        or ""
    )
    email = (
        os.environ.get("GIT_COMMITTER_EMAIL")
        or os.environ.get("GIT_AUTHOR_EMAIL")
        or ""
    )
    return name, email


class GitManager:
    def repo_main_path(self, repo_url: str) -> Path:
        return WORKSPACE_ROOT / _repo_name_from_url(repo_url) / "repo-main"

    def worktree_path(self, repo_url: str, ticket_id: str) -> Path:
        return WORKSPACE_ROOT / _repo_name_from_url(repo_url) / "worktrees" / f"ticket-{ticket_id[:8]}"

    def repo_root_path(self, repo_url: str) -> Path:
        """Path to the repo directory (contains repo-main/ and worktrees/)."""
        return WORKSPACE_ROOT / _repo_name_from_url(repo_url)

    async def delete_repo_directory(self, repo_url: str) -> None:
        """Permanently remove the cloned repo and all worktrees from disk."""
        root = self.repo_root_path(repo_url)
        if root.exists():
            await asyncio.to_thread(shutil.rmtree, root)

    async def _configure_git_identity(self, repo_path: Path) -> None:
        """Set git user.name/user.email from the authenticated GitHub user's credentials."""
        name, email = _git_identity()
        if name:
            await _run_git("-C", str(repo_path), "config", "user.name", name)
        if email:
            await _run_git("-C", str(repo_path), "config", "user.email", email)

    async def ensure_repo_main(self, repo_url: str) -> Path:
        """Clone the repo if it doesn't exist, return its path."""
        repo_main = self.repo_main_path(repo_url)
        if repo_main.exists():
            # Always refresh identity — user may have changed credentials
            await self._configure_git_identity(repo_main)
            return repo_main

        repo_main.parent.mkdir(parents=True, exist_ok=True)
        auth_url = _auth_url(repo_url)
        await _run_git("clone", auth_url, str(repo_main))
        await self._configure_git_identity(repo_main)

        return repo_main

    async def pull_repo_main(self, repo_main: Path, default_branch: str) -> None:
        """Pull the latest changes on default branch."""
        # Refresh the remote URL with the current token before every fetch/pull
        plain_url = await _run_git("-C", str(repo_main), "remote", "get-url", "origin")
        auth_url = _auth_url(plain_url)
        await _run_git("-C", str(repo_main), "remote", "set-url", "origin", auth_url)
        await _run_git("-C", str(repo_main), "fetch", "origin")
        await _run_git("-C", str(repo_main), "checkout", default_branch)
        await _run_git("-C", str(repo_main), "pull", "origin", default_branch)

    async def ensure_worktree(
        self,
        repo_main: Path,
        worktree_path: Path,
        branch_name: str,
        default_branch: str,
    ) -> None:
        """Create a worktree for the branch, cleaning up stale state if needed."""
        if worktree_path.exists():
            await self._configure_git_identity(worktree_path)
            return

        # Remove stale worktree + branch if branch already exists from a crash
        try:
            existing = await _run_git("-C", str(repo_main), "worktree", "list", "--porcelain")
            for line in existing.splitlines():
                if f"worktrees/{worktree_path.name}" in line:
                    await _run_git("-C", str(repo_main), "worktree", "remove", "--force", str(worktree_path))
                    break
        except GitError:
            pass

        try:
            await _run_git("-C", str(repo_main), "branch", "-D", branch_name)
        except GitError:
            pass  # Branch didn't exist

        worktree_path.parent.mkdir(parents=True, exist_ok=True)
        await _run_git(
            "-C", str(repo_main),
            "worktree", "add",
            "-b", branch_name,
            str(worktree_path),
            default_branch,
        )

        # Configure remote URL with auth token for push
        auth_url = _auth_url(
            await _run_git("-C", str(repo_main), "remote", "get-url", "origin")
        )
        await _run_git("-C", str(worktree_path), "remote", "set-url", "origin", auth_url)

        # Set git identity on the worktree so agent commits use the GitHub user
        await self._configure_git_identity(worktree_path)

    async def remove_worktree(self, repo_main: Path, worktree_path: Path) -> None:
        await _run_git("-C", str(repo_main), "worktree", "remove", "--force", str(worktree_path))

    async def delete_local_branch(self, repo_main: Path, branch_name: str) -> None:
        try:
            await _run_git("-C", str(repo_main), "branch", "-D", branch_name)
        except GitError:
            pass  # Branch may not exist

    async def commit_all(self, worktree_path: Path, message: str) -> bool:
        """Stage all changes (excluding .agent/ and .claude/), then commit.

        Returns True if a commit was created, False if there was nothing to commit.
        Raises GitError for any other git failure.
        """
        await _run_git("-C", str(worktree_path), "add", "-A")
        # Unstage agent context and slash command artifacts — they must never land in the repo.
        for path in (".agent", ".claude"):
            if (worktree_path / path).exists():
                try:
                    await _run_git("-C", str(worktree_path), "reset", "HEAD", "--", path)
                except GitError:
                    pass
        try:
            await _run_git("-C", str(worktree_path), "commit", "-m", message)
            return True
        except GitError as exc:
            msg = str(exc).lower()
            if "nothing to commit" in msg or "nothing added to commit" in msg or "working tree clean" in msg:
                return False
            raise

    async def push_branch(self, worktree_path: Path, branch_name: str) -> None:
        """Push the branch to origin."""
        await _run_git("-C", str(worktree_path), "push", "origin", branch_name)
