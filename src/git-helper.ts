import * as io from '@actions/io'
import {exec} from '@actions/exec'

export const git = async (args: string[]): Promise<string> => {
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
