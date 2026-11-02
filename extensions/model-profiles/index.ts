import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { ProfileError, profileNames, profileStatus, updateProfiles, type ProfileName } from './store.js';

const usage = '/model-profile [coding|writing|education|status|restore|init]';
function notify(ctx: ExtensionCommandContext, message: string, error = false): void {
  if (ctx.hasUI) ctx.ui.notify(message, error ? 'error' : 'info');
  else process.stderr.write(`${message}\n`);
}

export default function modelProfiles(pi: ExtensionAPI): void {
  pi.registerCommand('model-profile', {
    description: 'Switch global sampling presets for explicit model targets; status, restore, init',
    handler: async (args, ctx) => {
      let action = args.trim();
      if (!action) {
        if (!ctx.hasUI) { notify(ctx, usage); return; }
        action = await ctx.ui.select('Global model sampling profile', [...profileNames, 'status', 'restore', 'init']) ?? '';
        if (!action) return;
      }
      if (![...profileNames, 'status', 'restore', 'init'].includes(action)) { notify(ctx, usage, true); return; }
      try {
        const dir = getAgentDir();
        if (action === 'status') { notify(ctx, profileStatus(dir)); return; }
        await ctx.waitForIdle();
        if (profileNames.includes(action as ProfileName)) {
          // Config may have changed since startup; validate against the disk-backed catalog.
          try {
            await ctx.modelRegistry.refresh({ allowNetwork: false });
            if (ctx.modelRegistry.getError()) throw new Error('registry');
          } catch {
            notify(ctx, 'Registry preflight failed; no profile files changed. Fix models.json and reload Pi.', true);
            return;
          }
        }
        const result = updateProfiles(dir, action as ProfileName | 'restore' | 'init', ctx.modelRegistry.getAll(), ctx.model);
        if (action === 'init') { notify(ctx, result); return; }
        // Saving disk state is distinct from refreshing this session's model object.
        try {
          const thinking = pi.getThinkingLevel();
          const active = ctx.model;
          await ctx.modelRegistry.refresh({ allowNetwork: false });
          if (ctx.modelRegistry.getError()) throw new Error('registry');
          if (active) {
            const fresh = ctx.modelRegistry.find(active.provider, active.id);
            if (!fresh || !(await pi.setModel(fresh))) throw new Error('active model');
            pi.setThinkingLevel(thinking);
            if (pi.getThinkingLevel() !== thinking) throw new Error('thinking');
          }
          notify(ctx, `${result} Registry reloaded${active ? '; active model replaced and thinking preserved' : '; no active model'}. Future children read shared disk; existing children are unchanged. API compatibility does not guarantee endpoint acceptance.`);
        } catch {
          notify(ctx, `${result} Runtime reload failed or thinking could not be preserved; current runtime is not confirmed updated. Fix registry/configuration and reload Pi. Future children read disk; existing children are unchanged.`, true);
        }
      } catch (error) {
        // Store errors are deliberately sanitized; never print registry/provider errors or config contents.
        notify(ctx, error instanceof ProfileError ? error.message : 'Model profile operation failed; check local file permissions and retry.', true);
      }
    },
  });
}
