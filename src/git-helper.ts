import * as core from '@actions/core'
import * as io from '@actions/io'
import {exec} from '@actions/exec'

const client = async (args: string[]): Promise<string> => {
  const client = await io.which('git', true)
  const stdout: string[] = []
  const listeners = {
    stdout: (data: Buffer) => {
      stdout.push(data.toString())
    }
  }
  const options = {
    listeners
  }
  await exec(client, args, options)
  return stdout.join('')
}

const getDefaultBranch = async (repositoryUrl: string): Promise<string> => {
  const output = await client(['ls-remote', '--quiet', '--exit-code', '--symref', repositoryUrl, 'HEAD'])

  for (let line of output.trim().split('\n')) {
    line = line.trim()
    core.debug(`line: ${line}`)
    if (line.startsWith('ref:') || line.endsWith('HEAD')) {
      const matches = line.match(/refs\/heads\/([^/]+)\s+HEAD$/)
      if (matches && matches.length > 1) return matches[1].trim()
    }
  }

  throw new Error('Unexpected output when retrieving default branch')
}

const getDiff = async (base: string, head: string, ...args: string[]): Promise<string> =>
  await client(['diff', ...args, base, head])

const getStatus = async (...args: string[]): Promise<string> => await client(['status', ...args])

export const git = {
  client,
  getDefaultBranch,
  getDiff,
  getStatus
}
