"""
GitHub REST API client using httpx.

All GitHub operations go through this module. The gh CLI and curl are never used.
All calls include retry logic with exponential backoff.
"""
from __future__ import annotations

import asyncio
import os
from urllib.parse import urlparse

import httpx


class GitHubAPIError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        self.status_code = status_code
        super().__init__(f"GitHub API error {status_code}: {message}")


def _token() -> str:
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        raise RuntimeError("GITHUB_TOKEN environment variable is not set")
    return token


class GitHubClient:
    BASE_URL = "https://api.github.com"
    MAX_RETRIES = 3
    RETRY_DELAY = 1.0  # seconds, doubles each retry

    def parse_repo_url(self, repo_url: str) -> tuple[str, str]:
        """Parse 'https://github.com/owner/repo' into (owner, repo)."""
        path = urlparse(repo_url).path.strip("/").removesuffix(".git")
        parts = path.split("/")
        if len(parts) < 2:
            raise ValueError(f"Cannot parse owner/repo from URL: {repo_url}")
        return parts[-2], parts[-1]

    async def _request(self, method: str, path: str, **kwargs) -> dict | list | None:
        token = _token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        url = f"{self.BASE_URL}{path}"
        delay = self.RETRY_DELAY

        for attempt in range(self.MAX_RETRIES):
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    response = await client.request(method, url, headers=headers, **kwargs)
                    if response.status_code == 204:
                        return None
                    if response.status_code >= 400:
                        raise GitHubAPIError(response.status_code, response.text)
                    return response.json()
            except GitHubAPIError:
                raise
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                if attempt == self.MAX_RETRIES - 1:
                    raise
                await asyncio.sleep(delay)
                delay *= 2

        raise RuntimeError(f"GitHub request failed after {self.MAX_RETRIES} retries")

    async def create_pr(
        self,
        owner: str,
        repo: str,
        title: str,
        body: str,
        head: str,
        base: str,
    ) -> dict:
        return await self._request(
            "POST",
            f"/repos/{owner}/{repo}/pulls",
            json={"title": title, "body": body, "head": head, "base": base},
        )

    async def get_pr_review_comments(self, owner: str, repo: str, pr_number: int) -> list[dict]:
        """Fetch inline review comments (attached to file lines) on a PR."""
        result = await self._request("GET", f"/repos/{owner}/{repo}/pulls/{pr_number}/comments")
        return result if isinstance(result, list) else []

    async def get_pr_comments(self, owner: str, repo: str, pr_number: int) -> list[dict]:
        """Alias for get_pr_review_comments — kept for backwards compatibility."""
        return await self.get_pr_review_comments(owner, repo, pr_number)

    async def get_pr_issue_comments(self, owner: str, repo: str, pr_number: int) -> list[dict]:
        """Fetch PR-level (non-file) conversation comments via the Issues API."""
        result = await self._request("GET", f"/repos/{owner}/{repo}/issues/{pr_number}/comments")
        return result if isinstance(result, list) else []

    async def create_issue_comment(
        self,
        owner: str,
        repo: str,
        issue_number: int,
        body: str,
    ) -> dict:
        """Post a new top-level comment on a PR/issue (reply to PR-level comments)."""
        return await self._request(
            "POST",
            f"/repos/{owner}/{repo}/issues/{issue_number}/comments",
            json={"body": body},
        )

    async def reply_to_pr_comment(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        comment_id: int,
        body: str,
    ) -> dict:
        """Post a reply to an existing inline review comment thread."""
        return await self._request(
            "POST",
            f"/repos/{owner}/{repo}/pulls/{pr_number}/comments/{comment_id}/replies",
            json={"body": body},
        )

    async def submit_pr_review(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        body: str,
        event: str = "COMMENT",
    ) -> dict:
        """Submit a top-level PR review (COMMENT, APPROVE, or REQUEST_CHANGES)."""
        return await self._request(
            "POST",
            f"/repos/{owner}/{repo}/pulls/{pr_number}/reviews",
            json={"body": body, "event": event},
        )

    async def close_pr(self, owner: str, repo: str, pr_number: int) -> None:
        await self._request(
            "PATCH",
            f"/repos/{owner}/{repo}/pulls/{pr_number}",
            json={"state": "closed"},
        )

    async def delete_branch(self, owner: str, repo: str, branch_name: str) -> None:
        try:
            await self._request("DELETE", f"/repos/{owner}/{repo}/git/refs/heads/{branch_name}")
        except GitHubAPIError as exc:
            if exc.status_code == 422:
                pass  # Branch already deleted
            else:
                raise
