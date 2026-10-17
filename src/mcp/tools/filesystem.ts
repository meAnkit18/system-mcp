import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs/promises';
import { existsSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { ServerContext } from '../context.js';
import { resolveWithinWorkspaces, isSensitivePath, isWithin } from '../../security/paths.js';
import { AppError } from '../../utils/errors.js';


const MAX_ENTRIES = 5000;

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
}

function checkSensitive(p: string) {
  if (isSensitivePath(p)) {
    throw new AppError('SENSITIVE_PATH', `Access to sensitive path is blocked: ${p}`, undefined, 403);
  }
}

async function handleDestructiveApproval(
  ctx: ServerContext,
  kind: string,
  description: string,
  payload: Record<string, unknown>,
  approvalId?: string,
): Promise<void> {
  const mode = ctx.config.approvals.destructiveFileOps;
  if (mode === 'allow') return;
  if (mode === 'block') {
    throw new AppError('FILE_OP_BLOCKED', `${kind} is blocked by configuration`, undefined, 403);
  }
  // require-approval
  if (approvalId) {
    const req = ctx.approvals.get(approvalId);
    if (!req || req.status !== 'approved') {
      throw new AppError('APPROVAL_NOT_GRANTED', 'Approval not granted or expired', { approvalId }, 403);
    }
    return;
  }
  const req = ctx.approvals.create({
    type: 'file',
    description,
    payload,
    risk: 'moderate',
  });
  throw new AppError(
    'APPROVAL_REQUIRED',
    `Approval required. Re-run with approvalId="${req.id}" after approval.`,
    { approvalId: req.id, status: 'pending_approval' },
    409,
  );
}

export function registerFilesystemTools(server: McpServer, ctx: ServerContext): void {
  // list_files
  server.registerTool(
    'list_files',
    {
      title: 'List Files',
      description: 'List files and directories within a configured workspace.',
      inputSchema: {
        path: z.string().optional().describe('Directory path (absolute or relative to a workspace). Defaults to first workspace.'),
        recursive: z.boolean().optional().default(false).describe('Recurse into subdirectories'),
        maxDepth: z.number().int().min(0).max(20).optional().default(3).describe('Max recursion depth when recursive'),
        includeHidden: z.boolean().optional().default(false).describe('Include hidden files'),
        limit: z.number().int().positive().max(10000).optional().default(1000).describe('Max entries to return'),
      },
    },
    async (args: any) => {
      try {
        const p = args.path ?? ctx.config.workspaces[0];
        const checked = resolveWithinWorkspaces(p, ctx.config.workspaces);
        checkSensitive(checked.absolute);
        const entries: any[] = [];
        async function walk(dir: string, depth: number) {
          if (entries.length >= (args.limit ?? 1000)) return;
          if (depth < 0) return;
          let items;
          try {
            items = await fs.readdir(dir, { withFileTypes: true });
          } catch (e) {
            return;
          }
          for (const it of items) {
            if (!args.includeHidden && it.name.startsWith('.')) continue;
            const full = path.join(dir, it.name);
            let st;
            try {
              st = await fs.stat(full);
            } catch {
              st = null;
            }
            entries.push({
              path: full,
              name: it.name,
              type: it.isDirectory() ? 'directory' : it.isSymbolicLink() ? 'symlink' : 'file',
              size: st?.size ?? null,
              modified: st?.mtime?.toISOString() ?? null,
            });
            if (entries.length >= (args.limit ?? 1000)) return;
            if (args.recursive && it.isDirectory() && depth > 0) {
              await walk(full, depth - 1);
            }
          }
        }
        const st = await fs.stat(checked.absolute);
        if (!st.isDirectory()) {
          return fail(new Error('Path is not a directory'));
        }
        await walk(checked.absolute, args.maxDepth ?? 3);
        ctx.audit.record({ action: 'list_files', actor: 'mcp', target: checked.absolute, result: 'success', details: { count: entries.length } });
        return ok({ path: checked.absolute, entries, truncated: entries.length >= (args.limit ?? 1000) });
      } catch (e) {
        ctx.audit.record({ action: 'list_files', actor: 'mcp', target: args.path, result: 'failure', error: (e as Error).message });
        return fail(e);
      }
    },
  );

  // read_file
  server.registerTool(
    'read_file',
    {
      title: 'Read File',
      description: 'Read contents of a file. Supports line offsets/limits for large files.',
      inputSchema: {
        path: z.string().describe('File path'),
        offset: z.number().int().min(0).optional().describe('Starting line number (0-based)'),
        limit: z.number().int().positive().optional().describe('Max lines to return'),
        maxBytes: z.number().int().positive().optional().describe('Max bytes to read'),
      },
    },
    async (args: any) => {
      try {
        const checked = resolveWithinWorkspaces(args.path, ctx.config.workspaces);
        checkSensitive(checked.absolute);
        const st = await fs.stat(checked.absolute);
        if (!st.isFile()) throw new AppError('NOT_FILE', 'Path is not a file');
        const maxBytes = Math.min(args.maxBytes ?? ctx.config.limits.maxFileSizeBytes, ctx.config.limits.maxFileSizeBytes);
        if (st.size > ctx.config.limits.maxFileSizeBytes && !args.maxBytes) {
          // still allow partial
        }
        const buf = await fs.readFile(checked.absolute);
        // binary detection
        const isBinary = buf.includes(0);
        if (isBinary) {
          const slice = buf.subarray(0, maxBytes);
          ctx.audit.record({ action: 'read_file', actor: 'mcp', target: checked.absolute, result: 'success', details: { binary: true, bytes: slice.length } });
          return ok({ path: checked.absolute, binary: true, encoding: 'base64', content: slice.toString('base64'), size: st.size, truncated: buf.length > maxBytes });
        }
        let text = buf.subarray(0, maxBytes).toString('utf8');
        if (args.offset !== undefined || args.limit !== undefined) {
          const lines = text.split(/\r?\n/);
          const start = args.offset ?? 0;
          const end = args.limit ? start + args.limit : lines.length;
          text = lines.slice(start, end).join('\n');
        }
        ctx.audit.record({ action: 'read_file', actor: 'mcp', target: checked.absolute, result: 'success', details: { bytes: buf.length } });
        return ok({ path: checked.absolute, binary: false, content: text, size: st.size, truncated: buf.length > maxBytes });
      } catch (e) {
        ctx.audit.record({ action: 'read_file', actor: 'mcp', target: args.path, result: 'failure', error: (e as Error).message });
        return fail(e);
      }
    },
  );

  // write_file
  server.registerTool(
    'write_file',
    {
      title: 'Write File',
      description: 'Create or overwrite a file. Overwriting existing files may require approval.',
      inputSchema: {
        path: z.string().describe('File path'),
        content: z.string().describe('File content'),
        encoding: z.enum(['utf8', 'base64']).optional().default('utf8').describe('Content encoding'),
        createParents: z.boolean().optional().default(true).describe('Create parent directories'),
        overwrite: z.boolean().optional().default(true).describe('Overwrite if exists'),
        approvalId: z.string().optional().describe('Approval id for destructive overwrite'),
      },
    },
    async (args: any) => {
      try {
        const checked = resolveWithinWorkspaces(args.path, ctx.config.workspaces);
        checkSensitive(checked.absolute);
        const exists = existsSync(checked.absolute);
        if (exists && !args.overwrite) {
          throw new AppError('FILE_EXISTS', 'File exists and overwrite=false');
        }
        if (exists && args.overwrite) {
          await handleDestructiveApproval(ctx, 'write_file overwrite', `Overwrite ${checked.absolute}`, { path: checked.absolute }, args.approvalId);
        }
        if (args.createParents) {
          await fs.mkdir(path.dirname(checked.absolute), { recursive: true });
        }
        const buf = args.encoding === 'base64' ? Buffer.from(args.content, 'base64') : Buffer.from(args.content, 'utf8');
        if (buf.length > ctx.config.limits.maxFileSizeBytes) {
          throw new AppError('FILE_TOO_LARGE', 'Content exceeds max file size');
        }
        await fs.writeFile(checked.absolute, buf);
        ctx.audit.record({ action: 'write_file', actor: 'mcp', target: checked.absolute, result: 'success', details: { bytes: buf.length, overwrite: exists } });
        return ok({ path: checked.absolute, bytes: buf.length, created: !exists });
      } catch (e) {
        if (e instanceof AppError && e.code === 'APPROVAL_REQUIRED') {
          ctx.audit.record({ action: 'write_file', actor: 'mcp', target: args.path, result: 'denied', error: (e as Error).message });
          return ok(e.details ?? { status: 'pending_approval' });
        }
        ctx.audit.record({ action: 'write_file', actor: 'mcp', target: args.path, result: 'failure', error: (e as Error).message });
        return fail(e);
      }
    },
  );

  // edit_file
  server.registerTool(
    'edit_file',
    {
      title: 'Edit File',
      description: 'Apply targeted string replacements to an existing file.',
      inputSchema: {
        path: z.string().describe('File path'),
        edits: z
          .array(
            z.object({
              oldString: z.string().describe('Exact text to find'),
              newString: z.string().describe('Replacement text'),
              replaceAll: z.boolean().optional().default(false).describe('Replace all occurrences'),
            }),
          )
          .min(1)
          .describe('List of edits to apply sequentially'),
        approvalId: z.string().optional(),
      },
    },
    async (args: any) => {
      try {
        const checked = resolveWithinWorkspaces(args.path, ctx.config.workspaces);
        checkSensitive(checked.absolute);
        if (!existsSync(checked.absolute)) throw new AppError('NOT_FOUND', 'File not found');
        await handleDestructiveApproval(ctx, 'edit_file', `Edit ${checked.absolute}`, { path: checked.absolute }, args.approvalId);
        let content = await fs.readFile(checked.absolute, 'utf8');
        let totalReplacements = 0;
        for (const edit of args.edits) {
          if (edit.replaceAll) {
            const count = content.split(edit.oldString).length - 1;
            content = content.split(edit.oldString).join(edit.newString);
            totalReplacements += count;
          } else {
            const idx = content.indexOf(edit.oldString);
            if (idx === -1) throw new AppError('EDIT_NOT_FOUND', `oldString not found: ${edit.oldString.slice(0, 80)}`);
            content = content.slice(0, idx) + edit.newString + content.slice(idx + edit.oldString.length);
            totalReplacements += 1;
          }
        }
        await fs.writeFile(checked.absolute, content, 'utf8');
        ctx.audit.record({ action: 'edit_file', actor: 'mcp', target: checked.absolute, result: 'success', details: { replacements: totalReplacements } });
        return ok({ path: checked.absolute, replacements: totalReplacements });
      } catch (e) {
        if (e instanceof AppError && e.code === 'APPROVAL_REQUIRED') {
          ctx.audit.record({ action: 'edit_file', actor: 'mcp', target: args.path, result: 'denied', error: (e as Error).message });
          return ok(e.details ?? { status: 'pending_approval' });
        }
        ctx.audit.record({ action: 'edit_file', actor: 'mcp', target: args.path, result: 'failure', error: (e as Error).message });
        return fail(e);
      }
    },
  );

  // create_directory
  server.registerTool(
    'create_directory',
    {
      title: 'Create Directory',
      description: 'Create a directory (and parents) within a workspace.',
      inputSchema: {
        path: z.string().describe('Directory path'),
      },
    },
    async (args: any) => {
      try {
        const checked = resolveWithinWorkspaces(args.path, ctx.config.workspaces);
        checkSensitive(checked.absolute);
        await fs.mkdir(checked.absolute, { recursive: true });
        ctx.audit.record({ action: 'create_directory', actor: 'mcp', target: checked.absolute, result: 'success' });
        return ok({ path: checked.absolute, created: true });
      } catch (e) {
        ctx.audit.record({ action: 'create_directory', actor: 'mcp', target: args.path, result: 'failure', error: (e as Error).message });
        return fail(e);
      }
    },
  );

  // move_file
  server.registerTool(
    'move_file',
    {
      title: 'Move File',
      description: 'Move or rename a file/directory within workspaces.',
      inputSchema: {
        source: z.string().describe('Source path'),
        destination: z.string().describe('Destination path'),
        overwrite: z.boolean().optional().default(false).describe('Overwrite destination if exists'),
        approvalId: z.string().optional(),
      },
    },
    async (args: any) => {
      try {
        const src = resolveWithinWorkspaces(args.source, ctx.config.workspaces);
        const dst = resolveWithinWorkspaces(args.destination, ctx.config.workspaces);
        checkSensitive(src.absolute);
        checkSensitive(dst.absolute);
        const dstExists = existsSync(dst.absolute);
        if (dstExists && !args.overwrite) throw new AppError('DEST_EXISTS', 'Destination exists');
        if (dstExists) {
          await handleDestructiveApproval(ctx, 'move_file overwrite', `Move ${src.absolute} -> ${dst.absolute}`, { source: src.absolute, destination: dst.absolute }, args.approvalId);
        }
        await fs.mkdir(path.dirname(dst.absolute), { recursive: true });
        await fs.rename(src.absolute, dst.absolute);
        ctx.audit.record({ action: 'move_file', actor: 'mcp', target: src.absolute, result: 'success', details: { destination: dst.absolute } });
        return ok({ source: src.absolute, destination: dst.absolute });
      } catch (e) {
        if (e instanceof AppError && e.code === 'APPROVAL_REQUIRED') {
          ctx.audit.record({ action: 'move_file', actor: 'mcp', target: args.source, result: 'denied', error: (e as Error).message });
          return ok(e.details ?? { status: 'pending_approval' });
        }
        ctx.audit.record({ action: 'move_file', actor: 'mcp', target: args.source, result: 'failure', error: (e as Error).message });
        return fail(e);
      }
    },
  );

  // delete_file
  server.registerTool(
    'delete_file',
    {
      title: 'Delete File',
      description: 'Delete a file or directory. Requires approval by default.',
      inputSchema: {
        path: z.string().describe('Path to delete'),
        recursive: z.boolean().optional().default(false).describe('Delete directories recursively'),
        approvalId: z.string().optional(),
      },
    },
    async (args: any) => {
      try {
        const checked = resolveWithinWorkspaces(args.path, ctx.config.workspaces);
        checkSensitive(checked.absolute);
        // Prevent deleting workspace root
        if (ctx.config.workspaces.includes(checked.absolute)) {
          throw new AppError('PROTECTED', 'Cannot delete a configured workspace root', undefined, 403);
        }
        await handleDestructiveApproval(ctx, 'delete_file', `Delete ${checked.absolute}`, { path: checked.absolute }, args.approvalId);
        const st = await fs.stat(checked.absolute);
        if (st.isDirectory()) {
          await fs.rm(checked.absolute, { recursive: args.recursive ?? false, force: false });
        } else {
          await fs.unlink(checked.absolute);
        }
        ctx.audit.record({ action: 'delete_file', actor: 'mcp', target: checked.absolute, result: 'success' });
        return ok({ path: checked.absolute, deleted: true });
      } catch (e) {
        if (e instanceof AppError && e.code === 'APPROVAL_REQUIRED') {
          ctx.audit.record({ action: 'delete_file', actor: 'mcp', target: args.path, result: 'denied', error: (e as Error).message });
          return ok(e.details ?? { status: 'pending_approval' });
        }
        ctx.audit.record({ action: 'delete_file', actor: 'mcp', target: args.path, result: 'failure', error: (e as Error).message });
        return fail(e);
      }
    },
  );

  // search_files
  server.registerTool(
    'search_files',
    {
      title: 'Search Files',
      description: 'Search file contents and filenames within a workspace.',
      inputSchema: {
        root: z.string().optional().describe('Root directory (defaults to first workspace)'),
        query: z.string().describe('Search string (literal)'),
        filePattern: z.string().optional().describe('Glob-like filename filter, e.g. *.ts'),
        maxResults: z.number().int().positive().max(500).optional().default(50).describe('Max matches'),
        includeHidden: z.boolean().optional().default(false),
      },
    },
    async (args: any) => {
      try {
        const p = args.root ?? ctx.config.workspaces[0];
        const checked = resolveWithinWorkspaces(p, ctx.config.workspaces);
        const results: any[] = [];
        const maxResults = args.maxResults ?? 50;
        const skipDirs = new Set(['node_modules', '.git', 'dist', 'build']);
        async function walk(dir: string, depth: number) {
          if (results.length >= maxResults) return;
          if (depth > 8) return;
          let items;
          try {
            items = await fs.readdir(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const it of items) {
            if (!args.includeHidden && it.name.startsWith('.')) continue;
            if (it.isDirectory() && skipDirs.has(it.name)) continue;
            const full = path.join(dir, it.name);
            // filename match
            if (it.name.includes(args.query)) {
              results.push({ type: 'filename', path: full });
              if (results.length >= maxResults) return;
            }
            if (it.isFile()) {
              // filePattern filter
              if (args.filePattern) {
                const pat = args.filePattern.replace('*', '');
                if (!it.name.includes(pat.replace(/\*/g, ''))) {
                  // simple contains
                }
              }
              // content search if small enough
              try {
                const st = await fs.stat(full);
                if (st.size <= 1024 * 1024) {
                  const content = await fs.readFile(full, 'utf8');
                  const lines = content.split(/\r?\n/);
                  for (let i = 0; i < lines.length; i++) {
                    if (lines[i]!.includes(args.query)) {
                      results.push({ type: 'content', path: full, line: i + 1, snippet: lines[i]!.slice(0, 200) });
                      if (results.length >= maxResults) return;
                    }
                  }
                }
              } catch {
                // binary or unreadable
              }
            }
            if (it.isDirectory()) {
              await walk(full, depth + 1);
            }
          }
        }
        await walk(checked.absolute, 0);
        ctx.audit.record({ action: 'search_files', actor: 'mcp', target: checked.absolute, result: 'success', details: { matches: results.length } });
        return ok({ root: checked.absolute, query: args.query, results });
      } catch (e) {
        ctx.audit.record({ action: 'search_files', actor: 'mcp', target: args.root, result: 'failure', error: (e as Error).message });
        return fail(e);
      }
    },
  );
}