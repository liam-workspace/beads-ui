/**
 * The current workspace, shared by the WebSocket handlers and the HTTP file
 * route so both read the folder `set-workspace` last chose.
 */

/**
 * @typedef {{ root_dir: string, db_path: string }} Workspace
 */

/** @type {Workspace | null} */
let CURRENT_WORKSPACE = null;

/**
 * @returns {Workspace | null} The stored workspace, or null before the server
 * attaches.
 */
export function getCurrentWorkspace() {
  return CURRENT_WORKSPACE;
}

/**
 * @param {Workspace} workspace
 * @returns {Workspace} The stored workspace.
 */
export function setCurrentWorkspace(workspace) {
  CURRENT_WORKSPACE = workspace;
  return CURRENT_WORKSPACE;
}
