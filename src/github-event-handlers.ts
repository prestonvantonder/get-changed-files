import * as core from '@actions/core'
import * as github from '@actions/github'
import {git} from './git-helper'
import {WebhookPayload} from '@actions/github/lib/interfaces'

export type Event = 'pull_request' | 'push' | 'workflow_dispatch'
export type GitHubClient = ReturnType<typeof github.getOctokit>
export type ChangedFiles = ReturnType<typeof getChangedFilesFromGitHub>
export type Context = {
  sha: string
  eventName: string
  payload: WebhookPayload
  repo: string
  owner: string
  client: GitHubClient
  serverUrl: string
  token: string
}
type GitHubFileStatus = 'added' | 'modified' | 'removed' | 'renamed' | 'changed' | 'unchanged' | 'copied'
type Files = {name: string; status: GitHubFileStatus}[]
type Handler = (context: Context) => Promise<Files>

const handleWorkflowDispatchEvent = async (context: Context): Promise<Files> => {
  core.debug('handling workflow dispatch event')
  const head = context.sha
  const token = context.token
  const {repo, owner} = context
  const url = new URL(context.serverUrl)
  const repositoryUrl = `${url.protocol}//${token}@${url.host}/${owner}/${repo}`
  const base = await git.getDefaultBranch(repositoryUrl)
  core.debug(`base commit: ${base}`)
  core.debug(`head commit: ${head}`)
  return await getChangedFilesFromGit(base, head)
}

const handlePushEvent = async (context: Context): Promise<Files> => {
  core.debug('handling push event')
  const base = context.payload.before,
    head = context.payload.before
  core.debug(`base commit: ${base}`)
  core.debug(`head commit: ${head}`)
  return await getChangedFilesFromGitHub(context, base, head)
}

const handlePullRequestEvent = async (context: Context): Promise<Files> => {
  core.debug('handling pull request event')
  const base = context.payload.pull_request?.base?.sha,
    head = context.payload.pull_request?.head?.sha
  core.debug(`base commit: ${base}`)
  core.debug(`head commit: ${head}`)
  return await getChangedFilesFromGitHub(context, base, head)
}

const getChangedFilesFromGitHub = async (context: Context, base: string, head: string): Promise<Files> => {
  const {client, repo, owner} = context

  // Use GitHub's compare two commits API.
  // https://developer.github.com/v3/repos/commits/#compare-two-commits
  const response = await client.rest.repos.compareCommits({
    base,
    head,
    owner,
    repo
  })

  // Ensure that the request was successful.
  if (response.status !== 200) {
    core.setFailed(
      `The GitHub API for comparing the base and head commits for this ${context.eventName} event returned ${response.status}, expected 200. ` +
        "Please submit an issue on this action's GitHub repo."
    )
  }

  // Ensure that the head commit is ahead of the base commit.
  if (response.data.status !== 'ahead') {
    core.warning(
      `The head commit for this ${context.eventName} event is not ahead of the base commit. ` +
        "Please submit an issue on this action's GitHub repo."
    )
  }

  return response.data.files?.map(file => ({name: file.filename, status: file.status})) || []
}

const getChangedFilesFromGit = async (base: string, head: string) => {
  const diff = await git.getDiff(base, head, '--name-status')

  // Also get the status of untracked files.
  const status = await git.getStatus('--porcelain')

  return [...diff.split('\n'), ...status.split('\n')].filter(Boolean).map(line => {
    // In the case of a renamed file, we want the name of the file after the rename.
    const [shortStatus, before, after] = line.trim().split(/\s+/)
    const statusCode = shortStatus.substring(0, 1)
    const status = mapFileStatus(statusCode)
    return {name: after ?? before, status}
  })
}

const mapFileStatus = (status: string): GitHubFileStatus => {
  const statusMap: {[key: string]: GitHubFileStatus} = {
    A: 'added',
    M: 'modified',
    D: 'removed',
    R: 'renamed',
    '?': 'added'
  }
  return statusMap[status] || 'changed'
}

export const handlers: {[key in Event]: Handler} = {
  pull_request: handlePullRequestEvent,
  push: handlePushEvent,
  workflow_dispatch: handleWorkflowDispatchEvent
}
