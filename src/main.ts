import * as core from '@actions/core'
import * as github from '@actions/github'
import {Context} from '@actions/github/lib/context'
import {git} from './git-helper'
import path from 'path'

type Format = 'space-delimited' | 'csv' | 'json'
type FileStatus = 'added' | 'modified' | 'removed' | 'renamed'
type Event = 'pull_request' | 'push' | 'workflow_dispatch'
type Handler = (context: Context) => Promise<{base: string; head: string}>

const panic = (message: string): never => {
  core.setFailed(message)
  process.exit(1)
}

const handleWorkflowDispatchEvent = async (context: Context): Promise<{base: string; head: string}> => {
  core.info(`Handling workflow dispatch event with payload: ${JSON.stringify(context)}`)
  const head = context.sha
  const parent = (await git(['-P', 'branch'])).match(/develop|main|master/)
  if (!parent || !parent.length) {
    panic('No parent branch found')
  }
  const base = parent![0]
  core.debug(`Output of command: ${base}`)
  const statuses = (await git(['-P', 'diff', '--name-status', base, head]))
    .split('\n')
    .filter(Boolean)
    .map(it => {
      const raw = it.trim().substring(0, 1)
      switch (raw) {
        case 'A':
          return 'added'
        case 'M':
          return 'modified'
        case 'D':
          return 'removed'
        case 'R':
          return 'renamed'
        default:
          return ''
      }
    })
  const files = (await git(['-P', 'diff', '--name-only', base, head]))
    .split('\n')
    .filter(Boolean)
    .map((it, index) => ({name: it, status: statuses[index] as FileStatus}))
  core.debug(`Files: ${JSON.stringify(files)}`)
  return {base, head}
}

const handlePushEvent = (context: Context): Promise<{base: string; head: string}> => {
  core.info(`Handling push event with payload: ${JSON.stringify(context)}`)
  return Promise.resolve({
    base: context.payload.before,
    head: context.payload.after
  })
}

const handlePullRequestEvent = (context: Context): Promise<{base: string; head: string}> => {
  core.info(`Handling pull request event with payload: ${JSON.stringify(context)}`)
  return Promise.resolve({
    base: context.payload.pull_request?.base?.sha,
    head: context.payload.pull_request?.head?.sha
  })
}

const context = github.context

const handlers: {[key in Event]: Handler} = {
  pull_request: handlePullRequestEvent,
  push: handlePushEvent,
  workflow_dispatch: handleWorkflowDispatchEvent
}

async function run(): Promise<void> {
  try {
    // Create GitHub client with the API token.
    const client = github.getOctokit(core.getInput('token', {required: true}))
    const format = (core.getInput('format') as Format) || 'space-delimited'
    const extensions = (core.getInput('extensions') || '').split(' ').map(it => it.trim())

    // Ensure that the format parameter is set properly.
    if (format !== 'space-delimited' && format !== 'csv' && format !== 'json') {
      core.setFailed(`Format must be one of 'string-delimited', 'csv', or 'json', got '${format}'.`)
    }

    // Debug log the payload.
    core.debug(`Payload keys: ${Object.keys(context.payload)}`)

    // Get event name.
    const eventName = context.eventName as Event

    // Define the base and head commits to be extracted from the payload.
    const {base, head} = await handlers[eventName](context)

    // Log the base and head commits
    core.info(`Base commit: ${base}`)
    core.info(`Head commit: ${head}`)

    const {repo, owner} = context.repo

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
      core.setFailed(
        `The head commit for this ${context.eventName} event is not ahead of the base commit. ` +
          "Please submit an issue on this action's GitHub repo."
      )
    }

    // Get the changed files from the response payload.
    const files = response.data.files?.filter(
      it => extensions.includes(path.extname(it.filename)) || extensions.includes('')
    )
    core.info(`Files: ${JSON.stringify(files)}`)
    const all: string[] = [],
      added: string[] = [],
      modified: string[] = [],
      removed: string[] = [],
      renamed: string[] = [],
      addedModifiedRenamed: string[] = []
    files?.forEach(file => {
      const filename = file.filename
      // If we're using the 'space-delimited' format and any of the filenames have a space in them,
      // then fail the step.
      if (format === 'space-delimited' && filename.includes(' ')) {
        core.setFailed(
          `One of your files includes a space. Consider using a different output format or removing spaces from your filenames. ` +
            "Please submit an issue on this action's GitHub repo."
        )
      }
      all.push(filename)
      switch (file.status as FileStatus) {
        case 'added':
          added.push(filename)
          addedModifiedRenamed.push(filename)
          break
        case 'modified':
          modified.push(filename)
          addedModifiedRenamed.push(filename)
          break
        case 'removed':
          removed.push(filename)
          break
        case 'renamed':
          renamed.push(filename)
          addedModifiedRenamed.push(filename)
          break
        default:
          core.setFailed(
            `One of your files includes an unsupported file status '${file.status}', expected 'added', 'modified', 'removed', or 'renamed'.`
          )
      }
    })

    // Format the arrays of changed files.
    let allFormatted: string,
      addedFormatted: string,
      modifiedFormatted: string,
      removedFormatted: string,
      renamedFormatted: string,
      addedModifiedFormatted: string
    switch (format) {
      case 'space-delimited':
        // If any of the filenames have a space in them, then fail the step.
        for (const file of all) {
          if (file.includes(' '))
            core.setFailed(
              `One of your files includes a space. Consider using a different output format or removing spaces from your filenames.`
            )
        }
        allFormatted = all.join(' ')
        addedFormatted = added.join(' ')
        modifiedFormatted = modified.join(' ')
        removedFormatted = removed.join(' ')
        renamedFormatted = renamed.join(' ')
        addedModifiedFormatted = addedModifiedRenamed.join(' ')
        break
      case 'csv':
        allFormatted = all.join(',')
        addedFormatted = added.join(',')
        modifiedFormatted = modified.join(',')
        removedFormatted = removed.join(',')
        renamedFormatted = renamed.join(',')
        addedModifiedFormatted = addedModifiedRenamed.join(',')
        break
      case 'json':
        allFormatted = JSON.stringify(all)
        addedFormatted = JSON.stringify(added)
        modifiedFormatted = JSON.stringify(modified)
        removedFormatted = JSON.stringify(removed)
        renamedFormatted = JSON.stringify(renamed)
        addedModifiedFormatted = JSON.stringify(addedModifiedRenamed)
        break
    }

    // Log the output values.
    core.info(`All: ${allFormatted}`)
    core.info(`Added: ${addedFormatted}`)
    core.info(`Modified: ${modifiedFormatted}`)
    core.info(`Removed: ${removedFormatted}`)
    core.info(`Renamed: ${renamedFormatted}`)
    core.info(`Added or modified or renamed: ${addedModifiedFormatted}`)

    // Set step output context.
    core.setOutput('all', allFormatted)
    core.setOutput('added', addedFormatted)
    core.setOutput('modified', modifiedFormatted)
    core.setOutput('removed', removedFormatted)
    core.setOutput('renamed', renamedFormatted)
    core.setOutput('added_modified', addedModifiedFormatted)

    // For backwards-compatibility
    core.setOutput('deleted', removedFormatted)
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
