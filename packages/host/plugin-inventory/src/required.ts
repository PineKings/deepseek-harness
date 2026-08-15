/**
 * Which Loader plugins the running application requires and must not be toggled,
 * and which plugins a deployment explicitly allows the user to toggle.
 *
 * The guard is default-open with two code-editable lists, generated from the
 * running plugin list (chjianlist.json): plugins currently enabled land in
 * {@link REQUIRED_PLUGINS} (the blacklist — they keep running and cannot be
 * disabled); plugins currently disabled land in {@link USER_TOGGLEABLE_PLUGINS}
 * (the whitelist — they can be enabled). A whitelisted name overrides the
 * blacklist for that plugin.
 * @module @deepseek-ai/dsh-plugin-inventory/required
 */

/**
 * Blacklist: plugin module names required by the application and must not be
 * toggled. Keep this to the true core: the entry tree, the Remote RPC spine
 * every Remote depends on, and the session/agent spines. `cordis:required` is a
 * test seam for the unit tests.
 */
const REQUIRED_PLUGINS = new Set([
  '@deepseek-ai/cordis-plugin-hmr',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-timer',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-default-model',
  '@deepseek-ai/dsh-agent-instructions',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-agent-presets',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-attachment-local',
  '@deepseek-ai/dsh-bash-sandbox',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-hmr',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-agent-preset',
  '@deepseek-ai/dsh-client-ui-commands',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-cordis',
  '@deepseek-ai/dsh-client-ui-deliverables',
  '@deepseek-ai/dsh-client-ui-directory-picker-native',
  '@deepseek-ai/dsh-client-ui-goal',
  '@deepseek-ai/dsh-client-ui-input-trigger',
  '@deepseek-ai/dsh-client-ui-jobs',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-message-feedback',
  '@deepseek-ai/dsh-client-ui-model-selection',
  '@deepseek-ai/dsh-client-ui-permission-presets',
  '@deepseek-ai/dsh-client-ui-plan',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-settings-general',
  '@deepseek-ai/dsh-client-ui-settings-models',
  '@deepseek-ai/dsh-client-ui-settings-plugin-inventory',
  '@deepseek-ai/dsh-client-ui-settings-plugins',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-skill',
  '@deepseek-ai/dsh-client-ui-subagent',
  '@deepseek-ai/dsh-client-ui-theme',
  '@deepseek-ai/dsh-client-ui-tool',
  '@deepseek-ai/dsh-client-ui-trajectory',
  '@deepseek-ai/dsh-client-ui-user-questions',
  '@deepseek-ai/dsh-client-ui-workflow-run',
  '@deepseek-ai/dsh-client-ui-workspace',
  '@deepseek-ai/dsh-code-runtime-worker-thread',
  '@deepseek-ai/dsh-command-compact',
  '@deepseek-ai/dsh-command-feedback',
  '@deepseek-ai/dsh-command-goal',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-compaction-tool-result-pruner',
  '@deepseek-ai/dsh-cordis-client-runner',
  '@deepseek-ai/dsh-cordis-host-runner',
  '@deepseek-ai/dsh-credentials-local',
  '@deepseek-ai/dsh-fs-observation-policy',
  '@deepseek-ai/dsh-fs-sandbox',
  '@deepseek-ai/dsh-goal',
  '@deepseek-ai/dsh-goal-round-driver',
  '@deepseek-ai/dsh-host-apiproxy',
  '@deepseek-ai/dsh-host-directory-picker-auto',
  '@deepseek-ai/dsh-host-directory-picker-native',
  '@deepseek-ai/dsh-host-plugin-inventory',
  '@deepseek-ai/dsh-host-skill-manager',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-image-recognition',
  '@deepseek-ai/dsh-image-recognition-http',
  '@deepseek-ai/dsh-jobs-local',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-llm-deepseek',
  '@deepseek-ai/dsh-llm-pi-ai',
  '@deepseek-ai/dsh-llm-retry',
  '@deepseek-ai/dsh-message-feedback',
  '@deepseek-ai/dsh-permission-presets',
  '@deepseek-ai/dsh-persona',
  '@deepseek-ai/dsh-plan-mode',
  '@deepseek-ai/dsh-repeat-tool-reminder',
  '@deepseek-ai/dsh-sandbox-local',
  '@deepseek-ai/dsh-sandbox-policy',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-checkpoint-policy',
  '@deepseek-ai/dsh-session-log-export',
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-session-projection-cache',
  '@deepseek-ai/dsh-session-query-sqlite',
  '@deepseek-ai/dsh-session-stats',
  '@deepseek-ai/dsh-session-title',
  '@deepseek-ai/dsh-session-title-first-prompt-llm',
  '@deepseek-ai/dsh-settings-file',
  '@deepseek-ai/dsh-shell-env',
  '@deepseek-ai/dsh-skill',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-spill-local',
  '@deepseek-ai/dsh-spill-policy',
  '@deepseek-ai/dsh-storage',
  '@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/dsh-storage-json',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-subagent-fork-in-process',
  '@deepseek-ai/dsh-subagent-spawn-in-process',
  '@deepseek-ai/dsh-subprocess-local',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-token-meter',
  '@deepseek-ai/dsh-tool-ask-user',
  '@deepseek-ai/dsh-tool-bash',
  '@deepseek-ai/dsh-tool-call-timeout-policy',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-tool-fs-search',
  '@deepseek-ai/dsh-tool-goal',
  '@deepseek-ai/dsh-tool-image-recognition',
  '@deepseek-ai/dsh-tool-jobs',
  '@deepseek-ai/dsh-tool-ralph',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-tool-subagent',
  '@deepseek-ai/dsh-tool-subagent-control',
  '@deepseek-ai/dsh-tool-subagent-control/list-agents',
  '@deepseek-ai/dsh-tool-subagent-report',
  '@deepseek-ai/dsh-tool-todo',
  '@deepseek-ai/dsh-tool-web',
  '@deepseek-ai/dsh-tool-workflow',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-typert-loader',
  '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-user-approval',
  '@deepseek-ai/dsh-user-questions',
  '@deepseek-ai/dsh-web',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-web-app/startup',
  '@deepseek-ai/dsh-web-search-deepseek',
  '@deepseek-ai/dsh-workflow-worker-thread',
  '@deepseek-ai/dsh-workspace',
  'cordis:include',
  // Test seam: a `cordis:` builtin the unit tests use as a required entry.
  'cordis:required',
])

/**
 * Whitelist: plugin module names a deployment explicitly permits the user to
 * toggle. A name here overrides the blacklist, so a whitelisted plugin is never
 * reported `protected` even if it is also required.
 */
const USER_TOGGLEABLE_PLUGINS = new Set([
  '@deepseek-ai/dsh-pwsh-sandbox',
  '@deepseek-ai/dsh-session-telemetry-otel',
  '@deepseek-ai/dsh-skill-badge',
  '@deepseek-ai/dsh-tool-pwsh',
  '@deepseek-ai/dsh-tool-str-replace-editor',
])

/**
 * Whether a Loader module is required by the application and must not be toggled.
 * The blacklist wins over the default-open stance unless the name is explicitly
 * whitelisted.
 * @param moduleName - the Loader module specifier.
 * @returns true when the plugin is `protected` (cannot be disabled).
 */
export function isRequiredPlugin(moduleName: string): boolean {
  return REQUIRED_PLUGINS.has(moduleName) && !USER_TOGGLEABLE_PLUGINS.has(moduleName)
}

/**
 * Whether a Loader module may be toggled by the user. Default-open: a plugin is
 * toggleable unless the blacklist marks it required and it is not whitelisted.
 * @param moduleName - the Loader module specifier.
 * @returns true when the plugin can be enabled or disabled.
 */
export function isUserToggleable(moduleName: string): boolean {
  return !isRequiredPlugin(moduleName)
}
