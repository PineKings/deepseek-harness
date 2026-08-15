import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readProfileManifest } from '@deepseek-ai/dsh-app-boot'
import {
  composeOfflineBundle, INSTALL_REGISTRIES, parseBlockedBuilds, registryPackageName,
  resolvePnpm, resolvePnpmCommand, runPnpmInstall, writeAllowBuilds,
  runPnpmInstallWithRegistries, runPnpmRemove, uninstallBundle,
} from '../src/install.ts'

const dirs: string[] = []

function makeProfile(bundles: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-install-'))
  dirs.push(dir)
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-test', dsh: { profile: { bundles } } }, undefined, 2),
  )
  return dir
}

/** Make a bundle resolvable from a profile dir's node_modules. */
function makeBundle(dir: string, name: string): void {
  const pkgDir = join(dir, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), '[]\n')
}

/** A fake pnpm CLI that exits with the given code. */
function makeFakePnpm(dir: string, exitCode: number): string {
  const file = join(dir, `pnpm-${exitCode}.cjs`)
  writeFileSync(file, `process.exit(${exitCode})\n`)
  return file
}

/**
 * A fake pnpm that records its argv to `process.env.RECORD` and exits 1 when the
 * `--registry` value matches `process.env.FAIL_REG`, else `process.env.EXIT`.
 */
function makeRecordingPnpm(dir: string): string {
  const file = join(dir, 'recording.cjs')
  writeFileSync(file, [
    "const fs = require('fs')",
    'const args = process.argv.slice(2)',
    'fs.writeFileSync(process.env.RECORD, JSON.stringify(args))',
    "const reg = args[args.indexOf('--registry') + 1]",
    'process.exit(reg === process.env.FAIL_REG ? 1 : Number(process.env.EXIT ?? 0))',
  ].join('\n'))
  return file
}

/**
 * A fake pnpm that reports a blocked build (`ERR_PNPM_IGNORED_BUILDS` naming
 * node-pty and protobufjs) and exits 1 — the failure `runPnpmInstall` turns
 * into `pendingBuilds` instead of a throw.
 */
function makeBlockedBuildPnpm(dir: string): string {
  const file = join(dir, 'blocked.cjs')
  writeFileSync(file,
    "process.stderr.write('ERR_PNPM_IGNORED_BUILDS\\nIgnored build scripts: node-pty, protobufjs\\n'); process.exit(1)\n")
  return file
}

/**
 * A self-executable fake pnpm (shebang + executable bit) that records its argv
 * and exits 0 — simulates a `pnpm` command invoked directly off PATH, without a
 * `node` prefix (as the PATH-pnpm fallback does).
 */
function makeExecutablePnpm(dir: string): string {
  const file = join(dir, 'pnpm-path')
  writeFileSync(file, [
    '#!/usr/bin/env node',
    "const fs = require('fs')",
    'const args = process.argv.slice(2)',
    'fs.writeFileSync(process.env.RECORD, JSON.stringify(args))',
    'process.exit(0)',
  ].join('\n'))
  chmodSync(file, 0o755)
  return file
}

/**
 * A fake pnpm that, for `remove <name>`, drops the named dependency from the
 * profile's package.json (as pnpm does) and exits 0.
 */
function makeRemovingPnpm(dir: string): string {
  const file = join(dir, 'removing.cjs')
  writeFileSync(file, [
    "const fs = require('fs')",
    "const pkg = JSON.parse(fs.readFileSync('package.json','utf8'))",
    'delete pkg.dependencies[process.argv[3]]',
    "fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n')",
    'process.exit(0)',
  ].join('\n'))
  return file
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('composeOfflineBundle', () => {
  it('appends a resolvable bundle and stays idempotent', () => {
    const dir = makeProfile()
    makeBundle(dir, 'example-bundle')
    composeOfflineBundle('dsh', dir, join(dir, 'package.json'), 'example-bundle')
    expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual(['example-bundle'])
    composeOfflineBundle('dsh', dir, join(dir, 'package.json'), 'example-bundle')
    expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual(['example-bundle'])
  })

  it('fails loud for an unresolvable bundle', () => {
    const dir = makeProfile()
    expect(() => { composeOfflineBundle('dsh', dir, join(dir, 'package.json'), 'missing') }).toThrow(/cannot resolve/)
  })
})

describe('uninstallBundle', () => {
  it('removes a bundle from the layer list', () => {
    const dir = makeProfile(['example-bundle'])
    uninstallBundle('dsh', dir, 'example-bundle')
    expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual([])
  })
})

describe('runPnpmInstall', () => {
  it('reconciles without throwing on pnpm success', () => {
    const dir = makeProfile()
    const before = readProfileManifest('dsh', dir)
    const pnpm = makeFakePnpm(dir, 0)
    runPnpmInstall({
      binName: 'dsh', profileDir: dir, installAnchor: join(dir, 'package.json'),
      nodeBin: process.execPath, pnpmCjs: pnpm, spec: 'example', before,
    })
  })

  it('throws when pnpm fails', () => {
    const dir = makeProfile()
    const before = readProfileManifest('dsh', dir)
    const pnpm = makeFakePnpm(dir, 1)
    expect(() => { runPnpmInstall({
      binName: 'dsh', profileDir: dir, installAnchor: join(dir, 'package.json'),
      nodeBin: process.execPath, pnpmCjs: pnpm, spec: 'example', before,
    }) }).toThrow(/pnpm install failed/)
  })

  it('passes --registry when a registry is given', () => {
    const dir = makeProfile()
    const record = join(dir, 'record.json')
    const pnpm = makeRecordingPnpm(dir)
    process.env.RECORD = record
    process.env.EXIT = '0'
    try {
      runPnpmInstall({
        binName: 'dsh', profileDir: dir, installAnchor: join(dir, 'package.json'),
        nodeBin: process.execPath, pnpmCjs: pnpm, spec: 'x',
        before: readProfileManifest('dsh', dir), registry: 'https://mirror.example',
      })
      const args = JSON.parse(readFileSync(record, 'utf8')) as string[]
      expect(args).toContain('--registry')
      expect(args).toContain('https://mirror.example')
    } finally {
      delete process.env.RECORD
      delete process.env.EXIT
    }
  })

  it('passes minimum-release-age-exclude for a registry name', () => {
    const dir = makeProfile()
    const record = join(dir, 'record.json')
    const pnpm = makeRecordingPnpm(dir)
    process.env.RECORD = record
    process.env.EXIT = '0'
    try {
      runPnpmInstall({
        binName: 'dsh', profileDir: dir, installAnchor: join(dir, 'package.json'),
        nodeBin: process.execPath, pnpmCjs: pnpm, spec: 'x',
        before: readProfileManifest('dsh', dir), minimumReleaseAgeExclude: 'x',
      })
      const args = JSON.parse(readFileSync(record, 'utf8')) as string[]
      expect(args).toContain('--minimum-release-age-exclude=x')
    } finally {
      delete process.env.RECORD
      delete process.env.EXIT
    }
  })

  it('omits minimum-release-age-exclude for a PATH-pnpm fallback (may be an older pnpm)', () => {
    const dir = makeProfile()
    const record = join(dir, 'record.json')
    const pnpm = makeExecutablePnpm(dir)
    process.env.RECORD = record
    try {
      runPnpmInstall({
        binName: 'dsh', profileDir: dir, installAnchor: join(dir, 'package.json'),
        nodeBin: undefined, pnpmCjs: pnpm, spec: 'x',
        before: readProfileManifest('dsh', dir), minimumReleaseAgeExclude: 'x',
      })
      const args = JSON.parse(readFileSync(record, 'utf8')) as string[]
      expect(args).toEqual(['add', 'x'])
    } finally {
      delete process.env.RECORD
    }
  })

  it('returns pendingBuilds when pnpm blocks build scripts', () => {
    const dir = makeProfile()
    const before = readProfileManifest('dsh', dir)
    const pnpm = makeBlockedBuildPnpm(dir)
    const result = runPnpmInstall({
      binName: 'dsh', profileDir: dir, installAnchor: join(dir, 'package.json'),
      nodeBin: process.execPath, pnpmCjs: pnpm, spec: 'example', before,
    })
    expect(result.pendingBuilds).toEqual(['node-pty', 'protobufjs'])
  })

  it('runs pnpm with a non-interactive git environment for git installs', () => {
    const dir = makeProfile()
    const record = join(dir, 'env.json')
    const pnpm = join(dir, 'env-pnpm.cjs')
    writeFileSync(pnpm, [
      "const fs = require('fs')",
      'fs.writeFileSync(process.env.RECORD, JSON.stringify({',
      '  terminal: process.env.GIT_TERMINAL_PROMPT,',
      '  ssh: process.env.GIT_SSH_COMMAND,',
      '}))',
      'process.exit(0)',
    ].join('\n'))
    process.env.RECORD = record
    const savedTerminal = process.env.GIT_TERMINAL_PROMPT
    const savedSsh = process.env.GIT_SSH_COMMAND
    delete process.env.GIT_TERMINAL_PROMPT
    delete process.env.GIT_SSH_COMMAND
    try {
      runPnpmInstall({
        binName: 'dsh', profileDir: dir, installAnchor: join(dir, 'package.json'),
        nodeBin: process.execPath, pnpmCjs: pnpm, spec: 'github:user/repo',
        before: readProfileManifest('dsh', dir),
      })
      const env = JSON.parse(readFileSync(record, 'utf8')) as { terminal: string; ssh: string }
      expect(env.terminal).toBe('0')
      expect(env.ssh).toContain('StrictHostKeyChecking=accept-new')
      expect(env.ssh).toContain('BatchMode=yes')
    } finally {
      delete process.env.RECORD
      if (savedTerminal === undefined) delete process.env.GIT_TERMINAL_PROMPT
      else process.env.GIT_TERMINAL_PROMPT = savedTerminal
      if (savedSsh === undefined) delete process.env.GIT_SSH_COMMAND
      else process.env.GIT_SSH_COMMAND = savedSsh
    }
  })
})

describe('writeAllowBuilds', () => {
  it('writes the allowBuilds map and onlyBuiltDependencies array for the consented packages', () => {
    const dir = makeProfile()
    writeFileSync(join(dir, 'pnpm-workspace.yaml'),
      'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
    writeAllowBuilds(dir, ['node-pty', 'protobufjs'])
    const written = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')
    expect(written).toContain('node-pty: true')
    expect(written).toContain('protobufjs: true')
    expect(written).toContain('- node-pty')
    expect(written).toContain('- protobufjs')
    expect(written).toContain('nodeLinker: hoisted')
  })

  it('preserves existing workspace settings and merges existing allowlist entries', () => {
    const dir = makeProfile()
    writeFileSync(join(dir, 'pnpm-workspace.yaml'),
      'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\nallowBuilds:\n  existing: true\n')
    writeAllowBuilds(dir, ['node-pty'])
    const written = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')
    expect(written).toContain('existing: true')
    expect(written).toContain('node-pty: true')
    expect(written).toContain('nodeLinker: hoisted')
    expect(written).toContain('autoInstallPeers: false')
  })

  it('creates the workspace file from scratch when absent', () => {
    const dir = makeProfile()
    // makeProfile writes only package.json, so pnpm-workspace.yaml is absent.
    writeAllowBuilds(dir, ['node-pty'])
    const written = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')
    expect(written).toContain('node-pty: true')
    expect(written).toContain('nodeLinker: hoisted')
  })
})

describe('runPnpmRemove', () => {
  it('removes the dependency and reconciles its bundle layer away', () => {
    const dir = makeProfile()
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-test',
      dependencies: { 'b': '1.0.0' },
      dsh: { profile: { bundles: ['b'] } },
    }, undefined, 2))
    makeBundle(dir, 'b')
    const pnpm = makeRemovingPnpm(dir)
    runPnpmRemove({
      binName: 'dsh', profileDir: dir, installAnchor: join(dir, 'package.json'),
      nodeBin: process.execPath, pnpmCjs: pnpm, spec: 'b',
      before: readProfileManifest('dsh', dir),
    })
    const after = readProfileManifest('dsh', dir)
    expect(after.dependencies).not.toHaveProperty('b')
    expect(after.dsh?.profile?.bundles).toEqual([])
  })

  it('throws when pnpm remove fails', () => {
    const dir = makeProfile()
    const pnpm = makeFakePnpm(dir, 1)
    expect(() => { runPnpmRemove({
      binName: 'dsh', profileDir: dir, installAnchor: join(dir, 'package.json'),
      nodeBin: process.execPath, pnpmCjs: pnpm, spec: 'x',
      before: readProfileManifest('dsh', dir),
    }) }).toThrow(/pnpm remove failed/)
  })
})

describe('runPnpmInstallWithRegistries', () => {
  it('tries registries until one succeeds', () => {
    const dir = makeProfile()
    const record = join(dir, 'record.json')
    const pnpm = makeRecordingPnpm(dir)
    process.env.RECORD = record
    process.env.EXIT = '0'
    process.env.FAIL_REG = 'https://bad.example'
    try {
      runPnpmInstallWithRegistries({
        binName: 'dsh', profileDir: dir, installAnchor: join(dir, 'package.json'),
        nodeBin: process.execPath, pnpmCjs: pnpm, spec: 'x',
        before: readProfileManifest('dsh', dir),
      }, ['https://bad.example', 'https://good.example'])
      const args = JSON.parse(readFileSync(record, 'utf8')) as string[]
      expect(args).toContain('https://good.example')
    } finally {
      delete process.env.RECORD
      delete process.env.EXIT
      delete process.env.FAIL_REG
    }
  })

  it('throws when every registry fails', () => {
    const dir = makeProfile()
    const pnpm = makeFakePnpm(dir, 1)
    expect(() => { runPnpmInstallWithRegistries({
      binName: 'dsh', profileDir: dir, installAnchor: join(dir, 'package.json'),
      nodeBin: process.execPath, pnpmCjs: pnpm, spec: 'x',
      before: readProfileManifest('dsh', dir),
    }, ['https://a.example', 'https://b.example']) }).toThrow(/across all registries/)
  })
})

describe('INSTALL_REGISTRIES', () => {
  it('ends with the official npm registry as the fallback', () => {
    expect(INSTALL_REGISTRIES[INSTALL_REGISTRIES.length - 1]).toBe('https://registry.npmjs.org')
  })
})

describe('composeOfflineBundle with a bare manifest', () => {
  it('initializes an absent bundle list', () => {
    const dir = makeProfile()
    rmSync(join(dir, 'package.json'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test' }))
    makeBundle(dir, 'example-bundle')
    composeOfflineBundle('dsh', dir, join(dir, 'package.json'), 'example-bundle')
    expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual(['example-bundle'])
  })
})

describe('uninstallBundle with a non-present bundle', () => {
  it('leaves the list unchanged', () => {
    const dir = makeProfile(['other'])
    uninstallBundle('dsh', dir, 'absent')
    expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual(['other'])
  })

  it('handles an absent bundle list', () => {
    const dir = makeProfile()
    rmSync(join(dir, 'package.json'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test' }))
    uninstallBundle('dsh', dir, 'absent')
    expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual([])
  })
})

describe('runPnpmInstall spawn failure', () => {
  it('throws the spawn error when node cannot start', () => {
    const dir = makeProfile()
    const before = readProfileManifest('dsh', dir)
    expect(() => { runPnpmInstall({
      binName: 'dsh', profileDir: dir, installAnchor: join(dir, 'package.json'),
      nodeBin: '/nonexistent/node', pnpmCjs: '/x/pnpm.cjs', spec: 'x', before,
    }) }).toThrow()
  })
})

describe('registryPackageName', () => {
  it('keeps a bare name and strips a version or tag suffix', () => {
    expect(registryPackageName('dsh-better-sidebar')).toBe('dsh-better-sidebar')
    expect(registryPackageName('dsh-better-sidebar@0.12.0')).toBe('dsh-better-sidebar')
    expect(registryPackageName('@scope/plugin')).toBe('@scope/plugin')
    expect(registryPackageName('@scope/plugin@1.0.0')).toBe('@scope/plugin')
    expect(registryPackageName('name@next')).toBe('name')
  })

  it('returns undefined for paths, tarballs, and git sources', () => {
    expect(registryPackageName('')).toBeUndefined()
    expect(registryPackageName('   ')).toBeUndefined()
    expect(registryPackageName('./dir')).toBeUndefined()
    expect(registryPackageName('../dir')).toBeUndefined()
    expect(registryPackageName('~/plugin')).toBeUndefined()
    expect(registryPackageName('file:./plugin')).toBeUndefined()
    expect(registryPackageName('link:./plugin')).toBeUndefined()
    expect(registryPackageName('/abs/plugin.tgz')).toBeUndefined()
    expect(registryPackageName('C:\\plugin.tgz')).toBeUndefined()
    expect(registryPackageName('github:user/repo')).toBeUndefined()
    expect(registryPackageName('git+https://github.com/user/repo.git')).toBeUndefined()
    expect(registryPackageName('user/repo.git')).toBeUndefined()
    expect(registryPackageName('https://github.com/user/repo')).toBeUndefined()
    expect(registryPackageName('https://github.com/user/repo/archive/refs/heads/main.tar.gz')).toBeUndefined()
  })
})

describe('parseBlockedBuilds', () => {
  it('extracts the blocked package names from the pnpm message', () => {
    const output = 'ERR_PNPM_IGNORED_BUILDS\nIgnored build scripts: node-pty, protobufjs\nhint: Run "pnpm approve-builds"'
    expect(parseBlockedBuilds(output)).toEqual(['node-pty', 'protobufjs'])
  })

  it('returns undefined when no build is blocked', () => {
    expect(parseBlockedBuilds('some other failure')).toBeUndefined()
    expect(parseBlockedBuilds('')).toBeUndefined()
  })
})

describe('resolvePnpmCommand', () => {
  it('prefers the vendored pnpm via DSH_PNPM', () => {
    expect(resolvePnpmCommand('/x/bin/node', { DSH_PNPM: '/vendored/pnpm.cjs' }))
      .toEqual({ nodeBin: '/x/bin/node', pnpmCjs: '/vendored/pnpm.cjs' })
  })

  it('falls back to the pnpm command on PATH', () => {
    const dir = makeProfile()
    mkdirSync(join(dir, 'bin'), { recursive: true })
    writeFileSync(join(dir, 'bin', 'pnpm'), '')
    expect(resolvePnpmCommand('/x/bin/node', { PATH: join(dir, 'bin') }))
      .toEqual({ nodeBin: undefined, pnpmCjs: 'pnpm' })
  })

  it('returns undefined when neither a vendored pnpm nor one on PATH exists', () => {
    const dir = makeProfile()
    expect(resolvePnpmCommand('/x/bin/node', { PATH: dir })).toBeUndefined()
  })
})

describe('resolvePnpm', () => {
  it('honors a DSH_PNPM override', () => {
    expect(resolvePnpm('/x/bin/node', { DSH_PNPM: '/vendored/pnpm.cjs' })).toBe('/vendored/pnpm.cjs')
  })

  it('derives the vendored pnpm beside the node harness root and misses when absent', () => {
    expect(resolvePnpm('/nonexistent/bin/node', {})).toBeUndefined()
  })

  it('finds a vendored pnpm beside the node harness root', () => {
    const dir = makeProfile()
    const harnessRoot = join(dir, 'harness')
    const pnpmDir = join(harnessRoot, 'pnpm', 'node_modules', 'pnpm', 'bin')
    mkdirSync(pnpmDir, { recursive: true })
    writeFileSync(join(pnpmDir, 'pnpm.cjs'), '')
    const nodeBin = join(harnessRoot, 'bin', 'node')
    mkdirSync(join(harnessRoot, 'bin'), { recursive: true })
    writeFileSync(nodeBin, '')
    expect(resolvePnpm(nodeBin, {})).toBe(join(pnpmDir, 'pnpm.cjs'))
  })
})
