import React from 'react';
import { MCPSettings } from '../../components/mcp/MCPSettings.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';


export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  if (args) {
    const parts = args.trim().split(/\s+/);

    // Allow /mcp no-redirect to bypass the redirect for testing
    if (parts[0] === 'no-redirect') {
      return <MCPSettings onComplete={onDone} />;
    }

    // if (parts[0] === 'enable' || parts[0] === 'disable') {
    //   return (
    //     <MCPToggle action={parts[0]} target={parts.length > 1 ? parts.slice(1).join(' ') : 'all'} onComplete={onDone} />
    //   );
    // }
  }
  return <MCPSettings onComplete={onDone} />;
}
