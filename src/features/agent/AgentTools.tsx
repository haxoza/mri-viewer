import { useEffect, useState, type RefObject } from 'react';
import { registerAgentTools } from './webmcp';
import { probeWebMcp } from './capabilities';
export function AgentTools({ workspace }: { workspace: RefObject<HTMLDivElement | null> }) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('Disabled');
  const [capabilities, setCapabilities] = useState(probeWebMcp);
  const [expanded, setExpanded] = useState(false);
  const { available } = capabilities;
  const recheck = () =>
    setCapabilities((previous) => {
      const next = probeWebMcp();
      return next.diagnostics === previous.diagnostics && next.api === previous.api
        ? previous
        : next;
    });
  useEffect(() => {
    if (!expanded) return;
    // Browser bridges may be injected after React's initial render.
    const timer = window.setInterval(recheck, 1000);
    window.addEventListener('focus', recheck);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', recheck);
    };
  }, [expanded]);
  useEffect(() => {
    if (!enabled || !available || !workspace.current) return;
    return registerAgentTools(workspace.current, setStatus);
  }, [enabled, available, capabilities.api, workspace]);
  return (
    <details
      className="agent-tools"
      onToggle={(e) => {
        setExpanded(e.currentTarget.open);
        recheck();
      }}
    >
      <summary>Agent tools</summary>
      <div className="popover">
        <p role="status">
          {!available ? 'Unavailable in this browser' : enabled ? status : 'Disabled'}
        </p>
        {!available && <p>{capabilities.reason}</p>}
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
        <details>
          <summary>Connection diagnostics</summary>
          <p>
            Capability checks only; no examination data. Copy this text when reporting a connection
            problem.
          </p>
          <textarea
            aria-label="WebMCP diagnostics"
            readOnly
            rows={9}
            value={capabilities.diagnostics}
            style={{ width: '100%', fontSize: 12 }}
          />
          <button onClick={recheck}>Recheck connection</button>
        </details>
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
