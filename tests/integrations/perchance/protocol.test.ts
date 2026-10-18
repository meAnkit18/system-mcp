import { describe, it, expect } from 'vitest';
import { validateToolCall, parseToolCalls, makeToolResult } from '../../../src/integrations/perchance/protocol.js';

describe('perchance protocol', () => {
  it('validates a valid tool call', () => {
    const r = validateToolCall({ type: 'tool_call', id: 'c1', tool: 'list_files', arguments: { path: '.' } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.tool).toBe('list_files');
  });

  it('rejects unknown tool when allowed list provided', () => {
    const r = validateToolCall({ type: 'tool_call', id: 'c2', tool: 'rm_rf' }, ['list_files']);
    expect(r.ok).toBe(false);
  });

  it('rejects malformed request', () => {
    const r = validateToolCall({ type: 'tool_call', id: '', tool: 'list_files' });
    expect(r.ok).toBe(false);
  });

  it('parses tool calls from fenced block', () => {
    const text = 'Here you go:\n```json\n{"type":"tool_call","id":"a","tool":"read_file","arguments":{"path":"x.txt"}}\n```';
    const calls = parseToolCalls(text);
    expect(calls.length).toBe(1);
    expect(calls[0].id).toBe('a');
  });

  it('parses multiple calls from array', () => {
    const text = '```json\n[{"type":"tool_call","id":"a","tool":"list_files","arguments":{}},{"type":"tool_call","id":"b","tool":"get_system_info","arguments":{}}]\n```';
    const calls = parseToolCalls(text);
    expect(calls.length).toBe(2);
  });

  it('dedupes by id+tool', () => {
    const text = '{"type":"tool_call","id":"a","tool":"list_files","arguments":{}}\n{"type":"tool_call","id":"a","tool":"list_files","arguments":{}}';
    const calls = parseToolCalls(text);
    expect(calls.length).toBe(1);
  });

  it('makeToolResult shape', () => {
    const r = makeToolResult({ type: 'tool_call', id: 'x', tool: 't', arguments: {} }, true, { ok: 1 });
    expect(r.type).toBe('tool_result');
    expect(r.ok).toBe(true);
  });
});