import { useEffect, useState, type RefObject } from 'react';
import { modelContext, registerAgentTools } from './webmcp';
export function AgentTools({ workspace }: { workspace: RefObject<HTMLDivElement | null> }) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('Disabled');
  const available = !!modelContext();
  useEffect(() => {
    if (!enabled || !workspace.current) return;
    return registerAgentTools(workspace.current, setStatus);
  }, [enabled, workspace]);
  return (
    <details className="agent-tools">
      <summary>Agent tools</summary>
      <div className="popover">
        <p role="status">
          {!available ? 'Unavailable in this browser' : enabled ? status : 'Disabled'}
        </p>
        <label className="check">
          <input
            type="checkbox"
            aria-label="Enable agent tools"
            disabled={!available}
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setStatus('Registering…');
            }}
          />
          Enable for this session
        </label>
        <p>
          DICOM files stay in this browser. Images shared with your desktop agent enter that agent's
          conversation.
        </p>
        <p>
          Load files, then ask your agent to inspect a pane or operate the viewer. Captures open in
          Export; take a new capture after navigation. Pixels may contain burned-in identifiers.
        </p>
        <p>
          Ellipse marks stay at the same screen position through slice, pan and zoom changes. No
          anatomical tracking or measurements.
        </p>
      </div>
    </details>
  );
}
