import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendToUserPath, buildDshCmd, registerDshLauncher } from '../src/register-dsh.ts'

const dirs: string[] = []

/** A fake harness dir (with or without a `dsh` launcher) and a bin dir to register into. */
function fixtures(): { harnessDir: string; binDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-register-'))
  dirs.push(root)
  return { harnessDir: join(root, 'harness'), binDir: join(root, 'bin') }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('registerDshLauncher', () => {
  it('symlinks the harness launcher into the bin dir when absent', () => {
    const { harnessDir, binDir } = fixtures()
    mkdirSync(join(harnessDir, 'bin'), { recursive: true })
    writeFileSync(join(harnessDir, 'dsh'), '#!/bin/sh\n')
    expect(registerDshLauncher(harnessDir, binDir)).toEqual({
      status: 'registered', path: join(binDir, 'dsh'), created: true,
    })
    expect(readlinkSync(join(binDir, 'dsh'))).toBe(join(harnessDir, 'dsh'))
  })

  it('is idempotent: confirms an existing link that already points at the launcher', () => {
    const { harnessDir, binDir } = fixtures()
    mkdirSync(harnessDir, { recursive: true })
    mkdirSync(binDir, { recursive: true })
    symlinkSync(join(harnessDir, 'dsh'), join(binDir, 'dsh'))
    expect(registerDshLauncher(harnessDir, binDir)).toEqual({
      status: 'registered', path: join(binDir, 'dsh'), created: false,
    })
  })

  it('falls back to a user-writable dir when the primary is unwritable', () => {
    const { harnessDir, binDir } = fixtures()
    mkdirSync(harnessDir, { recursive: true })
    writeFileSync(join(harnessDir, 'dsh'), '#!/bin/sh\n')
    // A file occupies the primary's parent path, so creating the link there
    // fails (ENOTDIR) and the fallback dir is used instead — mirroring a
    // root-owned, non-writable /usr/local/bin.
    mkdirSync(binDir, { recursive: true })
    const fileBlocker = join(binDir, 'blocker')
    writeFileSync(fileBlocker, '')
    const result = registerDshLauncher(harnessDir, join(fileBlocker, 'nested'), join(binDir, 'fallback'), false)
    if (result.status !== 'registered') {
      throw new Error(`expected a registered link, got ${JSON.stringify(result)}`)
    }
    expect(result.created).toBe(true)
    expect(readlinkSync(join(binDir, 'fallback', 'dsh'))).toBe(join(harnessDir, 'dsh'))
  })

  it('leaves an existing non-dsh entry untouched', () => {
    const { harnessDir, binDir } = fixtures()
    mkdirSync(harnessDir, { recursive: true })
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'dsh'), 'a real file, not ours\n')
    expect(registerDshLauncher(harnessDir, binDir)).toEqual({
      status: 'already-present', path: join(binDir, 'dsh'),
    })
    // The file is not replaced by a symlink and its content is untouched.
    expect(lstatSync(join(binDir, 'dsh')).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(binDir, 'dsh'), 'utf8')).toBe('a real file, not ours\n')
  })

  it('leaves a symlink pointing elsewhere untouched', () => {
    const { harnessDir, binDir } = fixtures()
    mkdirSync(harnessDir, { recursive: true })
    mkdirSync(binDir, { recursive: true })
    symlinkSync('/elsewhere/dsh', join(binDir, 'dsh'))
    expect(registerDshLauncher(harnessDir, binDir)).toEqual({
      status: 'already-present', path: join(binDir, 'dsh'),
    })
    expect(readlinkSync(join(binDir, 'dsh'))).toBe('/elsewhere/dsh')
  })

  it('skips when the harness has no launcher (a development checkout)', () => {
    const { harnessDir, binDir } = fixtures()
    mkdirSync(harnessDir, { recursive: true })
    expect(registerDshLauncher(harnessDir, binDir)).toEqual({ status: 'skipped' })
  })
})

describe('buildDshCmd', () => {
  it('runs the bundled node against the CLI entry with the caller arguments', () => {
    expect(buildDshCmd()).toBe('@echo off\r\n"%~dp0bin\\node.exe" "%~dp0apps\\cli\\lib\\bin.js" %*\r\n')
  })
})

describe('appendToUserPath', () => {
  it('appends a missing directory', () => {
    expect(appendToUserPath('C:\\a;C:\\b', 'C:\\harness'))
      .toBe('C:\\a;C:\\b;C:\\harness')
  })

  it('is case-insensitive and idempotent for a present directory', () => {
    expect(appendToUserPath('C:\\a;C:\\Harness', 'c:\\harness')).toBe('C:\\a;C:\\Harness')
  })

  it('appends to a trailing semicolon without doubling it', () => {
    expect(appendToUserPath('C:\\a;', 'C:\\harness')).toBe('C:\\a;C:\\harness')
  })

  it('appends to an empty PATH', () => {
    expect(appendToUserPath('', 'C:\\harness')).toBe(';C:\\harness')
  })
})
